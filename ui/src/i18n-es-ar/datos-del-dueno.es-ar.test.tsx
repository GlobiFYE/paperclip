/**
 * La garantía del dueño, medida sobre el diccionario entero y sobre todo el
 * árbol marcado (CHA-28).
 *
 * `real-components.es-ar.test.tsx` prueba la invariante de §4 en 12 casos
 * elegidos a mano. Este archivo va por los dos lados que esos 12 casos no
 * pueden cubrir, que son justo los dos que el dueño aceptó:
 *
 * 1. **Exhaustivo por el lado del diccionario**: no 4 palabras que colisionan,
 *    sino **todas** las entradas de una sola palabra del diccionario completo
 *    (largas + cortas del corte 2), pasadas como nombre de agente, título de
 *    tarea y nombre de proyecto. El veredicto tiene que ser 0 traducidas de N.
 * 2. **Exhaustivo por el lado del código**: en vez de confiar en que los
 *    componentes elegidos son representativos, se marca **todo `ui/src`** y se
 *    revisa cada `__tEs(…)` que el marcado emite. Si el argumento de cada marca
 *    es un literal estático, entonces ningún dato de runtime puede llegar a
 *    `lookup()` **en ningún archivo**, y eso es la invariante de §4 probada
 *    sobre el árbol y no sobre una muestra.
 *
 * Como `real-components`, este archivo **no se marca** (§8/3), así que todo
 * literal que le pasa por props es, por construcción, un dato.
 */

import fs from "node:fs";
import path from "node:path";

import { FolderOpen } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";

import { isOverlayInstalled, layerEntries, lookup } from "./overlay";
import { markText } from "./mark-text";
import { marks } from "./vite-plugin";
import { PATTERNS } from "./patterns";

const withOverlay = isOverlayInstalled();

const UI_ROOT = path.resolve(import.meta.dirname, "..", "..");

async function load() {
  const overlay = await import("./overlay");
  expect(overlay.isOverlayInstalled(), "el overlay tiene que estar puesto").toBe(true);
  expect(overlay.activeUiLocale()).toBe("es-AR");
  return {
    AgentIdentity: await import("@/components/AgentIdentity"),
    EmptyState: await import("@/components/EmptyState"),
    ArtifactFileChip: await import("@/components/ArtifactFileChip"),
  };
}

/* ------------------------------------------------------------------ */
/* Herramientas de medición                                            */
/* ------------------------------------------------------------------ */

/** El texto visible de un render: sin etiquetas y sin valores de atributo. */
function textoVisible(html: string): string {
  return html.replace(/<[^>]*>/g, "\u0001");
}

/**
 * Los nodos de texto del render, uno por uno.
 *
 * Hace falta la comparación **exacta** por nodo y no un `includes`: hay
 * entradas cuyo español es subcadena de su inglés (`Role`→`Rol`,
 * `Creates`→`Crea`), así que buscar la traducción dentro del HTML da positivo
 * contra el dato **sin traducir**. Medido: con `includes` daban 2 falsos
 * positivos de 286 en los tres componentes.
 */
function nodosDeTexto(html: string): string[] {
  return textoVisible(html)
    .split("\u0001")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * ¿Se dio vuelta el dato? Lo decide por nodo exacto: el dato tiene que estar
 * tal como se escribió y ningún nodo puede ser la traducción.
 */
function seDioVuelta(html: string, dato: string, traduccion: string): boolean {
  const nodos = nodosDeTexto(html);
  return !nodos.includes(dato) || nodos.includes(traduccion);
}

/** Las entradas del diccionario es-AR que son **una sola palabra**. */
function unaSolaPalabra(): readonly [string, string][] {
  const { literals } = layerEntries("es-AR");
  const out: [string, string][] = [];
  for (const [english, spanish] of literals) {
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(english)) continue;
    // Si la traducción es la misma palabra (`Backlog`, `Max`), no hay nada que
    // medir: no se puede distinguir "no se tradujo" de "se tradujo igual".
    if (spanish === english) continue;
    out.push([english, spanish]);
  }
  return out;
}

/** Recorre los archivos de `ui/src` que el plugin marca. */
function archivosMarcados(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (marks(full.split(path.sep).join("/"))) {
        out.push(full);
      }
    }
  };
  walk(path.join(UI_ROOT, "src"));
  return out.sort();
}

interface Nodo {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function hijos(node: Nodo): Nodo[] {
  const out: Nodo[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && typeof (item as Nodo).type === "string") {
          out.push(item as Nodo);
        }
      }
    } else if (value && typeof value === "object" && typeof (value as Nodo).type === "string") {
      out.push(value as Nodo);
    }
  }
  return out;
}

function recorrer(node: Nodo, visit: (node: Nodo) => void): void {
  visit(node);
  for (const child of hijos(node)) recorrer(child, visit);
}

