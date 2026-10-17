// @vitest-environment jsdom
/**
 * Verificación de punta a punta del overlay en un entorno de navegador.
 *
 * Cubre el criterio de aceptación de CHA-5: se elige español rioplatense, se
 * "recarga" la página (volver a evaluar los módulos) y sigue en español.
 *
 * `overlay.ts` resuelve el idioma una sola vez, al cargarse, así que cada caso
 * reinicia los módulos y los importa de nuevo: eso es exactamente lo que hace
 * una recarga del navegador.
 *
 * Esa recarga es cara y escribe sobre estado global, que es de donde salió la
 * fragilidad que midió CHA-28 §1 y que arregla CHA-29. Tres piezas la acotan,
 * y las tres están abajo con su explicación: el presupuesto de tiempo del
 * archivo (`TEST_BUDGET_MS`), la recarga atada al caso que la pidió
 * (`itWithReload`) y los módulos de upstream importados bajo pedido, que es lo
 * que bajó el caso más lento de 3,2 s a 2,8 s y el archivo entero de 21,5 s a
 * 4,4 s de tests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "./language";

/**
 * El presupuesto de tiempo del archivo.
 *
 * Medido en CHA-28 §1: con la máquina ociosa el caso más lento usaba el 82 %
 * de los 5.000 ms que Vitest da por defecto. No es que fallara a veces: estaba
 * calibrado para fallar en cuanto la máquina tuviera algo más que hacer. Cada
 * caso vuelve a evaluar el overlay y los mapas de etiquetas de upstream, que
 * es trabajo real y no se puede abaratar hasta cero.
 *
 * La variable de entorno existe para una sola cosa: volver a correr la prueba
 * del rojo mentiroso sin depender de que la máquina esté cargada.
 * `ES_AR_TEST_TIMEOUT=50` aborta 12 a 14 de los 20 casos, según la máquina, y
 * lo que hay que ver es que lo que salga sea **timeout y nada más**: si
 * aparece una falla de afirmación, o un error sin dueño, volvió el bicho de
 * CHA-28 §1. (El
 * `--testTimeout` de la línea de comandos no sirve para eso: este `setConfig`
 * lo pisa.)
 */
const DEFAULT_BUDGET_MS = 20_000;
const CONFIGURED_BUDGET_MS = Number(process.env.ES_AR_TEST_TIMEOUT);
const TEST_BUDGET_MS = Number.isFinite(CONFIGURED_BUDGET_MS)
  ? CONFIGURED_BUDGET_MS
  : DEFAULT_BUDGET_MS;
vi.setConfig({ testTimeout: TEST_BUDGET_MS, hookTimeout: TEST_BUDGET_MS });

type Overlay = typeof import("./overlay");

interface Reloaded {
  overlay: Overlay;
  /**
   * Los mapas de etiquetas de upstream, bajo pedido: los importa sólo el caso
   * que los mira, porque volver a evaluarlos es la parte cara de la recarga.
   *
   * Se resuelven contra el registro de módulos de la **última** recarga, así
   * que se piden antes de volver a recargar.
   */
  taskViews: () => Promise<typeof import("@/lib/task-views")>;
  issueFilters: () => Promise<typeof import("@/lib/issue-filters")>;
}

interface LoadOptions {
  stored?: string | null;
  languages?: readonly string[];
  search?: string;
  /**
   * `false` deja la bandera apagada: así es el build de upstream, donde el
   * plugin no corre y nadie llama a `markOverlayInstalled()`.
   */
  install?: boolean;
}

type Reload = (options?: LoadOptions) => Promise<Reloaded>;

/**
 * Una promesa que no se resuelve nunca.
 *
 * Es cómo termina la continuación de un caso que ya murió: estacionada, sin
 * tocar nada. Ver `itWithReload`.
 */
function abandon<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** Lo arma `itWithReload`; `afterEach` lo usa para cerrar el caso que corrió. */
let closeLiveCase: (() => void) | null = null;

/**
 * Un caso con su propia recarga, acotada a su turno.
 *
 * Por qué no alcanza con una función suelta: `reload()` toca **estado global**
 * —el registro de módulos de Vitest, el espía de `navigator.languages`,
 * `localStorage`, la URL—. Cuando un caso se aborta por tiempo, Vitest lo da
 * por terminado pero su continuación sigue viva: el `for` que tenía adentro
 * arranca otra vuelta y vuelve a resetear módulos y a espiar `navigator`,
 * encima del caso siguiente, que ya los dejó armados. Eso es lo que producía
 * `AssertionError: en-US: expected 'es-AR' to be 'en'` (CHA-28 §1): un rojo que
 * señala al diccionario o al blindaje cuando la causa es el reloj.
 *
 * El `reload` que recibe el cuerpo sabe de qué caso es, porque lo cierra
 * léxicamente. En cuanto `afterEach` cierra el caso, esa recarga deja de
 * escribir: se estaciona y la continuación huérfana muere ahí, sin pisar nada.
 * El caso aborta por timeout —que es verdad y se arregla con tiempo— en vez de
 * mentir en el caso de al lado.
 */
