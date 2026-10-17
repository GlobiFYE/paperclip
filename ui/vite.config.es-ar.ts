import { defineConfig, type UserConfig, type UserConfigFnObject } from "vite";

import base from "./vite.config";
import { localeOverlayJsxRuntime } from "./src/i18n-es-ar/vite-plugin";

/**
 * La config del fork en es-AR: la de upstream más el plugin del overlay.
 *
 * `vite.config.ts` no se toca, así que un `git pull` de upstream no entra en
 * conflicto con nada nuestro.
 *
 *   # desarrollo en es-AR
 *   pnpm --filter @paperclipai/ui exec vite --config vite.config.es-ar.ts
 *   # build en es-AR (el que va al deploy del fork)
 *   pnpm --filter @paperclipai/ui exec vite build --config vite.config.es-ar.ts
 */
export default defineConfig(async (env) => {
  const resolved = (await (base as unknown as UserConfigFnObject)(env)) as UserConfig;
  return {
    ...resolved,
    plugins: [localeOverlayJsxRuntime(), ...(resolved.plugins ?? [])],
  };
});
