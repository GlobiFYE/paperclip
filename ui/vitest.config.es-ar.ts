import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";
import { localeOverlayJsxRuntime } from "./src/i18n-es-ar/vite-plugin";

/**
 * Config de tests con el overlay puesto, para probar componentes **reales** de
 * upstream en es-AR.
 *
 * `vitest.config.ts` de upstream no se toca y no carga plugins, así que los
 * 684 archivos de test de upstream siguen viendo inglés. Esta config es la
 * única que instala el shim, y corre sólo los tests marcados `.es-ar.test`.
 *
 *   pnpm --filter @paperclipai/ui exec vitest run --config vitest.config.es-ar.ts
 */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [localeOverlayJsxRuntime()],
    test: {
      environment: "jsdom",
      include: ["src/**/*.es-ar.test.{ts,tsx}"],
      // Corre después del setup de upstream y antes de los archivos de test:
      // el overlay resuelve el idioma al cargarse, así que hay que fijarlo acá.
      setupFiles: ["./src/i18n-es-ar/vitest.setup.es-ar.ts"],
    },
  }),
);
