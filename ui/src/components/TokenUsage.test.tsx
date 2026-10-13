// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { TokenUsageProvider, TokenUsageSummary } from "@paperclipai/shared";
import { api, ApiError } from "../api/client";
import { TokenUsage } from "./TokenUsage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const provider: TokenUsageProvider = {
  key: "mimo", name: "MiMo", kind: "cloud", tokens: 49_700_000, tokensIn: 40_000_000, tokensOut: 9_700_000,
  cachedTokens: 698_000_000, requests: 1414, count: 1414, countUnit: "calls", errors: 0, rateLimited: 3,
  pctUsed: 95, warning: true, remaining: "near limit",
  models: [{ name: "mimo-model", tokens: 49_700_000, tokensIn: 40_000_000, tokensOut: 9_700_000, calls: 1414 }],
};
function summary(): TokenUsageSummary {
  return {
    generatedAt: new Date(Date.now() - 12 * 60_000).toISOString(), generatedAtMs: Date.now() - 12 * 60_000,
    window: "d7", stale: false, partial: false, sources: [],
    total: { tokens: 49_700_000, tokensIn: 40_000_000, tokensOut: 9_700_000, cachedTokens: 698_000_000 },
    providers: [provider, { ...provider, key: "claude", name: "Claude", kind: "subscription", count: 47, countUnit: "runs", tokens: 0, models: [{ name: "claude-model", tokens: 0, tokensIn: 0, tokensOut: 0, calls: 47 }] }],
  };
}
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let get: MockInstance<typeof api.get>;
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function render(companyId = "company-1") {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TokenUsage companyId={companyId} /></QueryClientProvider>);
  });
  await settle();
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((button) => button.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await settle();
  return button!;
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  get = vi.spyOn(api, "get").mockResolvedValue(summary());
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TokenUsage", () => {
  it("renders the total, provider labels, separate counts, and cached tokens", async () => {
    await render();
    expect(container.querySelector('[data-testid="token-usage-total"]')?.textContent).toBe("49.7M");
    for (const text of ["AI token usage", "All AI usage on this machine", "Cloud", "Subscription", "1,414 calls", "47 runs", "+ 698.0M cached", "near limit", "limited 3x", "Updated 12 min ago"]) {
      expect(container.textContent).toContain(text);
    }
    expect(container.textContent).not.toContain("cache_read");
    expect(container.textContent).not.toContain("1,461");
    expect(container.querySelector('[style]')?.getAttribute("style")).toContain("width: 100%");
  });
  it("expands accessible model rows with provider-specific units", async () => {
    await render();
    expect(container.textContent).not.toContain("mimo-model");
    const button = await click("MiMo");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-controls")!)?.textContent).toContain("mimo-model");
    await click("Claude");
    expect(container.textContent).toContain("0 tokens · 47 runs");
    await click("MiMo");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("mimo-model");
  });
  it("fetches each selected window and isolates companies", async () => {
    await render();
    expect(get).toHaveBeenLastCalledWith("/companies/company-1/token-usage?window=d7", expect.objectContaining({ signal: expect.any(AbortSignal), cache: "no-store" }));
    for (const [label, window] of [["Today", "today"], ["30 days", "d30"], ["7 days", "d7"]]) {
      const button = await click(label);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(get).toHaveBeenLastCalledWith(`/companies/company-1/token-usage?window=${window}`, expect.anything());
    }
    await render("company-2");
    expect(get).toHaveBeenLastCalledWith("/companies/company-2/token-usage?window=d7", expect.anything());
  });
  it("polls every five minutes", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><TokenUsage companyId="company-1" /></QueryClientProvider>));
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(get).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
      expect(get).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("shows one plain unavailable line without technical reasons", async () => {
    get.mockResolvedValue({ available: false, reason: "/secret/path" });
    await render();
    expect(container.textContent).toContain("Token usage isn't available right now.");
    expect(container.textContent).not.toContain("/secret/path");
    expect(container.querySelector('[data-testid="token-usage-total"]')).toBeNull();
  });
  it("hides the whole card on 403, including previously cached data", async () => {
    await render();
    get.mockRejectedValue(new ApiError("Forbidden", 403, {}));
    await act(async () => { await client.invalidateQueries(); });
    await settle();
    expect(container.textContent).toBe("");
  });
  it("surfaces other API failures as unavailable", async () => {
    get.mockRejectedValue(new ApiError("Internal details", 500, {}));
    await render();
    expect(container.textContent).toContain("Token usage isn't available right now.");
    expect(container.textContent).not.toContain("Internal details");
  });
  it("shows stale and partial messages", async () => {
    get.mockResolvedValue({ ...summary(), stale: true, partial: true });
    await render();
    expect(container.textContent).toContain("Usage data is over an hour old");
    expect(container.textContent).toContain("Some usage sources weren't refreshed, so totals may be low.");
  });
  it("keeps zero-token limited providers without a bar or invalid widths", async () => {
    get.mockResolvedValue({ ...summary(), providers: [{ ...provider, tokens: 0 }], total: { tokens: 0, tokensIn: 0, tokensOut: 0, cachedTokens: 0 } });
    await render();
    expect(container.textContent).toContain("limited 3x");
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
  it("uses stacking and wrapping classes for phone-width rows and long names", async () => {
    vi.stubGlobal("innerWidth", 390);
    get.mockResolvedValue({ ...summary(), providers: [{ ...provider, name: "provider/".repeat(30) }] });
    await render();
    const row = container.querySelector('[data-testid="token-usage-provider"]')!;
    expect(row.classList.contains("min-w-0")).toBe(true);
    expect(row.firstElementChild?.className).toContain("flex-col");
    expect(row.firstElementChild?.className).toContain("sm:flex-row");
    expect(row.querySelector("button")?.className).toContain("whitespace-normal");
    expect(row.querySelector("button")?.className).toContain("break-all");
  });
});
