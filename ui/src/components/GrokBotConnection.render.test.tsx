// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { GrokBotConnection } from "./GrokBotConnection";

const api = vi.hoisted(() => ({ connection: vi.fn(), retry: vi.fn() }));
vi.mock("@/api/grokBot", () => ({ grokBotApi: api }));
let root: Root;
let host: HTMLDivElement;
let cache: QueryClient;
afterEach(() => { flushSync(() => root?.unmount()); host?.remove(); cache?.clear(); vi.resetAllMocks(); });

it.each(["rejected", "unknown"])("offers an explicit retry only for a %s delivery", async status => {
  api.connection.mockResolvedValue({ enabled: true, resourceUrl: "https://paperclip.example/mcp/runner", recoveryNeeded: status === "unknown",
    binding: { id: "binding-fixture", connected: true, routine: { configured: true, verified: true, botName: "Night Shift", revision: 1,
      lastExchange: { id: "correlation-fixture", kind: "mailbox_updated", status, expiresAt: new Date(Date.now() + 60_000).toISOString() } } } });
  api.retry.mockResolvedValue({});
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  flushSync(() => root.render(<QueryClientProvider client={cache}><GrokBotConnection companyId="company-fixture" agentId="agent-fixture" /></QueryClientProvider>));
  await vi.waitFor(() => expect(host.textContent).toContain("Night Shift"));
  const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Retry rejected delivery");
  expect(Boolean(retry)).toBe(status === "rejected");
  if (retry) {
    flushSync(() => retry.click());
    await vi.waitFor(() => expect(api.retry).toHaveBeenCalledExactlyOnceWith("company-fixture", "agent-fixture", "correlation-fixture"));
  } else expect(api.retry).not.toHaveBeenCalled();
});