function itWithReload(name: string, body: (reload: Reload) => Promise<void>): void {
  it(name, async () => {
    let live = true;
    closeLiveCase = () => {
      live = false;
    };
    await body(reloadFor(() => live));
  });
}

/**
 * Simula una carga de página: estado del navegador + módulos frescos.
 *
 * `markOverlayInstalled()` se llama **antes** de importar los módulos de
 * upstream, porque sus mapas de etiquetas llaman a `tEs` en el cuerpo del
 * módulo. Antes de ADR 0002 lo encendía el shim de JSX al cargarse; el shim se
 * borró, así que acá se enciende a mano. En el navegador y en cualquier build
 * que pase por el plugin lo enciende la bandera de build.
 *
 * Toda escritura sobre estado global va detrás de `live()`, y se vuelve a
 * mirar después de cada `await`: es lo único que separa "mi caso sigue
 * corriendo" de "mi caso ya lo abortaron y estoy escribiendo sobre el próximo".
 */
function reloadFor(live: () => boolean): Reload {
  const whileLive = async <T,>(load: () => Promise<T>): Promise<T> => {
    if (!live()) return abandon<T>();
    const loaded = await load();
    return live() ? loaded : abandon<T>();
  };

  return async function reload(options: LoadOptions = {}): Promise<Reloaded> {
    const { stored = null, languages = ["en-US"], search = "", install = true } = options;
    if (!live()) return abandon<Reloaded>();

    window.localStorage.clear();
    if (stored !== null) window.localStorage.setItem(STORAGE_KEY, stored);

    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages as string[]);
    window.history.replaceState({}, "", `/${search}`);

    vi.resetModules();
    const overlay = await whileLive(() => import("./overlay"));
    if (install) overlay.markOverlayInstalled();

    return {
      overlay,
      taskViews: () => whileLive(() => import("@/lib/task-views")),
      issueFilters: () => whileLive(() => import("@/lib/issue-filters")),
    };
  };
}

afterEach(() => {
  // Primero cerrar el caso: lo que quede vivo de él tiene que dejar de
  // escribir antes de que se desarmen los espías, no después.
  closeLiveCase?.();
  closeLiveCase = null;
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/**
 * Lo que acá probaba el shim —que una cadena de texto, un array de texto y un
 * atributo de texto salieran traducidos al DOM— ya no vive en un shim: vive en
 * el marcado. Se prueba en dos archivos, y más fuerte que antes:
 *
 * - `mark-text.test.ts`: qué literal del código fuente es un sitio de texto y
 *   qué no, sobre los 1.268 archivos reales;
 * - `real-components.es-ar.test.tsx`: componentes reales de upstream, marcados
 *   por el plugin, rindiendo en es-AR con datos que colisionan a propósito.
 *
 * Lo que queda acá es lo que no depende del marcado: la búsqueda, el
 * interruptor, la cadena de respaldo y los formatos.
 */
describe("la búsqueda sobre lo que el marcado deja en el código", () => {
  itWithReload("traduce la cadena marcada y no toca el identificador técnico", async (reload) => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.translate("Dashboard")).toBe("Panel");
    expect(overlay.translate("Save")).toBe("Guardar");
    expect(overlay.translate("Search tasks...")).toBe("Buscar tareas…");
    // `in_review` sólo aparece dentro de `<code>`, que el transform no marca: no
    // llega nunca a esta función. Y si llegara, el diccionario no lo tiene.
    expect(overlay.translate("in_review")).toBe("in_review");
  });

  itWithReload("en inglés no toca nada", async (reload) => {
    const { overlay } = await reload({ stored: "en" });
    expect(overlay.translate("Dashboard")).toBe("Dashboard");
  });
});

