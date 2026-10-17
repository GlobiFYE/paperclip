// @vitest-environment node
/**
 * El transform de marcado, como función pura (ADR 0002 §8/6).
 *
 * Lo que se prueba acá es la **frontera de traducción**: qué literal del código
 * fuente es texto de interfaz y qué no. Si una de estas afirmaciones se cae, la
 * invariante de §4 —el dato que escribe una persona no se puede traducir— dejó
 * de valer, y eso es lo único que este ADR existe para garantizar.
 *
 * Entorno `node` a propósito: `parseAst` es el parser de oxc que usa el bundler.
 */

import fs from "node:fs";
import path from "node:path";

import { parseAst } from "vite";
import { describe, expect, it } from "vitest";

import { decodeEntities, jsxTextValue, markText } from "./mark-text";
import { TEXT_DECLS } from "./text-sites";
import { marks } from "./vite-plugin";

const UI_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** El marcado de un fragmento `.tsx`, sin el `import` inyectado. */
function mark(code: string, file?: string): string {
  const out = markText(code, "tsx", file);
  if (out === null) return code;
  const first = out.indexOf(";") + 1;
  return out.slice(first);
}

/** `null` cuando no hubo nada que marcar: el archivo le llega a Vite intacto. */
function untouched(code: string, file?: string): boolean {
  return markText(code, "tsx", file) === null;
}

describe("texto de JSX (§7.2)", () => {
  it("marca el texto escrito entre etiquetas", () => {
    expect(mark("const a = <h1>Dashboard</h1>;")).toBe(
      'const a = <h1>{__tEs("Dashboard")}</h1>;',
    );
  });

  it("marca un literal dentro de un {…} en posición de hijo", () => {
    expect(mark('const a = <span>{"Cancel"}</span>;')).toBe(
      'const a = <span>{__tEs("Cancel")}</span>;',
    );
  });

  it("marca el literal de una rama de ?: y deja la otra si no es literal", () => {
    expect(mark("const a = <span>{open ? \"Close\" : label}</span>;")).toBe(
      'const a = <span>{open ? __tEs("Close") : label}</span>;',
    );
  });

  it("marca los dos lados de un && y de un ||", () => {
    expect(mark('const a = <span>{open && "Close"}</span>;')).toBe(
      'const a = <span>{open && __tEs("Close")}</span>;',
    );
  });

  it("conserva el espacio entre dos elementos hermanos", () => {
    // El espacio es un `JSXText` de un solo espacio: lo que React rinde. Si se
    // marcara, `<b>a</b><i>b</i>` quedarían pegados.
    expect(mark("const a = <p><b>a</b> <i>b</i></p>;")).toBe(
      'const a = <p><b>{__tEs("a")}</b> <i>{__tEs("b")}</i></p>;',
    );
  });

  it("no marca un texto de JSX que es sólo espacios o saltos de línea", () => {
    expect(untouched("const a = <p>\n  <b>{x}</b>\n</p>;")).toBe(true);
  });
});

describe("atributos y propiedades: lista blanca, nunca lista negra (§7.3)", () => {
  it("marca un atributo de la lista y le pone las llaves", () => {
    expect(mark('const a = <input placeholder="Search tasks" />;')).toBe(
      'const a = <input placeholder={__tEs("Search tasks")} />;',
    );
  });

  it("marca el atributo que ya venía entre llaves sin duplicarlas", () => {
    expect(mark('const a = <X title={"Save"} />;')).toBe(
      'const a = <X title={__tEs("Save")} />;',
    );
  });

  it("no marca ningún atributo fuera de la lista", () => {
    for (const attr of [
      "className", "to", "href", "type", "value", "id", "name", "data-kind",
      "path", "variant", "size", "role",
    ]) {
      expect(untouched(`const a = <X ${attr}="Save" />;`), attr).toBe(true);
    }
  });

  it("marca el valor de una clave de objeto de la lista", () => {
    expect(mark('const o = { label: "Save", className: "flex" };')).toBe(
      'const o = { label: __tEs("Save"), className: "flex" };',
    );
  });

  it("no marca las claves de objeto, ni cuando el nombre está en la lista", () => {
    // `{ "Search": … }` es una clave: no es texto que se rinda.
    expect(mark('const o = { "Search": "Save", label: 1 };')).toBe(
      'const o = { "Search": "Save", label: 1 };',
    );
  });

  it("marca el valor por defecto de un prop desestructurado (§10, FoldCurtain)", () => {
    expect(mark('function F({ moreLabel = "Show more" }) { return null; }')).toBe(
      'function F({ moreLabel = __tEs("Show more") }) { return null; }',
    );
  });

  it("no marca la fuente de un import ni de un export", () => {
    expect(untouched('import { x } from "./Save";')).toBe(true);
    expect(untouched('export { x } from "./Save";')).toBe(true);
  });
});

