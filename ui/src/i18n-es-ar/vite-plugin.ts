import path from "node:path";
import type { Plugin } from "vite";

/**
 * Redirige `react/jsx-runtime` y `react/jsx-dev-runtime` al shim del overlay.
 *
 * Se activa sólo desde `ui/vite.config.es-ar.ts`, así que `vite.config.ts` de
 * upstream no se toca y el build de siempre sigue produciendo la app en
 * inglés, intacta. Un árbol de fuentes, dos salidas.
 */

const SHIM = path.resolve(import.meta.dirname, "jsx-runtime.ts");
const OVERLAY = path.resolve(import.meta.dirname, "overlay.ts");

const JSX_RUNTIMES = new Set(["react/jsx-runtime", "react/jsx-dev-runtime"]);

/**
 * La marca de la bandera "el overlay está en este bundle" en `overlay.ts`.
 *
 * Se reescribe el código en vez de usar `define` porque `vite dev` **no**
 * sustituye los `define` en los módulos de fuente (verificado en Vite 8.2.2),
 * y la bandera tiene que valer lo mismo en dev que en el build: de eso depende
 * que `tEs` traduzca en los mapas de etiquetas de upstream, que corren en el
 * cuerpo del módulo, antes de que haya pasado un solo JSX por el shim.
 */
const IN_BUNDLE_MARKER = "/* paperclip-es-ar:in-bundle */ false";
const IN_BUNDLE_ON = "/* paperclip-es-ar:in-bundle */ true";

export function localeOverlayJsxRuntime(): Plugin {
  return {
    name: "paperclip-es-ar-overlay-jsx-runtime",
    enforce: "pre",
    /**
     * Enciende la bandera del overlay. Corre con `enforce: "pre"`, así que ve
     * el TypeScript sin transformar y la marca sigue entera.
     *
     * Si la marca no está, es un error y no un apagado silencioso: sin ella el
     * build es-AR saldría en inglés y nadie se daría cuenta hasta producción.
     */
    transform(code, id) {
      if (id.split("?")[0] !== OVERLAY) return null;
      if (!code.includes(IN_BUNDLE_MARKER)) {
        throw new Error(
          `paperclip-es-ar: no se encontró la marca \`${IN_BUNDLE_MARKER}\` en ` +
            `${OVERLAY}. Sin esa marca el overlay queda apagado y la interfaz ` +
            `sale en inglés sin avisar.`,
        );
      }
      return { code: code.replace(IN_BUNDLE_MARKER, IN_BUNDLE_ON), map: null };
    },
    resolveId(source, importer) {
      if (!JSX_RUNTIMES.has(source)) return null;
      // El shim necesita el runtime real de React. Sin esta guarda se importa
      // a sí mismo y la recursión es infinita. No la saques.
      if (importer === SHIM) return null;
      return SHIM;
    },
  };
}
