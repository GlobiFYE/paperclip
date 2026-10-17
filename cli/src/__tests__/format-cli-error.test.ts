import { describe, expect, it } from "vitest";
import { formatCliError } from "../format-cli-error.js";
import { redactTestDriveText } from "../commands/test-drive.js";

describe("formatCliError", () => {
  it("never renders an empty AggregateError as blank", () => {
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}:54329`), { code: "ECONNREFUSED" });
    const err = new AggregateError([refused("::1"), refused("127.0.0.1")], "");

    const text = formatCliError(err);

    expect(text.trim()).not.toBe("");
    expect(text).toContain("AggregateError");
    expect(text).toContain("connect ECONNREFUSED ::1:54329");
    expect(text).toContain("connect ECONNREFUSED 127.0.0.1:54329");
  });

  it("expands the cause of an error that has no message", () => {
    const err = new Error("", { cause: new Error('relation "agent_runtime_state" already exists') });
    expect(formatCliError(err)).toBe('Error\n  caused by: relation "agent_runtime_state" already exists');
  });

  it("prints only the outer message when one exists, so causes stay unprinted", () => {
    const err = new Error("Paperclip server failed to start", { cause: new Error("inner detail") });
    expect(formatCliError(err)).toBe("Paperclip server failed to start");
  });

  it("does not re-expose a credential redacted by test-drive", () => {
    const apiKey = "sk-test-1234567890abcdef";
    const raw = new Error(`provider rejected key ${apiKey}`);
    const wrapped = new Error(redactTestDriveText(raw.message, [apiKey]), { cause: raw });

    const text = formatCliError(wrapped);

    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(apiKey);
  });

  it("renders non-Error throwables", () => {
    expect(formatCliError("boom")).toBe("boom");
    expect(formatCliError({ reason: "x" })).toBe('{"reason":"x"}');
  });
});