describe("llamadas (§7.2 y §7.3)", () => {
  it("marca los argumentos de una llamada de la lista", () => {
    expect(mark('window.confirm("Delete this?");')).toBe(
      'window.confirm(__tEs("Delete this?"));',
    );
    expect(mark('setActionError("Could not save.");')).toBe(
      'setActionError(__tEs("Could not save."));',
    );
  });

  it("no entra en ninguna otra llamada", () => {
    for (const call of ['t("key")', 'cn("flex")', 'fetch("/api/tasks")', 'f("Save")']) {
      expect(untouched(`const a = ${call};`), call).toBe(true);
    }
  });

  it("no entra en las llamadas que están en un sitio de texto", () => {
    // El sitio es de texto, pero la llamada no está en la lista: el argumento
    // es dato de ella, no texto del código.
    expect(untouched('const a = <X title={t("tasks.title")} />;')).toBe(true);
  });
});

describe("lo que nunca se marca (§7.3)", () => {
  it("no marca nada dentro de <code> ni de <pre>, a cualquier profundidad", () => {
    expect(untouched("const a = <code>in_review</code>;")).toBe(true);
    expect(untouched("const a = <pre><span>in_review</span></pre>;")).toBe(true);
    expect(untouched('const a = <pre><b title="Save">x</b></pre>;')).toBe(true);
    // Y el hermano de afuera sí se marca: lo opaco es el subárbol, no el
    // archivo. El espacio del borde viaja en la clave y lo resuelve `lookup`
    // (ADR 0001 §7.1), porque es el espacio que React rinde.
    expect(mark("const a = <p><code>in_review</code> Done</p>;")).toBe(
      'const a = <p><code>in_review</code>{__tEs(" Done")}</p>;',
    );
  });

  it("deja intacta una expresión que no es un literal: el dato no tiene dónde", () => {
    // Es la invariante de §4 en una línea. `agent.name` llega en tiempo de
    // ejecución, no es un literal del código y no hay dónde ponerle la llamada.
    expect(untouched("const a = <span>{agent.name}</span>;")).toBe(true);
    expect(untouched("const a = <X title={agent.name} />;")).toBe(true);
    expect(untouched("const a = <span>{items.map((i) => i.title)}</span>;")).toBe(true);
  });
});

describe("la regla de la comparación (§7.4)", () => {
  it("una cadena que el archivo compara con === no se marca en ningún sitio", () => {
    const code = 'if (x === "Done") {}\nconst a = <span>Done</span>;';
    expect(untouched(code)).toBe(true);
  });

  it("vale para case, !==, .includes y .startsWith", () => {
    for (const guard of [
      'switch (k) { case "Done": break; }',
      'if (k !== "Done") {}',
      'const b = list.includes("Done");',
      'const b = k.startsWith("Done");',
      'const b = map.get("Done");',
    ]) {
      expect(untouched(`${guard}\nconst a = <span>Done</span>;`), guard).toBe(true);
    }
  });

  it("sólo bloquea en el archivo que compara, y sólo esa cadena", () => {
    expect(mark('if (x === "Done") {}\nconst a = <span>Save</span>;')).toBe(
      'if (x === "Done") {}\nconst a = <span>{__tEs("Save")}</span>;',
    );
    expect(mark("const a = <span>Done</span>;")).toBe(
      'const a = <span>{__tEs("Done")}</span>;',
    );
  });
});

describe("formatos: interpolación por forma estática (§7.5)", () => {
  it("marca una plantilla con interpolación y conserva el valor interpolado", () => {
    expect(mark("const a = <p>{`Invite people to ${company}`}</p>;")).toBe(
      'const a = <p>{__tEsFmt(["Invite people to ", ""], [company])}</p>;',
    );
  });

  it("la forma estática es la clave, y el valor no pasa por el diccionario", () => {
    expect(mark("const a = <p>{`${n} item${n === 1 ? \"\" : \"s\"} found.`}</p>;")).toBe(
      'const a = <p>{__tEsFmt(["", " item", " found."], [n, n === 1 ? "" : "s"])}</p>;',
    );
  });

  it("una plantilla sin interpolación es un literal", () => {
    expect(mark("const a = <p>{`Dashboard`}</p>;")).toBe(
      'const a = <p>{__tEs("Dashboard")}</p>;',
    );
  });

  it("no marca la parte literal de una plantilla etiquetada", () => {
    expect(untouched("const a = css`color: Save;`;")).toBe(true);
  });
});

