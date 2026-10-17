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

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "./language";

type Overlay = typeof import("./overlay");
type Shim = typeof import("./jsx-runtime");

interface Reloaded {
  overlay: Overlay;
  shim: Shim;
  taskViews: typeof import("@/lib/task-views");
  issueFilters: typeof import("@/lib/issue-filters");
}

/** Simula una carga de página: estado del navegador + módulos frescos. */
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
  return {
    overlay: await import("./overlay"),
    shim: await import("./jsx-runtime"),
    taskViews: await import("@/lib/task-views"),
    issueFilters: await import("@/lib/issue-filters"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("el shim traduce lo que llega al DOM", () => {
  it("traduce texto, arrays de texto y atributos de texto", async () => {
    const { shim } = await reload({ stored: "es-AR" });
    const { jsx, jsxs } = shim;

    const tree = jsxs("div", {
      title: "Save",
      children: [
        jsx("h1", { children: "Dashboard" }),
        jsx("input", { placeholder: "Search tasks..." }),
        jsx("span", { children: "Cancel" }),
        jsx("code", { children: "in_review" }),
      ],
    });

    const html = renderToStaticMarkup(tree as React.ReactElement);
    expect(html).toContain('title="Guardar"');
    expect(html).toContain("<h1>Panel</h1>");
    expect(html).toContain('placeholder="Buscar tareas…"');
    expect(html).toContain("<span>Cancelar</span>");
    // El identificador técnico dentro de <code> queda intacto.
    expect(html).toContain("<code>in_review</code>");
  });

  it("en inglés no toca nada", async () => {
    const { shim } = await reload({ stored: "en" });
    const html = renderToStaticMarkup(
      shim.jsx("h1", { children: "Dashboard" }) as React.ReactElement,
    );
    expect(html).toBe("<h1>Dashboard</h1>");
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

    // A propósito **no** se importa `./jsx-runtime`: así es el build de upstream.
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
  it("se esconde si el shim no está en el bundle", async () => {
    vi.resetModules();
    const overlay = await import("./overlay");
    // Sin importar `./jsx-runtime`, nadie llamó a markOverlayInstalled().
    expect(overlay.isOverlayInstalled()).toBe(false);
  });

  it("aparece cuando el shim está cargado", async () => {
    const { overlay } = await reload({ stored: "es-AR" });
    expect(overlay.isOverlayInstalled()).toBe(true);
  });
});
