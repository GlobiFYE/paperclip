// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CopilotLocalConfigFields } from "./config-fields";

beforeAll(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });

async function render(hideInstructionsFile: boolean): Promise<string> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <CopilotLocalConfigFields
            mode="edit"
            isCreate={false}
            adapterType="copilot_local"
            values={null}
            set={null}
            config={{}}
            eff={(_group, _field, original) => original}
            mark={() => undefined}
            models={[]}
            hideInstructionsFile={hideInstructionsFile}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  );
  const html = container.innerHTML;
  await act(async () => root.unmount());
  container.remove();
  return html;
}

describe("CopilotLocalConfigFields", () => {
  it("renders the switches but not the instructions field when hideInstructionsFile is set", async () => {
    const html = await render(true);
    expect(html).toContain('aria-label="Allow all paths"');
    expect(html).toContain('aria-label="Disable built-in MCP servers"');
    expect(html).not.toContain("Agent instructions file");
  });

  it("renders all three fields when hideInstructionsFile is false", async () => {
    const html = await render(false);
    expect(html).toContain("Agent instructions file");
    expect(html).toContain('aria-label="Allow all paths"');
    expect(html).toContain('aria-label="Disable built-in MCP servers"');
  });
});
