/**
 * Componentes **reales** de upstream renderizados con el overlay puesto, sin
 * una línea cambiada en ellos.
 *
 * Corre sólo con `vitest.config.es-ar.ts`, que es la única config que instala
 * el shim de JSX. Es la evidencia de que la traducción llega al DOM sobre el
 * código de upstream y no sólo sobre el diccionario.
 */

import { FolderOpen } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isOverlayInstalled } from "./overlay";

/**
 * `ui/vitest.config.ts` de upstream no se toca (ADR §11) y su `include` por
 * defecto agarra cualquier `*.test.tsx`, así que este archivo también se carga
 * ahí, sin shim y sin forma de traducir nada. Cuando eso pasa se saltea en vez
 * de fallar: la línea de base de upstream tiene que seguir verde.
 */
const withOverlay = isOverlayInstalled();

/**
 * El idioma lo fija `vitest.setup.es-ar.ts`, que corre antes de que se cargue
 * este archivo: el overlay resuelve el idioma al evaluarse, como en el
 * navegador.
 */
async function load() {
  const overlay = await import("./overlay");
  expect(overlay.isOverlayInstalled(), "el shim tiene que estar instalado").toBe(true);
  expect(overlay.activeUiLocale()).toBe("es-AR");
  return {
    StatusBadge: await import("@/components/StatusBadge"),
    EmptyState: await import("@/components/EmptyState"),
    StatusIcon: await import("@/components/StatusIcon"),
  };
}

/**
 * Los 7 estados como se ven en el menú de cambio de estado y en los
 * encabezados del tablero, en orden de `StatusIcon.tsx:8`.
 *
 * Es la lista que QA fotografió en CHA-9 y la que arregla CHA-15: antes decía
 * `Backlog · Por hacer · En curso · En revisión · Listo · Cancelada · Blocked`,
 * con dos etiquetas en inglés y un `done` que en el Panel se llamaba
 * "Terminada".
 */
const MENU_DE_ESTADO: readonly [string, string][] = [
  ["backlog", "Backlog"],
  ["todo", "Por hacer"],
  ["in_progress", "En curso"],
  ["in_review", "En revisión"],
  ["done", "Listo"],
  ["cancelled", "Cancelada"],
  ["blocked", "Bloqueada"],
];

describe.runIf(withOverlay)("StatusBadge (sin tocar el archivo de upstream)", () => {
  it("traduce la etiqueta de estado que el componente **deriva** del valor técnico", async () => {
    const { StatusBadge } = await load();

    // `IssueStatusBadge` no tiene ningún literal inglés: hace
    // sentenceCaseStatus("in_review") → "In review" (hallazgo 0.1 de CHA-4).
    // El overlay lo agarra igual, porque intercepta la cadena en la frontera
    // de JSX y no en el código fuente.
    const html = renderToStaticMarkup(<StatusBadge.IssueStatusBadge status="in_review" />);
    expect(html).toContain("En revisión");
    expect(html).not.toContain("In review");
  });

  it("traduce los otros estados derivados", async () => {
    const { StatusBadge } = await load();
    const cases: [string, string][] = [
      ["in_progress", "En curso"],
      ["in_review", "En revisión"],
    ];
    for (const [status, expected] of cases) {
      const html = renderToStaticMarkup(<StatusBadge.IssueStatusBadge status={status} />);
      expect(html, status).toContain(expected);
    }
  });

  it("no toca el valor técnico que se le pasa por prop", async () => {
    const { StatusBadge } = await load();
    const html = renderToStaticMarkup(<StatusBadge.StatusBadge status="in_review" label="Done" />);
    // La etiqueta visible se traduce…
    expect(html).toContain("Listo");
    // …y `status` sigue siendo el identificador de la API, que viaja en
    // atributos de estilo y clases, no como texto.
    expect(html).not.toContain("in revisión");
  });
});

describe.runIf(withOverlay)("StatusIcon — el menú de estado y el tablero (CHA-15)", () => {
  /**
   * `StatusIcon.tsx:10` deriva la etiqueta del valor técnico con
   * `status.replace(/_/g," ").replace(/\b\w/g, …)`, igual que
   * `KanbanBoard.tsx:134`, que es una copia byte a byte de la misma función.
   * O sea: **el menú de estado y los encabezados del tablero no leen de
   * `issueStatusLabels` ni de `statusLabels`**, les llega la cadena derivada y
   * la resuelve la capa literal. Ésa es la fuente de H-1 y H-2.
   *
   * Sin `onChange` el componente rinde el mismo `statusLabel(displayStatus)`
   * que el ítem del menú (`:149`) y que el encabezado de columna (`:207`
   * y `:221`), en la misma frontera de JSX.
   */
  it("los 7 estados salen traducidos y con un solo nombre cada uno", async () => {
    const { StatusIcon } = await load();
    for (const [status, expected] of MENU_DE_ESTADO) {
      const html = renderToStaticMarkup(<StatusIcon.StatusIcon status={status} showLabel />);
      expect(html, status).toContain(expected);
    }
  });

  it("no queda ninguna etiqueta de estado en inglés, salvo Backlog", async () => {
    const { StatusIcon } = await load();
    for (const [status] of MENU_DE_ESTADO) {
      const html = renderToStaticMarkup(<StatusIcon.StatusIcon status={status} showLabel />);
      for (const ingles of ["Todo", "In Progress", "In Review", "Done", "Cancelled", "Blocked"]) {
        expect(html, `${status} / ${ingles}`).not.toContain(`>${ingles}<`);
      }
    }
  });

  it("done y blocked dicen lo mismo acá que en la leyenda del Panel", async () => {
    const { StatusIcon } = await load();
    const { tEs } = await import("./overlay");
    // La leyenda del Panel (`ActivityCharts.tsx:244-245`) y la lista
    // (`IssuesList.tsx:141-142`) resuelven por estas dos claves punteadas.
    // Sus mapas no se exportan, así que lo que se compara es la fuente del
    // valor, que es la misma que leen ellos.
    for (const [status, key] of [
      ["done", "issues.status.done"],
      ["blocked", "issues.status.blocked"],
    ] as const) {
      const html = renderToStaticMarkup(<StatusIcon.StatusIcon status={status} showLabel />);
      expect(html, status).toContain(tEs(key, "no-deberia-caer-al-ingles"));
    }
    // El nombre viejo de `done` no sobrevive en ninguno de los dos caminos.
    expect(renderToStaticMarkup(<StatusIcon.StatusIcon status="done" showLabel />)).not.toContain("Terminada");
    expect(tEs("issues.status.done", "Done")).not.toBe("Terminada");
  });
});

describe.runIf(withOverlay)("EmptyState (sin tocar el archivo de upstream)", () => {
  it("traduce el texto que le llega por props desde los llamadores", async () => {
    const { EmptyState } = await load();
    const html = renderToStaticMarkup(
      <EmptyState.EmptyState
        icon={FolderOpen}
        title="No projects found."
        message="Select an organization to view projects."
        action="Add"
        onAction={() => {}}
      />,
    );
    expect(html).toContain("No se encontró ningún proyecto.");
    expect(html).toContain("Elegí una empresa para ver los proyectos.");
    expect(html).toContain("Agregar");
  });
});
