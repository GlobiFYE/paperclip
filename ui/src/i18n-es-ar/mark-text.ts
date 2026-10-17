/**
 * El marcado del texto de interfaz en tiempo de compilación (ADR 0002).
 *
 * `markText` reescribe el código fuente **antes** de que Vite lo compile y
 * envuelve los literales que upstream escribió como texto de interfaz:
 *
 * ```tsx
 * // el archivo de upstream (no se toca)
 * <div title="Save"><h1>Create your first organization</h1><span>{agent.name}</span></div>
 * // lo que compila el build es-AR
 * <div title={__tEs("Save")}><h1>{__tEs("Create your first organization")}</h1><span>{agent.name}</span></div>
 * ```
 *
 * `agent.name` no es un literal: no hay dónde ponerle la llamada. **El dato
 * queda estructuralmente afuera**, y ésa es la invariante entera del ADR (§4).
 *
 * Reglas que **no** se pueden cambiar sin volver al ADR:
 *
 * - **Edición por rangos, nunca reimpresión del AST.** Se juntan las ediciones
 *   `{start, end, text}`, se descartan las anidadas y se aplican en una pasada.
 *   Así el archivo sale igual al de upstream salvo en los puntos marcados.
 * - **Toda edición conserva la cantidad de saltos de línea del rango que
 *   reemplaza.** Es lo que mantiene los números de línea, que es lo que mantiene
 *   el stack trace y el `lineNumber` de React en dev.
 * - **El `import` se inyecta en el offset 0, sin salto de línea**, y sólo si hubo
 *   al menos una edición.
 * - Lista blanca, nunca lista negra: las listas viven en `./text-sites`.
 */

import { parseAst } from "vite";

import { claveDeArchivo, hayEntradaPorSitio } from "./por-sitio";
import {
  ENTITIES, OPAQUE_ELEMENTS, TEXT_ATTRS, TEXT_CALLS, TEXT_DECLS, TEXT_KEYS,
} from "./text-sites";

const IMPORT =
  'import { translate as __tEs, formatted as __tEsFmt } from "@/i18n-es-ar/overlay";';

export type MarkLang = "ts" | "tsx";

/** Qué clase de sitio produjo una marca. Lo usa el reporte de la fase 3. */
export type SiteKind =
  | "jsx-text"
  | "jsx-attr"
  | "jsx-child"
  | "object-key"
  | "call"
  | "decl"
  | "format";

export interface MarkedSite {
  kind: SiteKind;
  /** La clave de diccionario: la cadena literal, o la forma estática del formato. */
  key: string;
}

export interface MarkReport {
  /** Cada sitio marcado, en orden de aparición. */
  sites: MarkedSite[];
  /** Textos de JSX salteados por una entidad fuera de la tabla. */
  unknownEntities: string[];
  /** Cadenas que la regla de la comparación (§7.4) bloqueó. */
  blocked: string[];
  /**
   * Nombres de atributo o de clave que llevaban un literal y **no** están en las
   * listas. Es la cola de la que sale la cobertura de los cortes que vengan.
   */
  uncoveredNames: { attrs: Map<string, number>; keys: Map<string, number> };
}

/**
 * El valor de un texto de JSX: lo que React termina rindiendo. Las líneas
 * posteriores a la primera pierden la sangría, las anteriores a la última pierden
 * el espacio final, las vacías se caen y el resto se une con un espacio. Sin
 * esto, marcar texto de varias líneas cambiaría lo que se ve.
 */
export function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] as string;
    if (i > 0) line = line.replace(/^[ \t]+/, "");
    if (i < lines.length - 1) line = line.replace(/[ \t]+$/, "");
    if (line !== "") parts.push(line);
  }
  return parts.join(" ");
}

/** Decodifica las entidades de la tabla y las numéricas. `undefined` si aparece
 *  una que no conoce: ahí ese texto no se marca. */
