/**
 * El overlay de traducción: búsqueda, memo e interruptor.
 *
 * La clave es la cadena en inglés exacta (ADR 0001 §7.1). El inglés no es una
 * capa: es lo que ya está en el código, así que "caer a inglés" es devolver la
 * cadena sin tocar.
 *
 * Nada de esto toca `ui/src/i18n/`: no agregamos claves a `locales/`, así que
 * `assertValidLocaleMessages` nunca ve nada nuestro.
 */

import {
  DEFAULT_UI_LOCALE,
  localeChain,
  OVERLAY_LOCALES,
  resolveUiLocale,
  type OverlayLocale,
  type UiLocale,
} from "./language";
import { PATTERNS, type Pattern } from "./patterns";

import agentsEsAr from "./dictionary/es-AR/agents.json";
import artifactsEsAr from "./dictionary/es-AR/artifacts.json";
import auditEsAr from "./dictionary/es-AR/audit.json";
import commonEsAr from "./dictionary/es-AR/common.json";
import connectionsEsAr from "./dictionary/es-AR/connections.json";
import dashboardEsAr from "./dictionary/es-AR/dashboard.json";
import errorsEsAr from "./dictionary/es-AR/errors.json";
import explicitEsAr from "./dictionary/es-AR/explicit.json";
import inboxEsAr from "./dictionary/es-AR/inbox.json";
import issuesEsAr from "./dictionary/es-AR/issues.json";
import navigationEsAr from "./dictionary/es-AR/navigation.json";
import onboardingEsAr from "./dictionary/es-AR/onboarding.json";
import projectsEsAr from "./dictionary/es-AR/projects.json";
import routinesEsAr from "./dictionary/es-AR/routines.json";
import searchEsAr from "./dictionary/es-AR/search.json";
import secretsEsAr from "./dictionary/es-AR/secrets.json";
import settingsEsAr from "./dictionary/es-AR/settings.json";
import skillsEsAr from "./dictionary/es-AR/skills.json";
import tracesEsAr from "./dictionary/es-AR/traces.json";

import commonEs from "./dictionary/es/common.json";
import explicitEs from "./dictionary/es/explicit.json";

type Dict = Record<string, string>;

interface Layer {
  /** Cadena inglesa exacta → traducción. */
  literals: Map<string, string>;
  /** Forma estática con huecos (`"Invite people to {0}"`) → traducción (§7.5). */
  formats: Map<string, string>;
  /** Clave punteada → traducción (el escape de §7.5). */
  explicit: Map<string, string>;
  patterns: readonly Pattern[];
  /** Memo por capa: una cadena de entrada se resuelve una sola vez. */
  memo: Map<string, string>;
}

/** Una clave es de formato si tiene un hueco numerado (ADR 0002 §7.5). */
const FORMAT_KEY = /\{\d+\}/;

function layer(areas: readonly Dict[], explicit: Dict, patterns: readonly Pattern[]): Layer {
  const literals = new Map<string, string>();
  const formats = new Map<string, string>();
  for (const area of areas) {
    for (const [english, translated] of Object.entries(area)) {
      // Los formatos viven en los mismos archivos de área que los literales, así
      // que no hay archivo nuevo ni forma nueva para el Traductor: se separan
      // acá, por la clave.
      if (FORMAT_KEY.test(english)) formats.set(english, translated);
      else literals.set(english, translated);
    }
  }
  return {
    literals,
    formats,
    explicit: new Map(Object.entries(explicit)),
    patterns,
    memo: new Map(),
  };
}

/**
 * Las capas, en archivos por área para que los diffs se puedan revisar
 * (ADR §7.2). Agregar un archivo de diccionario es agregarle el `import` acá:
 * es lo único que se toca de la máquina.
 */