describe("formatos con el overlay puesto (ADR 0002 §7.5)", () => {
  itWithReload("sin formato en el diccionario vuelve a armar el inglés", async (reload) => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.formatted(["Invite people to ", ""], ["Acme"])).toBe("Invite people to Acme");
  });

  itWithReload(
    "el valor interpolado no pasa por el diccionario, ni si es una entrada",
    async (reload) => {
      const { overlay } = await reload({ stored: "es-AR" });
      // El agente se llama "Search", que es una entrada del diccionario. Sale tal
      // como se escribió: es la invariante de §4 en el camino de los formatos.
      expect(overlay.formatted(["Invite people to ", ""], ["Search"])).toBe(
        "Invite people to Search",
      );
      expect(overlay.translate("Search")).toBe("Buscar");
    },
  );

  // Los formatos los carga el Traductor (§10.2). Mientras el diccionario no
  // tenga ninguno, el caso se saltea en vez de pasar en falso recorriendo una
  // lista de cero, igual que el de la capa neutra.
  itWithReload("un formato cargado gana, con los valores pegados sin traducir", async (reload) => {
    const { overlay } = await reload({ stored: "es-AR" });
    const formats = overlay.layerEntries("es-AR").formats;
    if (formats.size === 0) return;
    for (const [key, translation] of formats) {
      const shape = key.split(/\{\d+\}/);
      const values = shape.slice(0, -1).map((_, i) => `Search${i}`);
      expect(overlay.formatted(shape, values), key).toBe(
        translation.replace(/\{(\d+)\}/g, (_, i) => values[Number(i)] ?? ""),
      );
    }
  });
});

describe("criterio de aceptación: elegir, recargar, sigue en español", () => {
  itWithReload("una elección guardada sobrevive la recarga", async (reload) => {
    // Carga 1: navegador en inglés, sin preferencia → inglés.
    const first = await reload({ languages: ["en-US"] });
    expect(first.overlay.activeUiLocale()).toBe("en");
    expect(first.overlay.translate("Cancel")).toBe("Cancel");

    // La persona elige español rioplatense en el selector.
    first.overlay; // el selector llama a storeUiLocale y recarga
    const { storeUiLocale } = await import("./language");
    storeUiLocale("es-AR");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("es-AR");

    // Carga 2 (la recarga): mismo navegador en inglés, pero ya hay elección.
    const second = await reload({
      stored: window.localStorage.getItem(STORAGE_KEY),
      languages: ["en-US"],
    });
    expect(second.overlay.activeUiLocale()).toBe("es-AR");
    expect(second.overlay.translate("Cancel")).toBe("Cancelar");
  });

  itWithReload(
    "el parámetro de URL gana sobre lo guardado (interruptor de emergencia)",
    async (reload) => {
      const { overlay } = await reload({ stored: "es-AR", search: "?lang=en" });
      expect(overlay.activeUiLocale()).toBe("en");
      expect(overlay.translate("Cancel")).toBe("Cancel");
    },
  );
});

describe("detección del idioma del navegador", () => {
  itWithReload("un navegador en español ve español sin tocar nada", async (reload) => {
    for (const languages of [["es-AR"], ["es"], ["es-ES", "en-US"], ["es-MX"]]) {
      const { overlay } = await reload({ languages });
      expect(overlay.activeUiLocale(), languages.join(",")).toBe("es-AR");
      expect(overlay.translate("In progress")).toBe("En curso");
    }
  });

  itWithReload("cualquier otro navegador ve inglés", async (reload) => {
    for (const languages of [["en-US"], ["fr-FR"], ["ja"], []]) {
      const { overlay } = await reload({ languages });
      expect(overlay.activeUiLocale(), languages.join(",")).toBe("en");
      expect(overlay.translate("In progress")).toBe("In progress");
    }
  });

  itWithReload(
    "el build de upstream queda en inglés aunque el navegador esté en español",
    async (reload) => {
      // El interruptor del ADR §10: "volver al build de siempre deja la app en
      // inglés". Sin la bandera de build, el idioma del navegador alcanzaba para
      // encender `tEs` en los mapas de etiquetas de upstream, y el build en
      // inglés mostraba media interfaz en español sin selector para volver —
      // porque el selector también se esconde cuando el overlay no está.
      //
      // `install: false` es lo que hace la prueba: la recarga **no** llama a
      // `markOverlayInstalled()`, así que la bandera queda en `false` igual que
      // en el build de upstream, donde el plugin no corre.
      const { overlay, taskViews } = await reload({
        languages: ["es-AR", "es"],
        install: false,
      });

      expect(overlay.isOverlayInstalled()).toBe(false);
      expect(overlay.activeUiLocale()).toBe("en");
      expect(overlay.tEs("issues.priority.high", "High")).toBe("High");
      expect(overlay.translate("In progress")).toBe("In progress");

      const byKey = Object.fromEntries(
        (await taskViews()).TASK_VIEW_GROUPS.flatMap((group) =>
          group.views.map((view) => [view.key, view.label] as const),
        ),
      );
      expect(byKey.blocked).toBe("Blocked");
      expect(byKey.done).toBe("Done");
    },
  );
});

