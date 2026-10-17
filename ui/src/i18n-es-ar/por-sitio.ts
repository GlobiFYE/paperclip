/**
 * El mapa por sitio (ADR 0001 revisión 2 §14.2).
 *
 * El diccionario global de §7.2 le da **un** español a cada inglés en toda la
 * app. Eso alcanza para casi todo y falla justo en los homógrafos: `Open` es
 * «Abrir» en un botón y «Abierta» en un estado, y el marcado de ADR 0002 emite
 * `__tEs("Open")` sin decir en qué archivo está.
 *
 * Este mapa agrega esa dimensión, y **sólo** ésa:
 *
 * ```json
 * { "components/IssuesList.tsx": { "Open": "Abierta" } }
 * ```
 *
 * - La clave es **`archivo + inglés`, no la línea**. Es lo que la hace estable:
 *   upstream puede editar el archivo arriba y la entrada sigue pegando. Si
 *   upstream **renombra** el archivo, la entrada deja de pegar y la cadena
 *   vuelve al diccionario global o al inglés: **se degrada, no rompe**.
 * - El archivo es relativo a `ui/src/`, que es la forma en que está escrito el
 *   ADR (`pages/apps/AppDetail.tsx`, no `src/pages/apps/AppDetail.tsx`).
 * - La lista blanca de posiciones de `text-sites.ts` **sigue aplicando**: este
 *   mapa cambia la traducción de un sitio que ya se marca, nunca habilita un
 *   sitio nuevo.
 *
 * Dos límites que conviene tener a mano, los dos a propósito:
 *
 * 1. **Un archivo, un español por cadena.** Si el mismo inglés tiene dos
 *    sentidos *dentro del mismo archivo*, este mapa no los puede separar, y la
 *    salida correcta es **no poner la entrada** y dejar las dos en inglés. Ver
 *    `doc/i18n-es-ar/CHA-38-mapa-por-sitio.md`.
 * 2. **No llega al canal de declaraciones.** `TEXT_DECLS` envuelve el `return`
 *    entero de una función, así que lo que llega a buscarse no es un literal del
 *    archivo y el marcado no le pasa el sitio. `statusLabel("open")` → `"Open"`
 *    sigue resolviéndose por el diccionario global, que es exactamente por qué
 *    `Open` **no** puede tener entrada global.
 */

import mapaEsAr from "./dictionary/por-sitio/es-AR.json";
import { OVERLAY_LOCALES, type OverlayLocale } from "./language";

/**
 * La forma larga de §14.2. `forzar: true` habilitaría además posiciones que la
 * lista blanca no cubre; **no está implementado** en esta pasada y el cargador
 * falla fuerte si aparece, en vez de aceptarla y no hacer nada.
 */
export interface EntradaLarga {
  es: string;
  forzar?: boolean;
}

export type Entrada = string | EntradaLarga;

export type MapaPorSitio = Record<string, Record<string, Entrada>>;

/** `archivo` → `inglés` → español. */
type Capa = Map<string, Map<string, string>>;

function capa(locale: OverlayLocale, mapa: MapaPorSitio): Capa {
  const out: Capa = new Map();
  for (const [archivo, entradas] of Object.entries(mapa)) {
    if (archivo.startsWith("src/")) {
      throw new Error(
        `por-sitio (${locale}): la clave de archivo \`${archivo}\` empieza con ` +
          `\`src/\`. El mapa por sitio usa rutas relativas a \`ui/src/\` ` +
          `(ADR 0001 §14.2), así que esa entrada no pegaría nunca.`,
      );
    }
    const porIngles = new Map<string, string>();
    for (const [english, entrada] of Object.entries(entradas)) {
      if (typeof entrada === "string") {
        porIngles.set(english, entrada);
        continue;
      }
      if (entrada.forzar) {
        throw new Error(
          `por-sitio (${locale}): \`${archivo}\` → ${JSON.stringify(english)} usa ` +
            `\`forzar: true\`. Es la forma larga de ADR 0001 §14.2 y **no está ` +
            `implementada**: habilitar posiciones que la lista blanca no cubre ` +
            `cambia \`text-sites.ts\` y es una decisión aparte (CHA-38). Saca el ` +
            `\`forzar\` o agregá la posición a la lista blanca.`,
        );
      }
      porIngles.set(english, entrada.es);
    }
    out.set(archivo, porIngles);
  }
  return out;
}

const CAPAS: Record<OverlayLocale, Capa> = {
  "es-AR": capa("es-AR", mapaEsAr as MapaPorSitio),
  // La capa neutra todavía no tiene contenido, igual que en `overlay.ts`.
  es: new Map(),
};

/**
 * La clave de archivo del mapa a partir de lo que le pasa el marcado, que es la
 * ruta relativa a `ui/` (`src/components/IssueRow.tsx`).
 */
export function claveDeArchivo(file: string): string {
  return file.replace(/^src\//, "");
}

/**
 * El español de `english` en `archivo`, o `undefined` si ese archivo no tiene
 * entrada para esa cadena.
 *
 * Respeta los espacios del borde igual que `lookup()` (§7.1): el diccionario
 * guarda la forma sin espacios y acá se los volvemos a pegar. Sin esto,
 * `Installed · {n}` —cuyo nodo de texto es `"Installed · "`— no se podría
 * escribir en el mapa con la misma clave que usa el diccionario global.
 */
export function buscarPorSitio(
  locale: OverlayLocale,
  archivo: string,
  english: string,
): string | undefined {
  const porIngles = CAPAS[locale].get(archivo);
  if (porIngles === undefined) return undefined;

  const exacto = porIngles.get(english);
  if (exacto !== undefined) return exacto;

  const recortado = english.trim();
  if (recortado === english || recortado.length === 0) return undefined;
  const interno = porIngles.get(recortado);
  if (interno === undefined) return undefined;
  const lead = english.slice(0, english.indexOf(recortado[0] as string));
  return `${lead}${interno}${english.slice(lead.length + recortado.length)}`;
}

/**
 * Si **alguna** capa tiene entrada para `archivo + english`. Lo usa el marcado
 * para decidir si le pasa el sitio a `__tEs`: así la salida queda byte a byte
 * igual a la de hoy en todos los sitios que el mapa no menciona.
 */
export function hayEntradaPorSitio(archivo: string, english: string): boolean {
  for (const locale of OVERLAY_LOCALES) {
    if (buscarPorSitio(locale, archivo, english) !== undefined) return true;
  }
  return false;
}

/** Sólo para los tests y la bitácora: el mapa crudo de una capa. */
export function entradasPorSitio(locale: OverlayLocale): ReadonlyMap<string, ReadonlyMap<string, string>> {
  return CAPAS[locale];
}