export function decodeEntities(value: string): string | undefined {
  let out = "";
  let at = 0;
  for (const m of value.matchAll(/&[#\w]+;/g)) {
    const found = ENTITIES[m[0]] ?? numeric(m[0]);
    if (found === undefined) return undefined;
    out += value.slice(at, m.index) + found;
    at = (m.index as number) + m[0].length;
  }
  return out + value.slice(at);
}

function numeric(entity: string): string | undefined {
  const dec = /^&#(\d+);$/.exec(entity);
  if (dec) return String.fromCodePoint(Number(dec[1]));
  const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
  if (hex) return String.fromCodePoint(Number.parseInt(hex[1] as string, 16));
  return undefined;
}

/* ------------------------------------------------------------------ */
/* El AST                                                              */
/* ------------------------------------------------------------------ */

/**
 * El AST de `parseAst` es el de oxc, con forma ESTree y offsets `start`/`end`
 * que son índices de cadena de JavaScript, así que `code.slice(start, end)` es
 * exacto y se puede editar por rangos (§6.2). Se recorre sin tipos generados: lo
 * único que se asume de un nodo es que tiene `type`, `start` y `end`.
 */
interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

/** Los hijos de un nodo, en el orden en que los expone el AST. */
function childNodes(node: Node): Node[] {
  const out: Node[] = [];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (isNode(value)) out.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    }
  }
  return out;
}

function walkAll(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of childNodes(node)) walkAll(child, visit);
}

function stringLiteral(node: Node | undefined): string | undefined {
  if (!node || node.type !== "Literal") return undefined;
  return typeof node.value === "string" ? node.value : undefined;
}

/** El nombre llamable de un callee: `foo`, `foo.bar`, `window.confirm`. */
function calleeName(callee: Node | undefined): string | undefined {
  if (!callee) return undefined;
  if (callee.type === "Identifier") return callee.name as string;
  if (callee.type === "MemberExpression" && callee.computed !== true) {
    const object = callee.object as Node | undefined;
    const property = callee.property as Node | undefined;
    if (property?.type !== "Identifier") return undefined;
    const head = object?.type === "Identifier" ? (object.name as string) : undefined;
    return head === undefined ? undefined : `${head}.${property.name as string}`;
  }
  return undefined;
}

/** El nombre de un atributo de JSX, o `undefined` si lleva namespace o spread. */
function attrName(node: Node): string | undefined {
  const name = node.name as Node | undefined;
  return name?.type === "JSXIdentifier" ? (name.name as string) : undefined;
}

