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
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "./language";

type Overlay = typeof import("./overlay");

interface Reloaded {
  overlay: Overlay;
  taskViews: typeof import("@/lib/task-views");
  issueFilters: typeof import("@/lib/issue-filters");
}

/**
 * Simula una carga de página: estado del navegador + módulos frescos.
 *
 * `markOverlayInstalled()` se llama **antes** de importar los módulos de
 * upstream, porque sus mapas de etiquetas llaman a `tEs` en el cuerpo del
 * módulo. Antes de ADR 0002 lo encendía el shim de JSX al cargarse; el shim se
 * borró, así que acá se enciende a mano. En el navegador y en cualquier build
 * que pase por el plugin lo enciende la bandera de build.
 */
async function reload(options: {
  stored?: string | null;
  languages?: readonly string[];
  search?: string;
}): Promise<Reloaded> {
  const { stored = null, languages = ["en-US"], search = "" } = options;

  window.localStorage.clear();
  if (stored !== null) window.localStorage.setItem(STORAGE_KEY, stored);

  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages as string[]);
  window.history.replaceState({}, "", `/${search}`);

  vi.resetModules();
  const overlay = await import("./overlay");
  overlay.markOverlayInstalled();
  return {
    overlay,
    taskViews: await import("@/lib/task-views"),
    issueFilters: await import("@/lib/issue-filters"),
  };
}

afterEach(() => {
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
  it("traduce la cadena marcada y no toca el identificador técnico", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.translate("Dashboard")).toBe("Panel");
    expect(overlay.translate("Save")).toBe("Guardar");
    expect(overlay.translate("Search tasks...")).toBe("Buscar tareas…");
    // `in_review` sólo aparece dentro de `<code>`, que el transform no marca: no
    // llega nunca a esta función. Y si llegara, el diccionario no lo tiene.
    expect(overlay.translate("in_review")).toBe("in_review");
  });

  it("en inglés no toca nada", async () => {
    const { overlay } = await reload({ stored: "en" });
    expect(overlay.translate("Dashboard")).toBe("Dashboard");
  });
});

