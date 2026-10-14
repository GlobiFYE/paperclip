import { describe, expect, it } from "vitest";
import { sanitizeInheritedPaperclipEnv } from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });

  it("drops the server JWT secret with the rest of the inherited Paperclip environment", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIP_AGENT_JWT_SECRET: "server-secret",
      PAPERCLIP_API_KEY: "stale-run-key",
      PATH: "/usr/bin",
    })).toEqual({ PATH: "/usr/bin" });
  });
});