const LAYERS: Record<OverlayLocale, Layer> = {
  "es-AR": layer(
    [
      commonEsAr,
      navigationEsAr,
      errorsEsAr,
      settingsEsAr,
      issuesEsAr,
      agentsEsAr,
      projectsEsAr,
      connectionsEsAr,
      onboardingEsAr,
      auditEsAr,
      tracesEsAr,
      skillsEsAr,
      routinesEsAr,
      searchEsAr,
      dashboardEsAr,
      inboxEsAr,
      artifactsEsAr,
      secretsEsAr,
    ],
    explicitEsAr,
    PATTERNS["es-AR"],
  ),
  // Capa neutra. Existe y está cableada, pero todavía no tiene contenido: lo
  // que entregó CHA-4 es es-AR (voseo), y escribir un español neutro es
  // trabajo de traducción, no de cableado. En cuanto tenga entradas, `es-AR`
  // las hereda sin tocar una línea de código.
  es: layer([commonEs], explicitEs, PATTERNS.es),
};

function resolveInLayer(target: Layer, value: string): string | undefined {
  const literal = target.literals.get(value);
  if (literal !== undefined) return literal;
  for (const { match, replace } of target.patterns) {
    if (match.test(value)) return value.replace(match, replace);
  }
  return undefined;
}

function resolveInChain(chain: readonly OverlayLocale[], value: string): string | undefined {
  for (const locale of chain) {
    const hit = resolveInLayer(LAYERS[locale], value);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * Busca `value` recorriendo la cadena de respaldo de `locale` y devuelve el
 * inglés sin tocar si no pega en ninguna capa.
 *
 * Puro y exportado para los tests: no mira el interruptor.
 */
export function lookup(value: string, locale: UiLocale = "es-AR"): string {
  const chain = localeChain(locale);
  if (chain.length === 0) return value;

  const head = LAYERS[chain[0] as OverlayLocale];
  const cached = head.memo.get(value);
  if (cached !== undefined) return cached;

  let resolved = resolveInChain(chain, value);

  if (resolved === undefined) {
    // Los espacios al borde se preservan: el diccionario guarda la forma sin
    // espacios y acá se los volvemos a pegar (§7.1).
    const trimmed = value.trim();
    if (trimmed !== value && trimmed.length > 0) {
      const inner = resolveInChain(chain, trimmed);
      if (inner !== undefined) {
        const lead = value.slice(0, value.indexOf(trimmed[0] as string));
        resolved = `${lead}${inner}${value.slice(lead.length + trimmed.length)}`;
      }
    }
  }

  const out = resolved ?? value;
  head.memo.set(value, out);
  return out;
}

/**
 * Si el overlay forma parte de **este** bundle.
 *
 * Queda en `false` en el árbol de fuentes y el plugin de Vite la reescribe a
 * `true` cuando el overlay entra al bundle, así que es constante de build y no
 * depende del orden en que se carguen los módulos. **La marca del comentario
 * es parte del contrato con el plugin: si se toca, el plugin falla a
 * propósito.**
 *
 * Tiene que ser constante de build y no `define` porque `vite dev` no
 * sustituye los `define` en los módulos de fuente, y el idioma tiene que ser
 * el mismo en dev que en el build.
 */
const OVERLAY_IN_BUNDLE: boolean = /* paperclip-es-ar:in-bundle */ false;

let installed = false;

interface Active {
  locale: UiLocale;
  chain: readonly OverlayLocale[];
}

const OFF: Active = { locale: DEFAULT_UI_LOCALE, chain: [] };

let cached: Active | undefined;

/**
 * El idioma efectivo, resuelto una sola vez.
 *
 * Se apaga por **bandera de build**, no por idioma del navegador. Es la
 * diferencia que importa: los mapas de etiquetas de upstream llaman a `tEs` en
 * el cuerpo del módulo, así que si el interruptor fuera el navegador, el build
 * en inglés de upstream le mostraría la mitad de la interfaz en español a
 * cualquiera con el navegador en español —y sin selector para volver, porque
 * el selector también se esconde cuando el overlay no está.
 *
 * El "apagado" no se cachea: en los tests `markOverlayInstalled()` se llama
 * después de importar el overlay, y cachear ahí dejaría el idioma clavado en
 * inglés.
 */
function active(): Active {
  if (cached) return cached;
  if (!OVERLAY_IN_BUNDLE && !installed) return OFF;
  const locale = resolveUiLocale();
  cached = { locale, chain: localeChain(locale) };
  return cached;
}

/** El idioma de esta carga de página. */
export function activeUiLocale(): UiLocale {
  return active().locale;
}

/**
 * Lo que el marcado deja en cada sitio de texto del código fuente (ADR 0002).
 * En inglés es la identidad y no cuesta una sola búsqueda.
 *
 * Acepta cualquier valor y devuelve lo que no sea cadena sin tocar: el canal de
 * declaraciones envuelve retornos, que pueden no ser cadenas —`statusLabel`
 * devuelve un `.replace()` y `environmentDeleteBlockMessage` devuelve `null`.
 */
export function translate<T>(value: T): T {
  if (typeof value !== "string") return value;
  const { locale, chain } = active();
  if (chain.length === 0) return value;
  return lookup(value, locale) as unknown as T;
}

/**
 * Formatos (ADR 0002 §7.5). La clave es la **forma estática** de la plantilla,
 * que es lo único que el compilador vio escrito; los valores interpolados se
 * pegan después y **nunca** pasan por el diccionario.
 *
 * ```tsx
 * <p>{`Invite people to ${company}`}</p>
 * // marcado:  __tEsFmt(["Invite people to ", ""], [company])
 * // clave:    "Invite people to {0}"  →  "Invitar gente a {0}"
 * ```
 *
 * Es lo que reemplaza a `patterns.ts`: un patrón anclado que corre contra
 * cualquier cadena del runtime vuelve traducibles infinitas cadenas de usuario;
 * un formato sólo puede pegar donde el código escribió esa plantilla.
 */
export function formatted(shape: readonly string[], values: readonly unknown[]): string {
  const raw = () =>
    shape.map((s, i) => s + (i < values.length ? String(values[i]) : "")).join("");
  const { chain } = active();
  if (chain.length === 0) return raw();
  const key = shape.map((s, i) => (i < shape.length - 1 ? `${s}{${i}}` : s)).join("");
  for (const locale of chain) {
    const tpl = LAYERS[locale].formats.get(key);
    if (tpl !== undefined) return tpl.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ""));
  }
  return raw();
}

