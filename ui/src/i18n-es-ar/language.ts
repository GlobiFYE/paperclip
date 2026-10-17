/**
 * Resolución del idioma de la interfaz para el overlay es-AR.
 *
 * Implementa la cadena de respaldo `es-AR → es → en` del ADR 0001 y los
 * requisitos de CHA-5: detección del idioma del navegador como valor inicial,
 * persistencia entre recargas e inglés de respaldo.
 *
 * El inglés es la cadena fuente que vive en el código, así que "caer a `en`"
 * no es buscar en ningún diccionario: es dejar la cadena sin tocar. Por eso
 * `en` no es una capa del overlay, es la cadena vacía de capas.
 */

/** Las capas de traducción que existen, de la más específica a la más general. */
export const OVERLAY_LOCALES = ["es-AR", "es"] as const;

export type OverlayLocale = (typeof OVERLAY_LOCALES)[number];

/** Los idiomas que puede tener la interfaz. `en` es el código sin tocar. */
export type UiLocale = OverlayLocale | "en";

export const UI_LOCALES: readonly UiLocale[] = ["en", ...OVERLAY_LOCALES];

/** Clave de `localStorage`. Es la misma del interruptor de §10 del ADR. */
export const STORAGE_KEY = "paperclip.lang";

/** Parámetro de URL que gana sobre todo lo demás (interruptor de emergencia). */
export const URL_PARAM = "lang";

export const DEFAULT_UI_LOCALE: UiLocale = "en";

/**
 * La cadena de respaldo de un idioma, de la capa más específica a la más
 * general. `es-AR` consulta primero sus propias entradas y después las
 * neutras; `en` no consulta ninguna.
 */
export function localeChain(locale: UiLocale): readonly OverlayLocale[] {
  switch (locale) {
    case "es-AR":
      return ["es-AR", "es"];
    case "es":
      return ["es"];
    default:
      return [];
  }
}

/**
 * Lee una elección explícita (URL o `localStorage`). Es estricta a propósito:
 * `?lang=es` tiene que dar la capa neutra y no es-AR, porque es la forma de
 * probar la cadena de respaldo a mano.
 */
export function parseUiLocale(value: string | null | undefined): UiLocale | undefined {
  if (!value) return undefined;
  switch (value.trim().toLowerCase()) {
    case "es-ar":
      return "es-AR";
    case "es":
      return "es";
    case "en":
      return "en";
    default:
      return undefined;
  }
}

/**
 * El idioma que sugiere el navegador, con inglés de respaldo.
 *
 * Hoy es-AR es el único español que shipeamos: cualquier variante de español
 * arranca en es-AR, que cae a inglés por cadena faltante. Cuando exista una
 * capa `es` neutra con contenido, acá hay que devolver `"es"` para las
 * variantes que no sean `-AR`.
 */
export function localeFromBrowserTags(tags: readonly string[]): UiLocale {
  for (const tag of tags) {
    const lower = tag.trim().toLowerCase();
    if (lower === "es" || lower.startsWith("es-")) return "es-AR";
    if (lower === "en" || lower.startsWith("en-")) return "en";
  }
  return DEFAULT_UI_LOCALE;
}

function browserTags(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  const { languages, language } = navigator;
  if (languages && languages.length > 0) return languages;
  return language ? [language] : [];
}

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // `localStorage` tira en modo privado y con cookies bloqueadas.
    return null;
  }
}

/**
 * El idioma efectivo de esta carga de página. Precedencia: URL, después lo
 * guardado, después el navegador, después inglés.
 *
 * Fuera del navegador (tests en node, render en servidor) devuelve `en`: así
 * los tests de upstream siguen viendo inglés sin tocarlos.
 */
export function resolveUiLocale(): UiLocale {
  if (typeof window === "undefined") return DEFAULT_UI_LOCALE;

  const fromUrl = parseUiLocale(new URLSearchParams(window.location.search).get(URL_PARAM));
  if (fromUrl) return fromUrl;

  const fromStorage = parseUiLocale(readStoredLocale());
  if (fromStorage) return fromStorage;

  return localeFromBrowserTags(browserTags());
}

/**
 * Guarda la elección de idioma. No cambia la página: el overlay traduce en la
 * frontera de JSX y memoiza, así que el cambio se ve recargando. Quien llama
 * decide cuándo recargar.
 */
export function storeUiLocale(locale: UiLocale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Sin persistencia, el idioma vuelve a salir del navegador en la próxima
    // carga. Es degradado aceptable: no hay nada que avisarle a la persona.
  }
}
