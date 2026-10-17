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
import commonEsAr from "./dictionary/es-AR/common.json";
import connectionsEsAr from "./dictionary/es-AR/connections.json";
import errorsEsAr from "./dictionary/es-AR/errors.json";
import explicitEsAr from "./dictionary/es-AR/explicit.json";
import issuesEsAr from "./dictionary/es-AR/issues.json";
import navigationEsAr from "./dictionary/es-AR/navigation.json";
import onboardingEsAr from "./dictionary/es-AR/onboarding.json";
import projectsEsAr from "./dictionary/es-AR/projects.json";
import settingsEsAr from "./dictionary/es-AR/settings.json";

import commonEs from "./dictionary/es/common.json";
import explicitEs from "./dictionary/es/explicit.json";

type Dict = Record<string, string>;

interface Layer {
  /** Cadena inglesa exacta → traducción. */
  literals: Map<string, string>;
  /** Clave punteada → traducción (el escape de §7.5). */
  explicit: Map<string, string>;
  patterns: readonly Pattern[];
  /** Memo por capa: una cadena de entrada se resuelve una sola vez. */
  memo: Map<string, string>;
}

function layer(areas: readonly Dict[], explicit: Dict, patterns: readonly Pattern[]): Layer {
  const literals = new Map<string, string>();
  for (const area of areas) {
    for (const [english, translated] of Object.entries(area)) {
      literals.set(english, translated);
    }
  }
  return {
    literals,
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
 * El "apagado" no se cachea: en los tests el shim se importa después del
 * overlay, y cachear ahí dejaría el idioma clavado en inglés.
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
 * Lo que llama el shim de JSX para cada cadena que está a punto de llegar al
 * DOM. En inglés es la identidad y no cuesta una sola búsqueda.
 */
export function translate(value: string): string {
  const { locale, chain } = active();
  if (chain.length === 0) return value;
  return lookup(value, locale);
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
 * Lo llama `jsx-runtime.ts` al cargarse. Ese módulo sólo se carga cuando el
 * plugin de Vite redirige `react/jsx-runtime`, o sea en el build es-AR.
 *
 * La bandera de build ya alcanza en el navegador; esto además cubre los tests,
 * donde el shim se importa a mano sin pasar por el plugin.
 */
export function markOverlayInstalled(): void {
  installed = true;
}

/**
 * Si el overlay está en el bundle. El selector de idioma se esconde cuando no
 * lo está, para no ofrecer un control muerto en el build en inglés.
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

/** Sólo para los tests: las entradas crudas de una capa. */
export function layerEntries(locale: OverlayLocale): {
  literals: ReadonlyMap<string, string>;
  explicit: ReadonlyMap<string, string>;
  patterns: readonly Pattern[];
} {
  const target = LAYERS[locale];
  return { literals: target.literals, explicit: target.explicit, patterns: target.patterns };
}
