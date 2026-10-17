import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";
import { paperclipEsArTextMarking } from "./src/i18n-es-ar/vite-plugin";

/**
 * Config de tests con el overlay puesto, para probar componentes **reales** de
 * upstream en es-AR.
 *
 * `vitest.config.ts` de upstream no se toca y no carga plugins, así que los
 * 684 archivos de test de upstream siguen viendo inglés. Esta config es la
 * única que marca el texto, y corre sólo los tests marcados `.es-ar.test`.
 *
 * Y el archivo de test **no** se marca (§8/3: los tests son datos), así que un
 * literal inglés que el test le pasa por props es un dato y tiene que salir sin
 * traducir: es justo lo que hay que probar.
 *
 *   pnpm --filter @paperclipai/ui exec vitest run --config vitest.config.es-ar.ts
 */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [paperclipEsArTextMarking()],
    test: {
      environment: "jsdom",
      include: ["src/**/*.es-ar.test.{ts,tsx}"],
      // Corre después del setup de upstream y antes de los archivos de test:
      // el overlay resuelve el idioma al cargarse, así que hay que fijarlo acá.
      setupFiles: ["./src/i18n-es-ar/vitest.setup.es-ar.ts"],
    },
  }),
);
