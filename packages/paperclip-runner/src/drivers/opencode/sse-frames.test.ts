import { describe, expect, it } from "vitest";

import { canonicalProviderEventsFromOpenCodePart } from "../../provider-events.js";
import {
  OPENCODE_SSE_LIMITS,
  annotateOmittedProviderText,
  parseOpenCodeSseFrames,
  type OpenCodeSseFrame,
} from "./sse-frames.js";

function stream(text: string, chunkChars = 64 * 1024): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkChars)
        controller.enqueue(bytes.subarray(index, index + chunkChars));
      controller.close();
    },
  });
}

async function frames(text: string, chunkChars?: number): Promise<OpenCodeSseFrame[]> {
  const collected: OpenCodeSseFrame[] = [];
  for await (const frame of parseOpenCodeSseFrames(stream(text, chunkChars)))
    collected.push(frame);
  return collected;
}

function sse(value: unknown, newline = "\n"): string {
  return `data: ${JSON.stringify(value)}${newline}${newline}`;
}

/** The shape of the PAP-384 failure: a completed bash part with huge output. */
function completedToolPart(output: string) {
  return {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_1",
      part: {
        id: "prt_tool",
        messageID: "msg_1",
        sessionID: "ses_1",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "pnpm test", description: "Run tests" },
          output,
          title: "Run tests",
          metadata: { exit: 1, output, description: "Run tests" },
          time: { start: 1, end: 2 },
        },
      },
    },
  };
}

describe("parseOpenCodeSseFrames", () => {
  it("keeps frames below the limit exact even when one chunk holds more than the limit", async () => {
    const events = Array.from({ length: 40 }, (_, index) => ({
      type: "message.part.updated",
      properties: { index, text: "x".repeat(32 * 1024) },
    }));
    const text = events.map((event) => sse(event)).join("");
    expect(text.length).toBeGreaterThan(OPENCODE_SSE_LIMITS.frameChars);
    const parsed = await frames(text, text.length);
    expect(parsed).toHaveLength(40);
    expect(parsed.every((frame) => frame.compaction === undefined)).toBe(true);
    expect(parsed.map((frame) => JSON.parse(frame.data))).toEqual(events);
  });

  it("compacts an oversized tool event and keeps its outcome and the next event", async () => {
    const head = "PASS early suite\n";
    const tail = "\nFAIL src/last.test.ts\nTests: 1 failed, 812 passed\nexit status 1";
    const output = head + "é ✓ \"quoted\" \\ 🙂 line\n".repeat(80_000) + tail;
    const next = { type: "session.idle", properties: { sessionID: "ses_1" } };
    const parsed = await frames(sse(completedToolPart(output), "\r\n") + sse(next), 4093);

    expect(parsed).toHaveLength(2);
    const [oversized, following] = parsed;
    expect(oversized!.compaction).toMatchObject({
      omitted: false,
      eventType: "message.part.updated",
      truncatedStrings: 2,
    });
    expect(oversized!.compaction!.frameChars).toBeGreaterThan(2 * output.length);
    expect(oversized!.data.length).toBeLessThan(OPENCODE_SSE_LIMITS.frameChars);
    expect(oversized!.compaction!.truncations).toEqual([
      expect.objectContaining({
        path: ["properties", "part", "state", "output"],
        chars: output.length,
        bytes: Buffer.byteLength(output),
      }),
      expect.objectContaining({
        path: ["properties", "part", "state", "metadata", "output"],
        chars: output.length,
        bytes: Buffer.byteLength(output),
      }),
    ]);

    const event = JSON.parse(oversized!.data);
    const part = event.properties.part;
    expect(part).toMatchObject({
      id: "prt_tool",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "pnpm test", description: "Run tests" },
        title: "Run tests",
        metadata: { exit: 1, description: "Run tests" },
        time: { start: 1, end: 2 },
      },
    });
    expect(part.state.output.startsWith(head)).toBe(true);
    expect(part.state.output.endsWith(tail)).toBe(true);
    expect(part.state.output).toMatch(/…\[\d+ characters omitted\]…/);
    expect(JSON.parse(following!.data)).toEqual(next);
    expect(following!.compaction).toBeUndefined();

    annotateOmittedProviderText(event, oversized!.compaction!);
    const [canonical] = canonicalProviderEventsFromOpenCodePart(part);
    expect(canonical).toMatchObject({
      eventType: "tool.execution.completed",
      payload: {
        name: "bash",
        status: "completed",
        outputBytes: Buffer.byteLength(output),
        outputTruncated: true,
        outputDigest: null,
      },
    });
    expect(String(canonical!.payload.output).endsWith(tail)).toBe(true);
    expect(String(canonical!.payload.output).length).toBeLessThanOrEqual(64 * 1024);
    expect(JSON.stringify(part)).not.toContain("omittedProviderText");
  });

  it("does not report a separator blank line before an oversized frame", async () => {
    const small = { type: "server.connected", properties: {} };
    const large = completedToolPart("y".repeat(1_200_000));
    const parsed = await frames(`${sse(small)}\n${sse(large)}`, 1_100_000);
    expect(parsed.map((frame) => frame.compaction?.omitted ?? null)).toEqual([null, false]);
    expect(JSON.parse(parsed[1]!.data).properties.part.state.status).toBe("completed");
  });

  it("reports a frame whose compacted structure still exceeds the bound", async () => {
    const value = {
      type: "session.diff",
      properties: { files: Array.from({ length: 500_000 }, (_, index) => index) },
    };
    const next = { type: "session.idle", properties: {} };
    const parsed = await frames(sse(value) + sse(next));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      data: "",
      raw: "",
      compaction: { omitted: true, eventType: "session.diff" },
    });
    expect(JSON.parse(parsed[1]!.data)).toEqual(next);
  });

  it("keeps short identity strings once the long-string budget is spent", async () => {
    const files = Array.from({ length: 20 }, (_, index) => ({
      file: `src/file-${index}.ts`,
      before: "b".repeat(100_000),
      after: "a".repeat(100_000),
      status: "modified",
    }));
    const [frame] = await frames(sse({ type: "session.diff", properties: { files } }));
    const event = JSON.parse(frame!.data);
    expect(event.properties.files).toHaveLength(20);
    expect(event.properties.files.map((file: { file: string }) => file.file)).toEqual(
      files.map((file) => file.file),
    );
    expect(event.properties.files.every((file: { status: string }) => file.status === "modified")).toBe(true);
    expect(frame!.data.length).toBeLessThan(OPENCODE_SSE_LIMITS.frameChars);
  });
});