/** El nombre de una clave de propiedad no computada. */
function keyName(node: Node): string | undefined {
  if (node.computed === true) return undefined;
  const key = node.key as Node | undefined;
  if (!key) return undefined;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

/** El nombre del elemento, sólo si es una etiqueta simple (`div`, `code`). */
function elementName(node: Node): string | undefined {
  const opening = node.openingElement as Node | undefined;
  const name = opening?.name as Node | undefined;
  return name?.type === "JSXIdentifier" ? (name.name as string) : undefined;
}

/* ------------------------------------------------------------------ */
/* La regla de la comparación (§7.4)                                   */
/* ------------------------------------------------------------------ */

const COMPARISON_OPERATORS = new Set(["===", "!==", "==", "!="]);
const COMPARISON_METHODS = new Set([
  "includes", "indexOf", "startsWith", "endsWith", "has", "get",
]);

/**
 * Las cadenas que el archivo usa como operando de comparación.
 *
 * > Si una cadena aparece en un archivo como operando de `===`, `!==`, `==`,
 * > `!=`, de un `case`, o de `.includes/.indexOf/.startsWith/.endsWith/.has/
 * > .get`, **en ese archivo no se marca en ningún sitio**.
 *
 * Es la mitigación del único riesgo nuevo que trae mover el marcado al build:
 * que el español llegue antes que la lógica y rompa un `item.label === "Done"`.
 * Cuesta 0,56 % de cobertura (§6.8) y se degrada a inglés, que es la dirección
 * segura.
 */
export function comparedStrings(root: Node): Set<string> {
  const out = new Set<string>();
  const add = (node: Node | undefined) => {
    const value = stringLiteral(node);
    if (value !== undefined) out.add(value);
  };
  walkAll(root, (node) => {
    if (node.type === "BinaryExpression" && COMPARISON_OPERATORS.has(node.operator as string)) {
      add(node.left as Node | undefined);
      add(node.right as Node | undefined);
      return;
    }
    if (node.type === "SwitchCase") {
      add(node.test as Node | undefined);
      return;
    }
    if (node.type === "CallExpression") {
      const callee = node.callee as Node | undefined;
      if (
        callee?.type === "MemberExpression" &&
        callee.computed !== true &&
        (callee.property as Node | undefined)?.type === "Identifier" &&
        COMPARISON_METHODS.has((callee.property as Node).name as string)
      ) {
        for (const argument of (node.arguments as Node[] | undefined) ?? []) add(argument);
      }
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* El canal de declaraciones (§7.2)                                    */
/* ------------------------------------------------------------------ */

interface DeclPlan {
  /** Subárboles donde se marcan los literales a cualquier profundidad. */
  regions: Set<Node>;
  /** Argumentos de `return` de una función declarada: se envuelven enteros. */
  returns: Node[];
}

/**
 * Para el archivo en curso, busca cada nombre listado en `TEXT_DECLS`.
 *
 * Si un nombre no aparece, **tira**: un `git pull` que renombre algo tiene que
 * verse como error de build y no como media pantalla en inglés (§12).
 */
function declPlan(root: Node, file: string): DeclPlan {
  const entry = TEXT_DECLS.find((decl) => decl.file === file);
  const plan: DeclPlan = { regions: new Set(), returns: [] };
  if (!entry) return plan;

  const found = new Set<string>();
  const names = new Set(entry.names);

  walkAll(root, (node) => {
    // `const`/`let`: los literales del inicializador, a cualquier profundidad.
    if (node.type === "VariableDeclarator") {
      const id = node.id as Node | undefined;
      const init = node.init as Node | undefined;
      if (id?.type === "Identifier" && names.has(id.name as string) && init) {
        found.add(id.name as string);
        plan.regions.add(init);
      }
      return;
    }
    // `function`: el argumento de cada `return` de su cuerpo, no de las
    // funciones anidadas.
    if (node.type === "FunctionDeclaration") {
      const id = node.id as Node | undefined;
      if (id?.type === "Identifier" && names.has(id.name as string)) {
        found.add(id.name as string);
        for (const argument of returnArguments(node.body as Node | undefined)) {
          plan.returns.push(argument);
        }
      }
      return;
    }
    // Parámetro con valor por defecto: el valor por defecto.
    if (node.type === "AssignmentPattern") {
      const left = node.left as Node | undefined;
      const right = node.right as Node | undefined;
      if (left?.type === "Identifier" && names.has(left.name as string) && right) {
        found.add(left.name as string);
        plan.regions.add(right);
      }
    }
  });

  for (const name of names) {
    if (!found.has(name)) {
      throw new Error(
        `paperclip-es-ar: falta la declaración \`${name}\` en ${file}. ` +
          `TEXT_DECLS la necesita para traducir esa etiqueta sin tocar upstream; ` +
          `si upstream la renombró, hay que actualizar la entrada en ` +
          `src/i18n-es-ar/text-sites.ts (ADR 0002 §8 fase 2).`,
      );
    }
  }
  return plan;
}

/** Los `return` del cuerpo de una función, sin entrar en las anidadas. */
function returnArguments(body: Node | undefined): Node[] {
  const out: Node[] = [];
  if (!body) return out;
  const descend = (node: Node) => {
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      return;
    }
    if (node.type === "ReturnStatement") {
      const argument = node.argument as Node | undefined;
      if (argument) out.push(argument);
      return;
    }
    for (const child of childNodes(node)) descend(child);
  };
  for (const child of childNodes(body)) descend(child);
  return out;
}

/* ------------------------------------------------------------------ */
/* El transform                                                        */
/* ------------------------------------------------------------------ */

interface Edit {
  start: number;
  end: number;
  text: string;
}

function countNewlines(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) count++;
  return count;
}

interface Context {
  /** Dentro de un `<code>` o un `<pre>`, a cualquier profundidad: nada se marca. */
  opaque: boolean;
  /** Dentro de una declaración de `TEXT_DECLS`: los literales son etiquetas. */
  inDecl: boolean;
}

/**
 * Marca el texto de interfaz de `code`. Devuelve `null` si no hubo nada que
 * marcar, así el archivo le llega a Vite sin una sola diferencia.
 *
 * `file` es la ruta relativa a `ui/` y la usan dos cosas: el canal de
 * declaraciones (`TEXT_DECLS`) y el mapa por sitio de §14.2. Sin ella el
 * transform es puro, los otros tres sitios funcionan igual y el mapa por sitio
 * no se consulta, que es como lo usan los tests.
 */
export function markText(
  code: string,
  lang: MarkLang,
  file?: string,
): string | null {
  return markTextWithReport(code, lang, file).code;
}

/** Igual que `markText`, más lo que el reporte de la fase 3 necesita contar. */
export function markTextWithReport(
  code: string,
  lang: MarkLang,
  file?: string,
): { code: string | null; report: MarkReport } {
  const report: MarkReport = {
    sites: [],
    unknownEntities: [],
    blocked: [],
    uncoveredNames: { attrs: new Map(), keys: new Map() },
  };

  const ast = parseAst(code, { lang }) as unknown as Node;
  const compared = comparedStrings(ast);
  const plan = file ? declPlan(ast, file) : { regions: new Set<Node>(), returns: [] };
  // La clave del mapa por sitio: la ruta relativa a `ui/src/` (§14.2). Sin
  // `file` el transform es puro y el mapa simplemente no se consulta, que es
  // como lo usan los tests del marcado.
  const sitio = file === undefined ? undefined : claveDeArchivo(file);

  /** Una edición por rango. Un rango ya editado no se vuelve a editar. */
  const edits = new Map<string, Edit>();
  const rangeKey = (start: number, end: number) => `${start}:${end}`;

  /**
   * Nodos cuyo texto fuente quedó capturado tal cual dentro de una edición —los
   * formatos se llevan sus expresiones interpoladas—. No se entra: una edición
   * adentro se descartaría igual por anidada, pero contaría un sitio que no
   * existe en la salida.
   */
  const frozen = new Set<Node>();

  function edit(start: number, end: number, text: string): void {
    const key = rangeKey(start, end);
    if (edits.has(key)) return;
    // Toda edición conserva la cantidad de saltos de línea del rango que
    // reemplaza: sin esto, marcar texto de varias líneas corre los números de
    // línea de todo el archivo.
    const missing = countNewlines(code.slice(start, end)) - countNewlines(text);
    edits.set(key, { start, end, text: missing > 0 ? text + "\n".repeat(missing) : text });
  }

  function blocked(value: string): boolean {
    if (!compared.has(value)) return false;
    report.blocked.push(value);
    return true;
  }

  /**
   * La llamada que se escribe en un sitio de texto.
   *
   * El sitio se le pasa a `__tEs` **sólo** donde el mapa por sitio tiene algo
   * que decir (§14.2). Donde no, la llamada sale igual que antes: así agregar
   * el mapa no cambia un solo byte de la salida en los otros ~8.000 sitios, y
   * el conteo de posiciones que reciben algo que no es literal no se mueve.
   */
  function llamada(value: string): string {
    return sitio !== undefined && hayEntradaPorSitio(sitio, value)
      ? `__tEs(${JSON.stringify(value)}, ${JSON.stringify(sitio)})`
      : `__tEs(${JSON.stringify(value)})`;
  }

  function markLiteral(node: Node, value: string, kind: SiteKind, braces: boolean): void {
    if (edits.has(rangeKey(node.start, node.end))) return;
    if (value === "" || blocked(value)) return;
    const call = llamada(value);
    edit(node.start, node.end, braces ? `{${call}}` : call);
    report.sites.push({ kind, key: value });
  }

  /** Una plantilla con interpolación: se marca por su forma estática (§7.5). */
  function markTemplate(node: Node, kind: SiteKind): void {
    if (edits.has(rangeKey(node.start, node.end))) return;
    const quasis = (node.quasis as Node[] | undefined) ?? [];
    const expressions = (node.expressions as Node[] | undefined) ?? [];
    const shape: string[] = [];
    for (const quasi of quasis) {
      const cooked = (quasi.value as { cooked?: string | null } | undefined)?.cooked;
      if (typeof cooked !== "string") return; // escape inválido: no se marca
      shape.push(cooked);
    }
    if (expressions.length === 0) {
      const only = shape[0] ?? "";
      if (only.trim() === "") return;
      markLiteral(node, only, kind, false);
      return;
    }
    const key = shape.map((part, i) => (i < shape.length - 1 ? `${part}{${i}}` : part)).join("");
    if (blocked(key)) return;
    const values = expressions.map((expression) => code.slice(expression.start, expression.end));
    edit(
      node.start,
      node.end,
      `__tEsFmt([${shape.map((part) => JSON.stringify(part)).join(", ")}], [${values.join(", ")}])`,
    );
    // El valor interpolado viaja tal cual y **nunca** pasa por el diccionario.
    frozen.add(node);
    report.sites.push({ kind: "format", key });
  }

  /**
   * Envuelve un literal en un sitio de texto. Los nodos de paso son los únicos
   * donde se entra: **no se entra en llamadas, objetos ni arreglos**, y eso es
   * lo que deja afuera los literales técnicos (§7.3).
   */
  function wrap(node: Node | undefined, kind: SiteKind, braces = false): void {
    if (!node) return;
    switch (node.type) {
      case "Literal": {
        const value = stringLiteral(node);
        if (value !== undefined) markLiteral(node, value, kind, braces);
        return;
      }
      case "TemplateLiteral":
        markTemplate(node, kind);
        return;
      case "ConditionalExpression":
        wrap(node.consequent as Node | undefined, kind);
        wrap(node.alternate as Node | undefined, kind);
        return;
      case "LogicalExpression":
        wrap(node.left as Node | undefined, kind);
        wrap(node.right as Node | undefined, kind);
        return;
      case "SequenceExpression": {
        const parts = (node.expressions as Node[] | undefined) ?? [];
        wrap(parts[parts.length - 1], kind);
        return;
      }
      default:
        return;
    }
  }

  /**
   * El canal de declaraciones envuelve el **retorno** de una función declarada.
   *
   * Si el retorno tiene literales (o una rama con literales), se marcan uno por
   * uno: así la clave de diccionario es la cadena y no el código que la
   * produce. Si no —`statusLabel` devuelve un `.replace()`,
   * `environmentDeleteBlockMessage` devuelve `null`— se envuelve la expresión
   * entera, y por eso `translate` acepta cualquier valor y devuelve lo que no
   * sea cadena sin tocar.
   */
  function wrapReturn(node: Node): void {
    const beforeEdits = edits.size;
    const beforeBlocked = report.blocked.length;
    wrap(node, "decl");
    // Si la regla de la comparación (§7.4) bloqueó el literal, envolver la
    // expresión entera lo traduciría por la ventana de atrás.
    if (edits.size > beforeEdits || report.blocked.length > beforeBlocked) return;
    edit(node.start, node.end, `__tEs(${code.slice(node.start, node.end)})`);
    report.sites.push({ kind: "decl", key: "" });
  }

  function visit(node: Node, ctx: Context): void {
    if (frozen.has(node)) return;
    const inDecl = ctx.inDecl || plan.regions.has(node);
    const here: Context = inDecl === ctx.inDecl ? ctx : { ...ctx, inDecl };

    switch (node.type) {
      case "JSXElement":
      case "JSXFragment": {
        const name = node.type === "JSXElement" ? elementName(node) : undefined;
        const opaque = here.opaque || (name !== undefined && OPAQUE_ELEMENTS.has(name));
        const inner: Context = { opaque, inDecl: here.inDecl };

        if (node.type === "JSXElement") {
          const opening = node.openingElement as Node | undefined;
          for (const attribute of (opening?.attributes as Node[] | undefined) ?? []) {
            visitAttribute(attribute, inner);
          }
        }
        for (const child of (node.children as Node[] | undefined) ?? []) {
          visitChild(child, inner);
        }
        return;
      }

      case "Property": {
        // Las claves no se marcan nunca, ni siquiera dentro de una declaración.
        visit(node.key as Node, { ...here, inDecl: false });
        const raw = node.value as Node | undefined;
        // Un prop desestructurado con valor por defecto (`{ moreLabel = "Show
        // more" }`): se envuelve el lado derecho, no el patrón. Sin esta línea
        // `FoldCurtain` se queda en inglés (§10).
        const value = raw?.type === "AssignmentPattern" ? (raw.right as Node) : raw;
        const name = keyName(node);
        if (!here.opaque && name !== undefined && value) {
          if (TEXT_KEYS.has(name)) wrap(value, "object-key");
          else countUncovered(report.uncoveredNames.keys, name, value);
        }
        if (raw) visit(raw, here);
        return;
      }

      case "CallExpression": {
        const name = calleeName(node.callee as Node | undefined);
        const args = (node.arguments as Node[] | undefined) ?? [];
        if (!here.opaque && name !== undefined && TEXT_CALLS.has(name)) {
          for (const argument of args) wrap(argument, "call");
        }
        break;
      }

      // Las fuentes de `import`/`export` no son texto y no se tocan nunca.
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
      case "ImportExpression":
      case "TSImportType": {
        for (const child of childNodes(node)) {
          if (child === (node.source as unknown) || child === (node.argument as unknown)) continue;
          visit(child, here);
        }
        return;
      }

      // La parte literal de una plantilla etiquetada (`css`…``) es del tag.
      case "TaggedTemplateExpression": {
        visit(node.tag as Node, here);
        const quasi = node.quasi as Node | undefined;
        for (const expression of (quasi?.expressions as Node[] | undefined) ?? []) {
          visit(expression, here);
        }
        return;
      }

      case "Literal": {
        if (here.inDecl && !here.opaque) {
          const value = stringLiteral(node);
          if (value !== undefined) markLiteral(node, value, "decl", false);
        }
        return;
      }

      case "TemplateLiteral": {
        if (here.inDecl && !here.opaque) markTemplate(node, "decl");
        break;
      }

      default:
        break;
    }

    for (const child of childNodes(node)) visit(child, here);
  }

  function visitAttribute(node: Node, ctx: Context): void {
    if (node.type !== "JSXAttribute") {
      for (const child of childNodes(node)) visit(child, ctx);
      return;
    }
    const name = attrName(node);
    const value = node.value as Node | undefined;
    if (!value) return;

    const inner = value.type === "JSXExpressionContainer" ? (value.expression as Node) : value;
    if (!ctx.opaque && name !== undefined) {
      if (TEXT_ATTRS.has(name)) {
        // Un literal pelado necesita las llaves: sin ellas el archivo no
        // compila (`label="Save"` → `label={__tEs("Save")}`).
        wrap(inner, "jsx-attr", value.type === "Literal");
      } else {
        countUncovered(report.uncoveredNames.attrs, name, inner);
      }
    }
    // Se entra igual: un atributo fuera de la lista puede llevar JSX adentro
    // (`icon={<Foo title="…" />}`). El literal pelado de un atributo **no** se
    // visita nunca: marcarlo sin llaves no compilaría, y por eso es el único
    // sitio que el canal de declaraciones no puede alcanzar.
    if (value.type === "JSXExpressionContainer") visit(inner, ctx);
  }

  function visitChild(node: Node, ctx: Context): void {
    if (node.type === "JSXText") {
      if (ctx.opaque) return;
      const raw = code.slice(node.start, node.end);
      const text = jsxTextValue(raw);
      if (text.trim() === "") return;
      const decoded = decodeEntities(text);
      if (decoded === undefined) {
        report.unknownEntities.push(text);
        return;
      }
      if (blocked(decoded)) return;
      edit(node.start, node.end, `{${llamada(decoded)}}`);
      report.sites.push({ kind: "jsx-text", key: decoded });
      return;
    }
    if (node.type === "JSXExpressionContainer") {
      const expression = node.expression as Node | undefined;
      if (!ctx.opaque) wrap(expression, "jsx-child");
      if (expression) visit(expression, ctx);
      return;
    }
    visit(node, ctx);
  }

  /**
   * Un nombre fuera de las listas que sí llevaba un literal de texto. No se
   * marca nada: se cuenta, y el reporte de la fase 3 lo lista por cantidad. Es
   * la cola de la que sale la cobertura de los cortes que vengan.
   */
  function countUncovered(into: Map<string, number>, name: string, value: Node | undefined): void {
    const literal = stringLiteral(value);
    if (literal === undefined || !/[a-zA-Z]/.test(literal)) return;
    into.set(name, (into.get(name) ?? 0) + 1);
  }

  visit(ast, { opaque: false, inDecl: false });
  for (const argument of plan.returns) wrapReturn(argument);

  if (edits.size === 0) return { code: null, report };

  // Se descartan las anidadas: ordenadas por inicio y, a igual inicio, de
  // mayor a menor, la primera de cada grupo es la que contiene a las demás.
  const ordered = [...edits.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: string[] = [IMPORT];
  let at = 0;
  for (const { start, end, text } of ordered) {
    if (start < at) continue;
    parts.push(code.slice(at, start), text);
    at = end;
  }
  parts.push(code.slice(at));
  return { code: parts.join(""), report };
}
