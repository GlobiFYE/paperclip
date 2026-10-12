import { describe, expect, it } from "vitest";
import { sessionCodec } from "./index.js";

describe("copilot sessionCodec", () => {
  it("round-trips usageCumulative and premiumRequestsCumulative", () => {
    const params = {
      sessionId: "s1",
      cwd: "/w",
      premiumRequestsCumulative: 0.66,
      usageCumulative: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 3, cacheWriteTokens: 0 },
    };
    expect(sessionCodec.deserialize(sessionCodec.serialize(params))).toEqual(params);
  });

  it("rejects params without a session id", () => {
    expect(sessionCodec.deserialize({ cwd: "/w" })).toBeNull();
  });
});