describe("la tabla de entidades (§8/1)", () => {
  it("decodifica las 15 entidades de la tabla", () => {
    expect(decodeEntities("Tasks &amp; Projects &rarr; Done")).toBe("Tasks & Projects → Done");
    expect(decodeEntities("It&rsquo;s &ldquo;x&rdquo; &middot; &hellip;")).toBe("It’s “x” · …");
    expect(decodeEntities("&lt;a&gt; &quot;b&quot; &apos;c&apos; &times; &rsaquo; &lsquo;")).toBe(
      "<a> \"b\" 'c' × › ‘",
    );
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });

  it("decodifica las numéricas, decimales y hexadecimales", () => {
    expect(decodeEntities("&#8594; &#x2192;")).toBe("→ →");
  });

  it("una entidad fuera de la tabla deja ese texto sin marcar", () => {
    expect(decodeEntities("a &copy; b")).toBeUndefined();
    expect(untouched("const a = <p>a &copy; b</p>;")).toBe(true);
  });

  it("la cadena marcada es la que React rinde, ya decodificada", () => {
    expect(mark("const a = <p>Tasks &amp; Projects</p>;")).toBe(
      'const a = <p>{__tEs("Tasks & Projects")}</p>;',
    );
  });

  it("un & que no es entidad no se toca: React lo rinde tal cual", () => {
    expect(decodeEntities("Tasks & Projects")).toBe("Tasks & Projects");
  });
});

describe("el valor de un texto de varias líneas", () => {
  it("jsxTextValue devuelve lo que React rinde", () => {
    expect(jsxTextValue("\n      Create your first\n      organization\n    ")).toBe(
      "Create your first organization",
    );
    expect(jsxTextValue("Hello ")).toBe("Hello ");
    expect(jsxTextValue("\n  Hello ")).toBe("Hello ");
    expect(jsxTextValue(" ")).toBe(" ");
  });

  it("marcar texto de varias líneas no corre ni una línea del archivo", () => {
    const code = [
      "const a = (",
      "  <h1>",
      "    Create your first",
      "    organization",
      "  </h1>",
      ");",
      "const después = 1;",
    ].join("\n");
    const out = markText(code, "tsx") as string;
    expect(out).not.toBeNull();
    expect(out).toContain('__tEs("Create your first organization")');
    // El `import` se inyecta en el offset 0 **sin** salto de línea, y cada
    // edición rellena los saltos del rango que reemplaza. Verificado en los 737
    // archivos reales que se reescriben: 0 corrimientos (§6.4).
    expect(countLines(out)).toBe(countLines(code));
    expect(lineOf(out, "const después = 1;")).toBe(lineOf(code, "const después = 1;"));
  });
});

