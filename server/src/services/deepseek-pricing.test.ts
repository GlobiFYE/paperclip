import { describe, expect, it } from "vitest";
import type { AdapterUsageCheckpoint } from "@paperclipai/adapter-utils";
import { isDeepSeekPeak, priceDeepSeekReceipt } from "./deepseek-pricing.js";

// 2026-10-08 is a Thursday.
const OFF_PEAK = new Date("2026-10-08T00:00:00Z"); // 00:00 UTC
const PEAK = new Date("2026-10-08T02:00:00Z"); // 02:00 UTC, weekday peak window
const WEEKEND = new Date("2026-10-10T02:00:00Z"); // Saturday

const receipt: AdapterUsageCheckpoint = {
  complete: true,
  usageBasis: "per_run",
  provider: "paperclip",
  biller: "paperclip",
  billingType: "unknown",
  model: "paperclip/deepseek-flash",
  costUsd: 0,
  costStatus: "reported",
  usage: { inputTokens: 10_000, cachedInputTokens: 100_000, outputTokens: 20_000 },
};

describe("DeepSeek peak windows", () => {
  it("flags weekday peak windows only", () => {
    expect(isDeepSeekPeak(PEAK)).toBe(true);
    expect(isDeepSeekPeak(OFF_PEAK)).toBe(false);
    expect(isDeepSeekPeak(WEEKEND)).toBe(false);
  });
});

describe("DeepSeek receipt pricing", () => {
  it("prices an unpriced projected-provider receipt as an estimate", () => {
    const priced = priceDeepSeekReceipt(receipt, OFF_PEAK);
    expect(priced.costStatus).toBe("estimated");
    expect(Number(priced.costUsdExact)).toBeGreaterThan(0);
    expect(priced.pricingProvenance).toMatchObject({
      source: "rate_card",
      version: "deepseek-standard-2026-10-08",
      serviceTier: "off-peak",
    });
    expect(priced.pricingProvenance?.evidence).toContain("off-peak");
    expect(priced.usage).toBe(receipt.usage);
    // The input receipt must not be mutated.
    expect(receipt.costStatus).toBe("reported");
    expect(receipt.costUsdExact).toBeUndefined();
  });

  it("doubles the estimate inside a peak window", () => {
    const off = priceDeepSeekReceipt(receipt, OFF_PEAK);
    const peak = priceDeepSeekReceipt(receipt, PEAK);
    expect(Number(peak.costUsdExact)).toBeCloseTo(Number(off.costUsdExact) * 2, 6);
    expect(peak.pricingProvenance?.serviceTier).toBe("peak");
  });

  it("normalizes projection prefix and window suffix to the model id", () => {
    const claudeStyle: AdapterUsageCheckpoint = { ...receipt, model: "deepseek-flash[1m]" };
    expect(priceDeepSeekReceipt(claudeStyle, OFF_PEAK).costStatus).toBe("estimated");
  });

  it.each([
    { complete: false },
    { usage: undefined },
    { usageBasis: "session_cumulative" },
    { billingType: "subscription" },
    { billingType: "subscription_included" },
    { costUsd: 0.12 },
    { costUsdExact: "0.12" },
    { cacheAdjustedCostUsd: 0.12 },
    { model: "paperclip/deepseek-unknown" },
    { model: "openrouter/deepseek/deepseek-v4-flash-0731" },
    { usage: { inputTokens: -1, cachedInputTokens: 0, outputTokens: 0 } },
  ] as Partial<AdapterUsageCheckpoint>[])(
    "preserves incomplete, incompatible or already priced receipts: %j",
    (override) => {
      const original = { ...receipt, ...override };
      expect(priceDeepSeekReceipt(original, OFF_PEAK)).toBe(original);
    },
  );
});
