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
  };
}

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
