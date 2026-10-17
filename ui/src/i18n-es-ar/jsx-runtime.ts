/**
 * El shim del runtime de JSX.
 *
 * El plugin de Vite hace que todo `ui/src` importe su `jsx`/`jsxs`/`jsxDEV`
 * desde acá. Cada cadena que React está a punto de renderizar —como texto de
 * un elemento o como atributo de texto— pasa por el diccionario antes de
 * llegar al DOM, y después se delega al runtime real de React.
 *
 * Ningún componente de upstream se toca.
 */

import { Fragment, jsx as origJsx, jsxs as origJsxs } from "react/jsx-runtime";
import { jsxDEV as origJsxDEV } from "react/jsx-dev-runtime";

import { markOverlayInstalled, translate } from "./overlay";

markOverlayInstalled();

/** Atributos cuyo valor es texto que lee una persona. */
const TEXT_PROPS = new Set(["placeholder", "title", "aria-label", "alt", "label"]);

/** Elementos cuyo contenido es código: no se traduce nunca (§7.3). */
const OPAQUE_TYPES = new Set(["code", "pre"]);

type Props = Record<string, unknown> | null | undefined;

function translateProps(type: unknown, props: Props): Props {
  if (!props || (typeof type === "string" && OPAQUE_TYPES.has(type))) return props;

  let out = props;
  const write = (key: string, value: unknown) => {
    // Copia al escribir: si no hay nada que traducir, el objeto de props
    // original sigue siendo el mismo y React no ve un cambio de identidad.
    if (out === props) out = { ...props };
    (out as Record<string, unknown>)[key] = value;
  };

  for (const key of Object.keys(props)) {
    const value = (props as Record<string, unknown>)[key];

    if (key === "children") {
      if (typeof value === "string") {
        const next = translate(value);
        if (next !== value) write("children", next);
      } else if (Array.isArray(value)) {
        let changed = false;
        const children = value.map((child: unknown) => {
          if (typeof child !== "string") return child;
          const next = translate(child);
          if (next !== child) changed = true;
          return next;
        });
        if (changed) write("children", children);
      }
      continue;
    }

    if (TEXT_PROPS.has(key) && typeof value === "string") {
      const next = translate(value);
      if (next !== value) write(key, next);
    }
  }

  return out;
}

type JsxFn = (type: unknown, props: Props, key?: unknown) => unknown;
type JsxDevFn = (
  type: unknown,
  props: Props,
  key: unknown,
  isStatic: boolean,
  source: unknown,
  self: unknown,
) => unknown;

export const jsx: JsxFn = (type, props, key) =>
  (origJsx as unknown as JsxFn)(type, translateProps(type, props), key);

export const jsxs: JsxFn = (type, props, key) =>
  (origJsxs as unknown as JsxFn)(type, translateProps(type, props), key);

// Los seis argumentos se reenvían tal cual: sin eso se pierden las ubicaciones
// de código (`fileName`, `lineNumber`) en desarrollo.
export const jsxDEV: JsxDevFn = (type, props, key, isStatic, source, self) =>
  (origJsxDEV as unknown as JsxDevFn)(
    type,
    translateProps(type, props),
    key,
    isStatic,
    source,
    self,
  );

export { Fragment };