/**
 * El escape de §7.5: clave punteada con el inglés como respaldo, para las
 * cadenas inglesas ambiguas que necesitan dos traducciones distintas según la
 * pantalla. Devuelve el inglés cuando el overlay está en inglés, así que la
 * app en inglés y los tests de upstream no cambian de comportamiento.
 */
export function tEs(key: string, english: string): string {
  for (const locale of active().chain) {
    const hit = LAYERS[locale].explicit.get(key);
    if (hit !== undefined) return hit;
  }
  return english;
}

/**
 * Enciende el overlay a mano. La bandera de build alcanza en el navegador y en
 * cualquier build que pase por el plugin; **su único llamador son los tests**,
 * que corren sin plugin (antes era el shim de JSX, que ADR 0002 borró).
 */
export function markOverlayInstalled(): void {
  installed = true;
}

/**
 * Si el overlay está en el bundle. El selector de idioma se esconde cuando no
 * lo está, para no ofrecer un control muerto en el build de upstream.
 */
export function isOverlayInstalled(): boolean {
  return OVERLAY_IN_BUNDLE || installed;
}

/** Sólo para los tests: vacía los memos entre casos. */
export function clearOverlayMemo(): void {
  for (const locale of OVERLAY_LOCALES) {
    LAYERS[locale].memo.clear();
  }
}

/** Sólo para los tests y el reporte de §8/fase 3: las entradas crudas de una capa. */
export function layerEntries(locale: OverlayLocale): {
  literals: ReadonlyMap<string, string>;
  formats: ReadonlyMap<string, string>;
  explicit: ReadonlyMap<string, string>;
  patterns: readonly Pattern[];
} {
  const target = LAYERS[locale];
  return {
    literals: target.literals,
    formats: target.formats,
    explicit: target.explicit,
    patterns: target.patterns,
  };
}
