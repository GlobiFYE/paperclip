/**
 * El reporte de cobertura del marcado (ADR 0002 §8, fase 3).
 *
 * Corre `markText` sobre todo `ui/src` y lista las cinco cosas que hacen que
 * ampliar cobertura sea **mirar una lista y no leer 700 componentes**:
 *
 *   1. entradas del diccionario que ningún sitio marcado produce, con la pista
 *      de por qué canal entrarían;
 *   2. nombres de atributo y de propiedad que llevan texto y no están en las
 *      listas, por cantidad — la cola de la que sale la cobertura del corte 2;
 *   3. textos de JSX salteados por una entidad fuera de la tabla;
 *   4. cadenas que la regla de la comparación (§7.4) bloqueó;
 *   5. entradas del diccionario que parecen técnicas, que es una violación de
 *      ADR 0001 §7.3.
 *
 * Reemplaza a la fase 3 de ADR 0001. Es también la herramienta de la fase 2: si
 * el listado 1 da exactamente las 11 entradas de §10, la fase 1 está bien.
 *
 *   cd ui && node src/i18n-es-ar/tools/report-text-sites.ts
 *
 * Dos cosas de plomería, y las dos por el mismo motivo —que esto es un script de
 * node y no un módulo del bundle:
 *
 * - el transform se carga por el **resolvedor de Vite**, el mismo que usa el
 *   build, porque todo `ui/src` importa sin extensión y node no resuelve eso;
 * - el diccionario se lee del disco en vez de importar `overlay.ts`, que importa
 *   JSON como módulo.
 *
 * Así el reporte corre sin build, sin navegador y sin una dependencia nueva.
 */

import fs from "node:fs";
import path from "node:path";

import { createServer } from "vite";

// `import type` se borra en runtime y lo resuelve tsc: el script queda tipado
// contra los módulos de verdad aunque los cargue por el resolvedor de Vite.
import type * as MarkText from "../mark-text";
import type * as TextSites from "../text-sites";
import type * as VitePlugin from "../vite-plugin";
import type { SiteKind } from "../mark-text";

const UI_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const server = await createServer({
  configFile: false,
  logLevel: "warn",
  server: { middlewareMode: true },
});
const load = async <T>(id: string): Promise<T> => (await server.ssrLoadModule(id)) as T;

const { markTextWithReport } = await load<typeof MarkText>("/src/i18n-es-ar/mark-text.ts");
const { TEXT_ATTRS, TEXT_KEYS } = await load<typeof TextSites>("/src/i18n-es-ar/text-sites.ts");
const { marks } = await load<typeof VitePlugin>("/src/i18n-es-ar/vite-plugin.ts");
const SRC = path.join(UI_ROOT, "src");
const DICTIONARY = path.join(SRC, "i18n-es-ar", "dictionary", "es-AR");

/** Una clave es de formato si tiene un hueco numerado (§7.5). */
const FORMAT_KEY = /\{\d+\}/;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC);
  out.sort();
  return out;
}

