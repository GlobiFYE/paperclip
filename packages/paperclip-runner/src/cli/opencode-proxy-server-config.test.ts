import { describe, expect, it } from "vitest";

import { parseOpenCodeProxyPersistentServer } from "./opencode-proxy-server-config.js";

const auth = "Bearer fixture-token";

describe("OpenCode persistent server configuration", () => {
  it("allows loopback HTTP and normalizes the URL", () => {
    expect(
      parseOpenCodeProxyPersistentServer({
        PAPERCLIP_OPENCODE_SERVER_URL: "http://127.0.0.1:4096/",
        PAPERCLIP_OPENCODE_SERVER_AUTH: auth,
        PAPERCLIP_OPENCODE_SERVER_VERSION: "2.0.27",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:4096",
      authHeader: auth,
      version: "2.0.27",
    });
  });

  it.each([
    "http://opencode.example",
    "http://10.0.0.8:4096",
    "http://[2001:db8::8]:4096",
    "http://localhost:4096",
  ])("rejects cleartext remote URL %s before use", (url) => {
    expect(() =>
      parseOpenCodeProxyPersistentServer({
        PAPERCLIP_OPENCODE_SERVER_URL: url,
        PAPERCLIP_OPENCODE_SERVER_AUTH: auth,
      }),
    ).toThrow("requires HTTPS for non-loopback hosts");
  });

  it("allows HTTPS for a remote daemon", () => {
    expect(
      parseOpenCodeProxyPersistentServer({
        PAPERCLIP_OPENCODE_SERVER_URL: "https://opencode.example/api/",
        PAPERCLIP_OPENCODE_SERVER_AUTH: auth,
      }),
    ).toEqual({
      baseUrl: "https://opencode.example/api",
      authHeader: auth,
    });
  });

  it.each([
    "http://127.0.0.1:4096#secret",
    "https://user:password@opencode.example",
    "file:///tmp/opencode",
  ])("rejects unsafe URL data in %s", (url) => {
    expect(() =>
      parseOpenCodeProxyPersistentServer({
        PAPERCLIP_OPENCODE_SERVER_URL: url,
        PAPERCLIP_OPENCODE_SERVER_AUTH: auth,
      }),
    ).toThrow();
  });
});
