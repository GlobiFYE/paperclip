import path from "node:path";
import type { Plugin } from "vite";

import { markText } from "./mark-text";

/**
 * Marca el texto de interfaz de `ui/src` en tiempo de compilación (ADR 0002).
 *
 * Se activa sólo desde `ui/vite.config.es-ar.ts`, así que `vite.config.ts` de
 * upstream no se toca y el build de siempre sigue produciendo la app en
 * inglés, intacta. Un árbol de fuentes, dos salidas.
 *
 * No hay `resolveId`: el shim del runtime de JSX se borró con ADR 0002. Nada
 * nuestro corre en el camino de render de React —el costo es de build y la
 * cadena ya viene resuelta— y, sobre todo, el dato que escribe una persona o un
 * agente ya no pasa por ninguna máquina nuestra.
 */

const UI_ROOT = path.resolve(import.meta.dirname, "..", "..");
const OVERLAY = path.resolve(import.meta.dirname, "overlay.ts");

/**
 * La marca de la bandera "el overlay está en este bundle" en `overlay.ts`.
 *
 * Se reescribe el código en vez de usar `define` porque `vite dev` **no**
 * sustituye los `define` en los módulos de fuente (verificado en Vite 8.2.2),
 * y la bandera tiene que valer lo mismo en dev que en el build: de eso depende
 * que `tEs` traduzca en los mapas de etiquetas de upstream, que corren en el
 * cuerpo del módulo.
 */
const IN_BUNDLE_MARKER = "/* paperclip-es-ar:in-bundle */ false";
const IN_BUNDLE_ON = "/* paperclip-es-ar:in-bundle */ true";

const MARK = /\.tsx?$/;

/**
 * Qué archivos se marcan. Son 1.268 de los 2.023 de `ui/src` (§6.3).
 *
 * - `*.test.tsx` y `src/fixtures/**`: en un test, un literal inglés es una
 *   **fixture**, o sea un dato. Marcarlo haría que el test se mintiera a sí
 *   mismo. Dejándolos afuera, los tests de es-AR prueban justamente lo que hay
 *   que probar: que el dato no se traduce.
 * - `i18n-es-ar/**`: si se marcara `overlay.ts` se marcaría a sí mismo. Se deja
 *   afuera todo el directorio salvo `LanguageSelector.tsx`, que es interfaz y se
 *   traduce como cualquier otra.
 */
export function marks(id: string): boolean {
  if (!MARK.test(id)) return false;
  if (!id.includes("/src/")) return false;
  if (/\.test\.tsx?$|\.stories\.|\/src\/fixtures\//.test(id)) return false;   // ← fixtures y tests son datos
  if (id.includes("/i18n-es-ar/") && !id.endsWith("LanguageSelector.tsx")) return false;
  return true;
}

export function paperclipEsArTextMarking(): Plugin {
  return {
    name: "paperclip-es-ar-marcado-de-texto",
    enforce: "pre",
    /**
     * Corre con `enforce: "pre"`, así que ve el TypeScript sin transformar: el
     * marcado se hace sobre el código que escribió upstream, que es la única
     * forma de distinguir una etiqueta de un dato (§4).
     */
    transform(code, id) {
      const file = id.split("?")[0] as string;

      // Enciende la bandera del overlay. Si la marca no está, es un error y no
      // un apagado silencioso: sin ella el build es-AR saldría en inglés y
      // nadie se daría cuenta hasta producción.
      if (file === OVERLAY) {
        if (!code.includes(IN_BUNDLE_MARKER)) {
          throw new Error(
            `paperclip-es-ar: no se encontró la marca \`${IN_BUNDLE_MARKER}\` en ` +
              `${OVERLAY}. Sin esa marca el overlay queda apagado y la interfaz ` +
              `sale en inglés sin avisar.`,
          );
        }
        return { code: code.replace(IN_BUNDLE_MARKER, IN_BUNDLE_ON), map: null };
      }

      if (!marks(file)) return null;
      const marked = markText(
        code,
        file.endsWith("x") ? "tsx" : "ts",
        path.relative(UI_ROOT, file).split(path.sep).join("/"),
      );
      return marked === null ? null : { code: marked, map: null };
    },
  };
}
