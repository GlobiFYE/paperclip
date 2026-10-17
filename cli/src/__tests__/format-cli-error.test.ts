import { describe, expect, it } from "vitest";
import { formatCliError } from "../format-cli-error.js";

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

  it("keeps a plain message unchanged and appends the cause", () => {
    const err = new Error("Paperclip server failed to start", {
      cause: Object.assign(new Error('relation "agent_runtime_state" already exists'), {
        name: "PostgresError",
        code: "42P07",
      }),
    });

    expect(formatCliError(err)).toBe(
      'Paperclip server failed to start\n  caused by: PostgresError: relation "agent_runtime_state" already exists [42P07]',
    );
  });

  it("renders non-Error throwables", () => {
    expect(formatCliError("boom")).toBe("boom");
    expect(formatCliError({ reason: "x" })).toBe('{"reason":"x"}');
  });
});