/** El nombre llamable de un callee: `__tEs`, `foo.bar`. */
function nombreDeLlamada(callee: Nodo | undefined): string | undefined {
  if (!callee) return undefined;
  if (callee.type === "Identifier") return callee.name as string;
  if (callee.type === "MemberExpression") {
    const object = nombreDeLlamada(callee.object as Nodo);
    const property = callee.property as Nodo | undefined;
    if (object && property?.type === "Identifier") return `${object}.${property.name as string}`;
  }
  return undefined;
}

interface Marca {
  file: string;
  /** El código del argumento, tal como quedó en la salida del marcado. */
  arg: string;
}

/**
 * Marca un archivo y devuelve las marcas `__tEs(…)` cuyo argumento **no** es un
 * literal de cadena, o sea las únicas por donde podría pasar un dato.
 */
function marcasNoLiterales(file: string): Marca[] {
  const code = fs.readFileSync(file, "utf8");
  const rel = path.relative(UI_ROOT, file).split(path.sep).join("/");
  const marked = markText(code, file.endsWith("x") ? "tsx" : "ts", rel);
  if (marked === null) return [];
  const ast = parseAst(marked, { lang: file.endsWith("x") ? "tsx" : "ts" }) as unknown as Nodo;
  const out: Marca[] = [];
  recorrer(ast, (node) => {
    if (node.type !== "CallExpression") return;
    if (nombreDeLlamada(node.callee as Nodo) !== "__tEs") return;
    const args = node.arguments as Nodo[];
    const first = args[0];
    if (first && first.type === "Literal" && typeof first.value === "string") return;
    out.push({ file: rel, arg: first ? marked.slice(first.start, first.end) : "(sin argumento)" });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. El diccionario entero como contenido del dueño                   */
/* ------------------------------------------------------------------ */

describe.runIf(withOverlay)("el diccionario entero como contenido del dueño", () => {
  it("todas las entradas de una sola palabra como nombre de agente: 0 traducidas", async () => {
    const { AgentIdentity } = await load();
    const palabras = unaSolaPalabra();
    // Si esto baja mucho, el barrido dejó de ser exhaustivo y hay que mirar por qué.
    expect(palabras.length).toBeGreaterThan(200);

    const dadasVuelta: string[] = [];
    for (const [english, spanish] of palabras) {
      const html = renderToStaticMarkup(
        <AgentIdentity.AgentIdentity agent={{ id: "a1", name: english }} />,
      );
      if (seDioVuelta(html, english, spanish)) dadasVuelta.push(`${english} → ${spanish}`);
    }
    expect(dadasVuelta, `nombres de agente traducidos (de ${palabras.length})`).toEqual([]);
  });

  it("todas las entradas de una sola palabra como título de tarea: 0 traducidas", async () => {
    const { EmptyState } = await load();
    const palabras = unaSolaPalabra();

    const dadasVuelta: string[] = [];
    for (const [english, spanish] of palabras) {
      const html = renderToStaticMarkup(
        <EmptyState.EmptyState icon={FolderOpen} title={english} message={english} />,
      );
      if (seDioVuelta(html, english, spanish)) dadasVuelta.push(`${english} → ${spanish}`);
    }
    expect(dadasVuelta, `títulos de tarea traducidos (de ${palabras.length})`).toEqual([]);
  });

  it("todas las entradas de una sola palabra como nombre de proyecto y de archivo: 0 traducidas", async () => {
    const { ArtifactFileChip } = await load();
    const palabras = unaSolaPalabra();

    const dadasVuelta: string[] = [];
    for (const [english, spanish] of palabras) {
      // `artifactFileDisplay` arma `"<proyecto> / <ruta>"` en runtime: es el
      // caso de dato compuesto, que ningún literal del código puede cubrir.
      const html = renderToStaticMarkup(
        <ArtifactFileChip.ArtifactFileChip
          workspaceFileRef={{ projectName: english, displayPath: `${english}.md` } as never}
        />,
      );
      if (seDioVuelta(html, `${english} / ${english}.md`, spanish)) {
        dadasVuelta.push(`${english} → ${spanish}`);
      }
    }
    expect(dadasVuelta, `nombres de proyecto traducidos (de ${palabras.length})`).toEqual([]);
  });

  it("las claves punteadas de explicit.json no se pueden disparar con un dato", async () => {
    const { AgentIdentity } = await load();
    // `tEs(clave, inglés)` resuelve por clave punteada. Un agente llamado
    // `issues.status.done` no puede entrar por ese canal: no hay sitio marcado
    // que use el nombre como clave.
    const { explicit } = layerEntries("es-AR");
    const dadasVuelta: string[] = [];
    for (const [key, spanish] of explicit) {
      const html = renderToStaticMarkup(
        <AgentIdentity.AgentIdentity agent={{ id: "a1", name: key }} />,
      );
      if (seDioVuelta(html, key, spanish)) dadasVuelta.push(`${key} → ${spanish}`);
    }
    expect(dadasVuelta).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. La capa de patrones, que es el peor caso                         */
/* ------------------------------------------------------------------ */

describe.runIf(withOverlay)("la capa de patrones con texto del usuario adentro", () => {
  /**
   * Un caso de dato por cada patrón de `patterns.ts`, armado desde el patrón
   * mismo: si mañana entra un patrón nuevo, este test lo prueba sin que nadie
   * tenga que acordarse de agregarlo.
   */
  const CASOS: readonly { entrada: string; patron: string }[] = PATTERNS["es-AR"].map(
    ({ match }) => ({
      // `(.+)` → `Deploy`, que es un nombre de tarea verosímil del dueño.
      entrada: match.source
        .replace(/^\^/, "")
        .replace(/\$$/, "")
        .replace(/\(\.\+\)/g, "Deploy")
        .replace(/\\\?/g, "?")
        .replace(/\\\./g, "."),
      patron: match.source,
    }),
  );

  it("los 9 patrones, con el texto del dueño adentro: ninguno se dispara", async () => {
    const { AgentIdentity, EmptyState } = await load();
    expect(CASOS.length).toBe(PATTERNS["es-AR"].length);

    const dadosVuelta: string[] = [];
    for (const { entrada, patron } of CASOS) {
      // Control: la cadena **sí** pega en el patrón, o sea el caso no es vacío.
      expect(lookup(entrada), `el caso de ${patron} tiene que pegar en el patrón`).not.toBe(entrada);

      for (const html of [
        renderToStaticMarkup(<AgentIdentity.AgentIdentity agent={{ id: "a", name: entrada }} />),
        renderToStaticMarkup(
          <EmptyState.EmptyState icon={FolderOpen} title={entrada} message="qa-sin-texto" />,
        ),
        renderToStaticMarkup(<EmptyState.EmptyState icon={FolderOpen} message={entrada} />),
      ]) {
        if (!nodosDeTexto(html).includes(entrada)) dadosVuelta.push(`${patron} → ${entrada}`);
      }
    }
    expect(dadosVuelta, "patrones disparados por un dato").toEqual([]);
  });

  it("una tarea titulada «Deploy is archived» sale tal cual", async () => {
    const { EmptyState, AgentIdentity } = await load();
    // El caso que pidió el Lead, escrito aparte para que se vea en el informe.
    expect(lookup("Deploy is archived")).toBe("Deploy quedó archivada");
    for (const html of [
      renderToStaticMarkup(
        <EmptyState.EmptyState
          icon={FolderOpen}
          title="Deploy is archived"
          message="qa-sin-texto"
        />,
      ),
      renderToStaticMarkup(
        <AgentIdentity.AgentIdentity agent={{ id: "a", name: "Deploy is archived" }} />,
      ),
    ]) {
      expect(textoVisible(html)).toContain("Deploy is archived");
      expect(textoVisible(html)).not.toContain("quedó archivada");
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Todo el árbol marcado: ¿puede llegar un dato a `lookup()`?        */
/* ------------------------------------------------------------------ */

describe("todo `ui/src` marcado: por dónde podría pasar un dato", () => {
  /**
   * Las marcas con argumento **no literal** son el canal de declaraciones de
   * `TEXT_DECLS`, que envuelve el `return` entero de una función declarada. Es
   * el único lugar donde una cadena de runtime puede llegar a `lookup()`, así
   * que la lista tiene que ser corta, conocida y revisada una por una.
   *
   * Si aparece una marca nueva acá, **no es una falla del diccionario**: es un
   * sitio nuevo por donde podría entrar un dato, y hay que mirarlo antes de
   * entregar.
   */
  const ESPERADAS: readonly string[] = [
    "src/components/KanbanBoard.tsx",
    "src/components/StatusIcon.tsx",
    "src/pages/CompanyEnvironments.tsx",
  ];

  it("el marcado corre sobre todo el árbol sin tirar", () => {
    const archivos = archivosMarcados();
    expect(archivos.length).toBeGreaterThan(1000);
    const porArchivo = new Map<string, Marca[]>();
    for (const file of archivos) {
      const marcas = marcasNoLiterales(file);
      if (marcas.length > 0) porArchivo.set(marcas[0]!.file, marcas);
    }
    expect([...porArchivo.keys()].sort()).toEqual([...ESPERADAS].sort());
  }, 180_000);

  it("ninguna de esas tres funciones puede devolver texto que escribió una persona", async () => {
    // El retorno envuelto deriva de un valor **técnico** del API, no de texto
    // libre: `statusLabel(status)` de un enum de 7 estados y
    // `environmentDeleteBlockMessage` de banderas booleanas. Así que incluso
    // envolviendo el retorno entero, lo que llega a `lookup()` sale de un
    // conjunto cerrado que el dueño no escribe.
    const { StatusIcon } = await import("@/components/StatusIcon");
    // Un estado que no existe no se traduce ni se rompe: cae al inglés.
    const html = renderToStaticMarkup(<StatusIcon status="Deploy is archived" showLabel />);
    expect(textoVisible(html)).not.toContain("quedó archivada");
  });
});