describe("los homógrafos quedan con la traducción de su sentido", () => {
  itWithReload("las vistas de tareas usan el plural de filtro", async (reload) => {
    const { taskViews } = await reload({ stored: "es-AR" });
    const labels = (await taskViews()).TASK_VIEW_GROUPS.flatMap((group) =>
      group.views.map((view) => [view.key, view.label] as const),
    );
    const byKey = Object.fromEntries(labels);
    expect(byKey.blocked).toBe("Bloqueadas");
    expect(byKey.active).toBe("Activas");
    expect(byKey.done).toBe("Terminadas");
  });

  itWithReload("los presets de filtro también", async (reload) => {
    const { issueFilters } = await reload({ stored: "es-AR" });
    const labels = (await issueFilters()).issueQuickFilterPresets.map((preset) => preset.label);
    expect(labels).toEqual(["Todas", "Activas", "Backlog", "Terminadas"]);
  });

  itWithReload("en inglés las etiquetas de upstream no cambian", async (reload) => {
    const { taskViews, issueFilters } = await reload({ languages: ["en-US"] });
    const byKey = Object.fromEntries(
      (await taskViews()).TASK_VIEW_GROUPS.flatMap((group) =>
        group.views.map((view) => [view.key, view.label] as const),
      ),
    );
    expect(byKey.blocked).toBe("Blocked");
    expect(byKey.done).toBe("Done");
    expect((await issueFilters()).issueQuickFilterPresets.map((preset) => preset.label)).toEqual([
      "All",
      "Active",
      "Backlog",
      "Done",
    ]);
  });

  itWithReload(
    "el estado y el botón Done dicen lo mismo a propósito (CHA-15)",
    async (reload) => {
      const { overlay } = await reload({ stored: "es-AR" });
      // La capa literal no puede distinguir el chip del botón, porque indexa por
      // texto: las etiquetas del menú de estado y de los encabezados del tablero
      // se derivan del valor técnico y le llegan como `"Done"` suelto, igual que
      // los seis botones de "listo, terminé" de upstream. Unificar el singular
      // en "Listo" (decisión del Lead en CHA-15, H-2) es lo que hace que el
      // homógrafo deje de existir en vez de administrarse.
      expect(overlay.translate("Done")).toBe("Listo");
      expect(overlay.tEs("issues.status.done", "Done")).toBe("Listo");
      // El plural sigue siendo el de la colección: son vistas y filtros de
      // tareas, no el nombre del estado.
      expect(overlay.tEs("navigation.taskViews.done", "Done")).toBe("Terminadas");
      expect(overlay.tEs("issues.filter.done", "Done")).toBe("Terminadas");
    },
  );

  itWithReload("blocked se dice igual por las dos capas (CHA-15)", async (reload) => {
    const { overlay } = await reload({ stored: "es-AR" });
    // H-1: antes `"Blocked"` no tenía entrada literal y quedaba en inglés en el
    // menú de estado y en el tablero, al lado de cinco etiquetas traducidas.
    expect(overlay.translate("Blocked")).toBe("Bloqueada");
    expect(overlay.tEs("issues.status.blocked", "Blocked")).toBe("Bloqueada");
    expect(overlay.tEs("navigation.taskViews.blocked", "Blocked")).toBe("Bloqueadas");
  });

  itWithReload(
    "Backlog se queda en inglés como etiqueta de estado (glosario §8.3)",
    async (reload) => {
      const { overlay } = await reload({ stored: "es-AR" });
      // No es un hueco del diccionario: es la decisión 9.3, escalada al dueño
      // como pregunta de glosario. Si se agrega la entrada literal hay que
      // cambiar el documento primero.
      expect(overlay.translate("Backlog")).toBe("Backlog");
    },
  );

  itWithReload("la prioridad es femenina y el esfuerzo del modelo masculino", async (reload) => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.tEs("issues.priority.high", "High")).toBe("Alta");
    expect(overlay.tEs("issues.priority.low", "Low")).toBe("Baja");
    // El esfuerzo llega al JSX como cadena suelta y lo toma el diccionario.
    expect(overlay.translate("High")).toBe("Alto");
    expect(overlay.translate("Low")).toBe("Bajo");
  });

  itWithReload(
    "Org es la empresa en el encabezado y el organigrama en el ítem de nav",
    async (reload) => {
      const { overlay } = await reload({ stored: "es-AR" });
      expect(overlay.tEs("navigation.sidebar.orgSection", "Org")).toBe("Empresa");
      expect(overlay.tEs("navigation.sidebar.orgChart", "Org")).toBe("Organigrama");
    },
  );
});

describe("el selector de idioma", () => {
  itWithReload("se esconde si el overlay no está en el bundle", async (reload) => {
    // Nadie enciende la bandera: es el build de upstream.
    const { overlay } = await reload({ install: false });
    expect(overlay.isOverlayInstalled()).toBe(false);
  });

  itWithReload("aparece cuando el overlay está puesto", async (reload) => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.isOverlayInstalled()).toBe(true);
  });
});