describe("el canal de declaraciones (§7.2) y su guarda (§12)", () => {
  const FILE = "src/components/StatusIcon.tsx";

  it("envuelve el retorno de una función declarada, aunque no sea una cadena", () => {
    // `statusLabel` arma "In Progress" con dos `.replace()`: no hay literal. Es
    // la pérdida de §10.5, y se recupera envolviendo el retorno.
    const code = 'function statusLabel(s: string) {\n  return s.replace(/_/g, " ");\n}';
    expect(mark(code, FILE)).toBe(
      'function statusLabel(s: string) {\n  return __tEs(s.replace(/_/g, " "));\n}',
    );
  });

  it("no envuelve el retorno de una función anidada", () => {
    const code = [
      "function statusLabel(s: string) {",
      "  const f = () => { return s; };",
      "  return f();",
      "}",
    ].join("\n");
    const out = mark(code, FILE);
    expect(out).toContain("return __tEs(f());");
    expect(out).toContain("return s; };");
  });

  it("marca los literales de un const declarado, a cualquier profundidad, nunca las claves", () => {
    const file = "src/components/ActivityCharts.tsx";
    const code = 'const statusLabels = { done: "Done", nested: { label: "In review" } };';
    expect(mark(code, file)).toBe(
      'const statusLabels = { done: __tEs("Done"), nested: { label: __tEs("In review") } };',
    );
  });

  it("marca los dos formatos de la retención de backups sobre el archivo real (§10.2)", () => {
    // `"2 weeks"` y `"3 months"` no existen como literal: el código las arma con
    // `weeks === 1 ? "1 week" : \`${weeks} weeks\``. El canal de declaraciones
    // sobre `label` emite **los dos formatos**, y los singulares quedan como
    // literales. Lo que falta después es del Traductor, no de acá.
    const file = "src/pages/InstanceGeneralSettings.tsx";
    const out = markText(fs.readFileSync(path.join(UI_ROOT, file), "utf8"), "tsx", file) as string;
    expect(out).toContain('__tEsFmt(["", " weeks"], [weeks])');
    expect(out).toContain('__tEsFmt(["", " months"], [months])');
    expect(out).toContain('__tEs("1 week")');
    expect(out).toContain('__tEs("1 month")');
  });

  it("una declaración local que NO está en TEXT_DECLS queda en inglés (§6.6)", () => {
    // La prueba en negativo: si esto se marcara, el transform estaría marcando
    // más de lo que dice §7.2 y el canal de declaraciones no haría falta.
    expect(untouched('const statusLabels = { done: "Done" };')).toBe(true);
    // En el mismo archivo y a la misma altura: el nombre declarado se marca y
    // el de al lado no.
    const code = [
      'function statusLabel(s: string) { return s.replace(/_/g, " "); }',
      'const otroMapa = { done: "Done" };',
    ].join("\n");
    const out = mark(code, FILE);
    expect(out).toContain("return __tEs(s.replace");
    expect(out).toContain('const otroMapa = { done: "Done" };');
  });

  it("si el nombre no está en el archivo, falla el build con la ruta y el nombre", () => {
    expect(() => markText("const x = 1;", "tsx", FILE)).toThrow(/falta la declaración `statusLabel`/);
    expect(() => markText("const x = 1;", "tsx", FILE)).toThrow(/StatusIcon\.tsx/);
  });

  it("cada archivo de TEXT_DECLS tiene hoy todas sus declaraciones", () => {
    // Es la fase 2 del ADR convertida en test: un `git pull` que renombre algo
    // falla acá y en el build, no en producción.
    for (const decl of TEXT_DECLS) {
      const full = path.join(UI_ROOT, decl.file);
      const code = fs.readFileSync(full, "utf8");
      expect(
        () => markText(code, decl.file.endsWith("x") ? "tsx" : "ts", decl.file),
        decl.file,
      ).not.toThrow();
    }
  });
});

describe("sobre el código real de ui/src (§6.2 y §6.4)", () => {
  const files = sourceFiles();

  it("el plugin marca 1.268 de los 2.023 archivos de ui/src", () => {
    expect(files.all.length).toBeGreaterThan(2000);
    expect(files.marked.length).toBeGreaterThan(1200);
    // Los tests y las fixtures quedan afuera: en un test, un literal inglés es
    // un dato (§8/3).
    expect(files.marked.some((f) => f.endsWith(".test.tsx"))).toBe(false);
    expect(files.marked.some((f) => f.includes("/src/fixtures/"))).toBe(false);
    expect(files.marked.some((f) => f.endsWith("/i18n-es-ar/overlay.ts"))).toBe(false);
    expect(files.marked.some((f) => f.endsWith("/i18n-es-ar/LanguageSelector.tsx"))).toBe(true);
  });

  it("la salida vuelve a parsear y ningún archivo corre un número de línea", { timeout: 300_000 }, () => {
    const shifted: string[] = [];
    const failed: string[] = [];
    let edited = 0;
    for (const file of files.marked) {
      const code = fs.readFileSync(file, "utf8");
      const lang = file.endsWith("x") ? "tsx" : "ts";
      const relative = path.relative(UI_ROOT, file);
      const out = markText(code, lang, relative);
      if (out === null) continue;
      edited++;
      if (countLines(out) !== countLines(code)) shifted.push(relative);
      try {
        parseAst(out, { lang });
      } catch {
        failed.push(relative);
      }
    }
    expect(edited).toBeGreaterThan(700);
    expect(failed).toEqual([]);
    expect(shifted).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

function countLines(value: string): number {
  return value.split("\n").length;
}

function lineOf(value: string, needle: string): number {
  return value.slice(0, value.indexOf(needle)).split("\n").length;
}

function sourceFiles(): { all: string[]; marked: string[] } {
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) all.push(full);
    }
  };
  walk(path.join(UI_ROOT, "src"));
  all.sort();
  return { all, marked: all.filter((file) => marks(file)) };
}
