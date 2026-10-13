// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "../ui/dialog";
import { GrokBotSetup } from "./GrokBotSetup";

const api = vi.hoisted(() => ({ resume: vi.fn(), connection: vi.fn(), create: vi.fn(), pair: vi.fn(), configure: vi.fn(), verify: vi.fn() }));
vi.mock("@/api/grokBot", () => ({ grokBotApi: api }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [] } }));
let root: Root;
let host: HTMLDivElement;
let cache: QueryClient;
afterEach(() => { flushSync(() => root?.unmount()); host?.remove(); cache?.clear(); vi.resetAllMocks(); });

it("restores the same saved agent when a failed initial resume succeeds on retry", async () => {
  const companyId = "company-fixture", agentId = "agent-saved-night-shift";
  const binding = { id: "binding-fixture", providerKind: "grok_bot", status: "connected", connected: true,
    subscriptionVerified: false, wakeVerified: false, routine: null, hasPendingChallenge: false, pairingExpiresAt: null, challengeExpiresAt: null };
  api.resume.mockRejectedValueOnce(new Error("Saved setup could not be loaded")).mockResolvedValue({
    agent: { id: agentId, name: "Saved Night Shift", botName: "Night Shift", role: "researcher", reportsTo: null, status: "idle" }, approvalId: null, binding,
  });
  api.connection.mockResolvedValue({ enabled: true, resourceUrl: "https://paperclip.example/mcp/runner", agentStatus: "idle",
    agentLifecycleState: "verifying", canConfigureConnection: true, recoveryNeeded: false, binding });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  flushSync(() => root.render(<QueryClientProvider client={cache}><Dialog open><DialogContent><GrokBotSetup companyId={companyId} companyName="Acme" onBack={() => {}} onClose={() => {}} /></DialogContent></Dialog></QueryClientProvider>));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Saved setup could not be loaded"));
  const retry = [...document.querySelectorAll("button")].find(button => button.textContent === "Try again");
  expect(retry).toBeTruthy();
  flushSync(() => retry!.click());
  await vi.waitFor(() => expect([...document.querySelectorAll("label")].some(label => label.textContent === "Webhook key")).toBe(true));
  expect(api.connection).toHaveBeenCalledWith(companyId, agentId, expect.any(AbortSignal));
  expect(api.create).not.toHaveBeenCalled();
  expect(api.pair).not.toHaveBeenCalled();
});