/** El diccionario es-AR tal como está en el disco, por archivo de área. */
function dictionary(): Map<string, { area: string; value: string }> {
  const out = new Map<string, { area: string; value: string }>();
  for (const name of fs.readdirSync(DICTIONARY).sort()) {
    if (!name.endsWith(".json") || name === "explicit.json") continue;
    const entries = JSON.parse(fs.readFileSync(path.join(DICTIONARY, name), "utf8")) as Record<
      string,
      string
    >;
    for (const [english, value] of Object.entries(entries)) out.set(english, { area: name, value });
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Por qué canal entraría una cadena que hoy no se marca.
 *
 * Es una clasificación textual sobre el código, no un segundo transform: lo que
 * hace falta del reporte es el **nombre** que habría que agregar a
 * `text-sites.ts`, y el nombre está al lado de la cadena en el archivo.
 */
function channels(value: string, files: readonly string[], sources: ReadonlyMap<string, string>): string[] {
  const quoted = escapeRegExp(JSON.stringify(value).slice(1, -1));
  const probes: [string, RegExp][] = [
    ["atributo", new RegExp(`([A-Za-z][\\w-]*)=\\{?["']${quoted}["']`)],
    // Un atributo cuya expresión elige entre literales: `value={x ? "A" : "B"}`.
    ["atributo", new RegExp(`([A-Za-z][\\w-]*)=\\{[^}\\n]*["']${quoted}["']`)],
    ["clave", new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*["']${quoted}["']`)],
    ["llamada", new RegExp(`([A-Za-z_$][\\w$.]*)\\(\\s*["']${quoted}["']`)],
    ["texto de JSX", new RegExp(`>[\\s]*${escapeRegExp(value)}[\\s]*<`)],
  ];
  const found = new Set<string>();
  for (const file of files) {
    const code = sources.get(file) as string;
    if (!code.includes(value)) continue;
    const where = marks(file) ? "producción" : "sólo test/fixture";
    let matched = false;
    for (const [kind, probe] of probes) {
      const hit = probe.exec(code);
      if (!hit) continue;
      matched = true;
      const name = hit[1];
      found.add(name ? `${kind} \`${name}\` (${where})` : `${kind} (${where})`);
    }
    if (!matched) found.add(`en el código sin sitio reconocible (${where}: ${rel(file)})`);
  }
  return [...found].sort();
}

function rel(file: string): string {
  return path.relative(UI_ROOT, file).split(path.sep).join("/");
}

function byCount(counts: ReadonlyMap<string, number>): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function main(): void {
  const files = sourceFiles();
  const sources = new Map(files.map((file) => [file, fs.readFileSync(file, "utf8")]));
  const marked = files.filter((file) => marks(file));

  const literals = new Set<string>();
  const formats = new Set<string>();
  const trimmed = new Set<string>();
  const byKind = new Map<SiteKind, number>();
  const unknownEntities: { file: string; text: string }[] = [];
  const blocked = new Map<string, Set<string>>();
  const attrs = new Map<string, number>();
  const keys = new Map<string, number>();
  let edited = 0;
  let blockedMarks = 0;

  for (const file of marked) {
    const lang = file.endsWith("x") ? "tsx" : "ts";
    const { code, report } = markTextWithReport(sources.get(file) as string, lang, rel(file));
    if (code !== null) edited++;
    for (const site of report.sites) {
      byKind.set(site.kind, (byKind.get(site.kind) ?? 0) + 1);
      // Una marca sin clave estática es un retorno derivado (`statusLabel`): se
      // cuenta como sitio, pero no produce ninguna cadena que cruzar.
      if (site.key === "") continue;
      if (site.kind === "format") formats.add(site.key);
      else {
        literals.add(site.key);
        if (site.key.trim() !== site.key) trimmed.add(site.key.trim());
      }
    }
    for (const text of report.unknownEntities) unknownEntities.push({ file: rel(file), text });
    for (const value of report.blocked) {
      blockedMarks++;
      if (!blocked.has(value)) blocked.set(value, new Set());
      (blocked.get(value) as Set<string>).add(rel(file));
    }
    for (const [name, count] of report.uncoveredNames.attrs) {
      attrs.set(name, (attrs.get(name) ?? 0) + count);
    }
    for (const [name, count] of report.uncoveredNames.keys) {
      keys.set(name, (keys.get(name) ?? 0) + count);
    }
  }

  const dict = dictionary();
  const uncovered: string[] = [];
  for (const english of dict.keys()) {
    const covered = FORMAT_KEY.test(english)
      ? formats.has(english)
      : literals.has(english) || trimmed.has(english);
    if (!covered) uncovered.push(english);
  }

  const out: string[] = [];
  const say = (line = "") => out.push(line);

  say("# Reporte de sitios de texto (ADR 0002 §8, fase 3)");
  say();
  say(`archivos de ui/src: ${files.length} · marcados por el plugin: ${marked.length} · con ediciones: ${edited}`);
  say(
    `sitios marcados: ${[...byKind.values()].reduce((a, b) => a + b, 0)} (` +
      byCount(byKind as ReadonlyMap<string, number>)
        .map(([kind, count]) => `${kind} ${count}`)
        .join(" · ") +
      ")",
  );
  say(`cadenas distintas marcadas: ${literals.size} · formatos distintos: ${formats.size}`);
  say(
    `diccionario es-AR: ${dict.size} entradas · cubiertas ${dict.size - uncovered.length} · ` +
      `sin cubrir ${uncovered.length}`,
  );

  say();
  say(`## 1. Entradas del diccionario que ningún sitio marcado produce (${uncovered.length})`);
  say();
  if (uncovered.length === 0) say("(ninguna)");
  for (const english of uncovered) {
    const entry = dict.get(english) as { area: string; value: string };
    say(`- "${english}" → "${entry.value}"  [${entry.area}]`);
    const hints = channels(english, files, sources);
    say(`    canal: ${hints.length === 0 ? "no aparece en ui/src" : hints.join(" · ")}`);
  }

  say();
  say("## 2. Nombres con texto literal que no están en las listas, por cantidad");
  say();
  say("### atributos de JSX");
  for (const [name, count] of byCount(attrs).slice(0, 40)) {
    say(`- ${name}: ${count}${TEXT_ATTRS.has(name) ? "  (¡ya está en TEXT_ATTRS!)" : ""}`);
  }
  say();
  say("### claves de propiedad");
  for (const [name, count] of byCount(keys).slice(0, 40)) {
    say(`- ${name}: ${count}${TEXT_KEYS.has(name) ? "  (¡ya está en TEXT_KEYS!)" : ""}`);
  }

  say();
  say(`## 3. Textos de JSX salteados por una entidad fuera de la tabla (${unknownEntities.length})`);
  say();
  if (unknownEntities.length === 0) say("(ninguno: la tabla cubre las que existen hoy)");
  for (const { file, text } of unknownEntities) say(`- ${file}: ${JSON.stringify(text)}`);

  say();
  say(
    `## 4. Cadenas que la regla de la comparación bloqueó ` +
      `(${blockedMarks} marcas, ${blocked.size} cadenas distintas)`,
  );
  say();
  const inDictionary = [...blocked.keys()].filter((value) => dict.has(value)).sort();
  say(`en el diccionario: ${inDictionary.length === 0 ? "(ninguna)" : inDictionary.map((v) => `"${v}"`).join(", ")}`);
  say();
  for (const [value, where] of [...blocked.entries()].sort((a, b) => b[1].size - a[1].size)) {
    say(`- ${JSON.stringify(value)}: ${where.size} archivo(s)${dict.has(value) ? "  ← en el diccionario" : ""}`);
  }

  say();
  say("## 5. Entradas del diccionario que parecen técnicas (ADR 0001 §7.3)");
  say();
  say("El criterio de §8 es: sin espacios y con `_`, `/` o `.`, o todo en minúsculas.");
  say("Se anota por qué cayó cada una, porque un `...` al final también lo dispara.");
  say();
  const technical = [...dict.keys()].filter(
    (english) =>
      !english.includes(" ") && (/[_/.]/.test(english) || english === english.toLowerCase()),
  );
  if (technical.length === 0) say("(ninguna)");
  for (const english of technical) {
    const entry = dict.get(english) as { area: string; value: string };
    const why = english === english.toLowerCase() ? "todo en minúsculas" : "tiene `_`, `/` o `.`";
    say(`- "${english}" → "${entry.value}"  [${entry.area}] (${why})`);
  }

  process.stdout.write(out.join("\n") + "\n");
}

main();
await server.close();
