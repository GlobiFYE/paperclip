import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { TracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { expect, it } from "vitest";
import { createHeartbeatPreparationTiming } from "./preparation-timing.js";

it("parents child spans to their own preparation phase across overlapping awaited runs", async () => {
  const manager = new AsyncLocalStorageContextManager().enable();
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  expect(context.setGlobalContextManager(manager)).toBe(true);
  expect(trace.setGlobalTracerProvider(provider)).toBe(true);
  try {
    const gates = [0, 1].map(() => {
      let resolve!: () => void;
      const promise = new Promise<void>(release => { resolve = release; });
      return { promise, resolve };
    });
    const runs = ["first-run", "second-run"];
    const pending = runs.map((run, index) => createHeartbeatPreparationTiming(run)("workspace", async () => {
      await gates[index].promise;
      await setImmediate();
      const child = trace.getTracer("preparation-context-test").startSpan(`child.${run}`);
      await setImmediate();
      child.end();
    }));
    expect(trace.getActiveSpan()).toBeUndefined();
    gates[1].resolve();
    gates[0].resolve();
    await Promise.all(pending);
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(4);
    const phases = runs.map(run => spans.find(span => span.name === "heartbeat.prepare.workspace"
      && span.attributes["paperclip.task.run.run_id"] === createHash("sha256").update(run).digest("hex").slice(0, 12))!);
    expect(phases.every(Boolean)).toBe(true);
    expect(phases[0].spanContext().traceId).not.toBe(phases[1].spanContext().traceId);
    for (const [index, run] of runs.entries()) {
      const child = spans.find(span => span.name === `child.${run}`)!;
      expect(child.parentSpanContext?.spanId).toBe(phases[index].spanContext().spanId);
      expect(child.spanContext().traceId).toBe(phases[index].spanContext().traceId);
      expect(phases[index].parentSpanContext).toBeUndefined();
    }
    expect(trace.getActiveSpan()).toBeUndefined();
  } finally {
    trace.disable();
    context.disable();
    manager.disable();
    await provider.shutdown();
  }
});