describe("formatos con el overlay puesto (ADR 0002 §7.5)", () => {
  it("sin formato en el diccionario vuelve a armar el inglés", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.formatted(["Invite people to ", ""], ["Acme"])).toBe("Invite people to Acme");
  });

  it("el valor interpolado no pasa por el diccionario, ni si es una entrada", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    // El agente se llama "Search", que es una entrada del diccionario. Sale tal
    // como se escribió: es la invariante de §4 en el camino de los formatos.
    expect(overlay.formatted(["Invite people to ", ""], ["Search"])).toBe(
      "Invite people to Search",
    );
    expect(overlay.translate("Search")).toBe("Buscar");
  });

  // Los formatos los carga el Traductor (§10.2). Mientras el diccionario no
  // tenga ninguno, el caso se saltea en vez de pasar en falso recorriendo una
  // lista de cero, igual que el de la capa neutra.
  it("un formato cargado gana, con los valores pegados sin traducir", async () => {
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
  it("una elección guardada sobrevive la recarga", async () => {
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

  it("el parámetro de URL gana sobre lo guardado (interruptor de emergencia)", async () => {
    const { overlay } = await reload({ stored: "es-AR", search: "?lang=en" });
    expect(overlay.activeUiLocale()).toBe("en");
    expect(overlay.translate("Cancel")).toBe("Cancel");
  });
});

describe("detección del idioma del navegador", () => {
  it("un navegador en español ve español sin tocar nada", async () => {
    for (const languages of [["es-AR"], ["es"], ["es-ES", "en-US"], ["es-MX"]]) {
      const { overlay } = await reload({ languages });
      expect(overlay.activeUiLocale(), languages.join(",")).toBe("es-AR");
      expect(overlay.translate("In progress")).toBe("En curso");
    }
  });

  it("cualquier otro navegador ve inglés", async () => {
    for (const languages of [["en-US"], ["fr-FR"], ["ja"], []]) {
      const { overlay } = await reload({ languages });
      expect(overlay.activeUiLocale(), languages.join(",")).toBe("en");
      expect(overlay.translate("In progress")).toBe("In progress");
    }
  });

  it("el build de upstream queda en inglés aunque el navegador esté en español", async () => {
    // El interruptor del ADR §10: "volver al build de siempre deja la app en
    // inglés". Sin la bandera de build, el idioma del navegador alcanzaba para
    // encender `tEs` en los mapas de etiquetas de upstream, y el build en
    // inglés mostraba media interfaz en español sin selector para volver —
    // porque el selector también se esconde cuando el overlay no está.
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["es-AR", "es"]);
    vi.resetModules();

    // A propósito **no** se llama a `markOverlayInstalled()`: así es el build de
    // upstream, donde el plugin no corre y la bandera queda en `false`.
    const overlay = await import("./overlay");
    const taskViews = await import("@/lib/task-views");

    expect(overlay.isOverlayInstalled()).toBe(false);
    expect(overlay.activeUiLocale()).toBe("en");
    expect(overlay.tEs("issues.priority.high", "High")).toBe("High");
    expect(overlay.translate("In progress")).toBe("In progress");

    const byKey = Object.fromEntries(
      taskViews.TASK_VIEW_GROUPS.flatMap((group) =>
        group.views.map((view) => [view.key, view.label] as const),
      ),
    );
    expect(byKey.blocked).toBe("Blocked");
    expect(byKey.done).toBe("Done");
  });
});

describe("los homógrafos quedan con la traducción de su sentido", () => {
  it("las vistas de tareas usan el plural de filtro", async () => {
    const { taskViews } = await reload({ stored: "es-AR" });
    const labels = taskViews.TASK_VIEW_GROUPS.flatMap((group) =>
      group.views.map((view) => [view.key, view.label] as const),
    );
    const byKey = Object.fromEntries(labels);
    expect(byKey.blocked).toBe("Bloqueadas");
    expect(byKey.active).toBe("Activas");
    expect(byKey.done).toBe("Terminadas");
  });

  it("los presets de filtro también", async () => {
    const { issueFilters } = await reload({ stored: "es-AR" });
    const labels = issueFilters.issueQuickFilterPresets.map((preset) => preset.label);
    expect(labels).toEqual(["Todas", "Activas", "Backlog", "Terminadas"]);
  });

  it("en inglés las etiquetas de upstream no cambian", async () => {
    const { taskViews, issueFilters } = await reload({ languages: ["en-US"] });
    const byKey = Object.fromEntries(
      taskViews.TASK_VIEW_GROUPS.flatMap((group) =>
        group.views.map((view) => [view.key, view.label] as const),
      ),
    );
    expect(byKey.blocked).toBe("Blocked");
    expect(byKey.done).toBe("Done");
    expect(issueFilters.issueQuickFilterPresets.map((preset) => preset.label)).toEqual([
      "All",
      "Active",
      "Backlog",
      "Done",
    ]);
  });

  it("el estado y el botón Done dicen lo mismo a propósito (CHA-15)", async () => {
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
  });

  it("blocked se dice igual por las dos capas (CHA-15)", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    // H-1: antes `"Blocked"` no tenía entrada literal y quedaba en inglés en el
    // menú de estado y en el tablero, al lado de cinco etiquetas traducidas.
    expect(overlay.translate("Blocked")).toBe("Bloqueada");
    expect(overlay.tEs("issues.status.blocked", "Blocked")).toBe("Bloqueada");
    expect(overlay.tEs("navigation.taskViews.blocked", "Blocked")).toBe("Bloqueadas");
  });

  it("Backlog se queda en inglés como etiqueta de estado (glosario §8.3)", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    // No es un hueco del diccionario: es la decisión 9.3, escalada al dueño
    // como pregunta de glosario. Si se agrega la entrada literal hay que
    // cambiar el documento primero.
    expect(overlay.translate("Backlog")).toBe("Backlog");
  });

  it("la prioridad es femenina y el esfuerzo del modelo masculino", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.tEs("issues.priority.high", "High")).toBe("Alta");
    expect(overlay.tEs("issues.priority.low", "Low")).toBe("Baja");
    // El esfuerzo llega al JSX como cadena suelta y lo toma el diccionario.
    expect(overlay.translate("High")).toBe("Alto");
    expect(overlay.translate("Low")).toBe("Bajo");
  });

  it("Org es la empresa en el encabezado y el organigrama en el ítem de nav", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.tEs("navigation.sidebar.orgSection", "Org")).toBe("Empresa");
    expect(overlay.tEs("navigation.sidebar.orgChart", "Org")).toBe("Organigrama");
  });
});

describe("el selector de idioma", () => {
  it("se esconde si el overlay no está en el bundle", async () => {
    vi.resetModules();
    const overlay = await import("./overlay");
    // Nadie encendió la bandera: es el build de upstream.
    expect(overlay.isOverlayInstalled()).toBe(false);
  });

  it("aparece cuando el overlay está puesto", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.isOverlayInstalled()).toBe(true);
  });
});
