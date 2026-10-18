import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createEmbeddedPostgresSupervisor, type SupervisedEmbeddedPostgres } from "../embedded-postgres-supervisor.js";

function createInstance(startError?: Error) {
  const process = new EventEmitter();
  const instance: SupervisedEmbeddedPostgres = {
    process,
    start: vi.fn(async () => { if (startError) throw startError; }),
    stop: vi.fn(async () => undefined),
  };
  return { instance, process };
}

// A postmaster we do not own: no child handle, and we never stop it.
function createAdoptedInstance(pid = 4242): SupervisedEmbeddedPostgres {
  return {
    owned: false,
    pid,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("embedded PostgreSQL supervisor", () => {
  it("restarts PostgreSQL after its managed child exits unexpectedly", async () => {
    const initial = createInstance();
    const replacement = createInstance();
    const onRestarted = vi.fn();
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => replacement.instance,
      restartDelaysMs: [0],
      onRestarted,
    });
    initial.process.emit("exit", 137, "SIGKILL");
    await supervisor.waitForRecovery();
    expect(replacement.instance.start).toHaveBeenCalledOnce();
    expect(supervisor.current()).toBe(replacement.instance);
    expect(onRestarted).toHaveBeenCalledWith(1);
  });

  it("does not restart PostgreSQL during orderly shutdown", async () => {
    const initial = createInstance();
    const createReplacement = vi.fn(() => createInstance().instance);
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: createReplacement,
      restartDelaysMs: [0],
    });
    await supervisor.shutdown();
    expect(initial.instance.stop).toHaveBeenCalledOnce();
    expect(createReplacement).not.toHaveBeenCalled();
  });

  it("bounds recovery attempts and reports the final failure", async () => {
    const initial = createInstance();
    const failures = [new Error("first"), new Error("second"), new Error("third")];
    const onRecoveryExhausted = vi.fn();
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => createInstance(failures.shift()).instance,
      restartDelaysMs: [0, 0, 0],
      onRecoveryExhausted,
    });
    initial.process.emit("exit", 1, null);
    await supervisor.waitForRecovery();
    expect(onRecoveryExhausted).toHaveBeenCalledOnce();
    expect(onRecoveryExhausted).toHaveBeenCalledWith(expect.objectContaining({ message: "third" }));
  });

  describe("adopting a live postmaster it does not own", () => {
    it("adopts a live postmaster instead of counting a failed attempt or exhausting recovery", async () => {
      const initial = createInstance();
      const adopted = createAdoptedInstance(23228);
      const createReplacement = vi.fn(() => createInstance().instance);
      const onAdopted = vi.fn();
      const onRestartAttemptFailed = vi.fn();
      const onRecoveryExhausted = vi.fn();
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: createReplacement,
        restartDelaysMs: [0, 0, 0],
        adoptRunning: () => adopted,
        probeRunning: async () => true,
        onAdopted,
        onRestartAttemptFailed,
        onRecoveryExhausted,
      });
      initial.process.emit("exit", 0, "SIGINT");
      await supervisor.waitForRecovery();
      expect(onAdopted).toHaveBeenCalledWith(adopted, 1);
      expect(onRestartAttemptFailed).not.toHaveBeenCalled();
      expect(onRecoveryExhausted).not.toHaveBeenCalled();
      expect(createReplacement).not.toHaveBeenCalled();
      expect(supervisor.current()).toBe(adopted);
    });

    it("adopts on a later attempt when the postmaster comes back mid-recovery", async () => {
      const initial = createInstance();
      const adopted = createAdoptedInstance();
      const attempts = [null, null, adopted];
      const failures = [new Error("no"), new Error("no"), new Error("no")];
      const onAdopted = vi.fn();
      const onRestartAttemptFailed = vi.fn();
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: () => createInstance(failures.shift()).instance,
        restartDelaysMs: [0, 0, 0],
        adoptRunning: () => attempts.shift() ?? null,
        probeRunning: async () => true,
        onAdopted,
        onRestartAttemptFailed,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      expect(onRestartAttemptFailed).toHaveBeenCalledTimes(2);
      expect(onAdopted).toHaveBeenCalledWith(adopted, 3);
      expect(supervisor.current()).toBe(adopted);
    });

    it("takes one last look at the port before declaring recovery exhausted", async () => {
      const initial = createInstance();
      const adopted = createAdoptedInstance();
      const failures = [new Error("a"), new Error("b"), new Error("c")];
      const probes: Array<SupervisedEmbeddedPostgres | null> = [null, null, null, adopted];
      const onRecoveryExhausted = vi.fn();
      const onAdopted = vi.fn();
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: () => createInstance(failures.shift()).instance,
        restartDelaysMs: [0, 0, 0],
        adoptRunning: () => probes.shift() ?? null,
        probeRunning: async () => true,
        onAdopted,
        onRecoveryExhausted,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      expect(onRecoveryExhausted).not.toHaveBeenCalled();
      expect(onAdopted).toHaveBeenCalledWith(adopted, 4);
    });

    it("still exhausts when nothing is alive on the cluster", async () => {
      const initial = createInstance();
      const onRecoveryExhausted = vi.fn();
      const adoptRunning = vi.fn(async () => null);
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: () => createInstance(new Error("boom")).instance,
        restartDelaysMs: [0],
        adoptRunning,
        probeRunning: async () => false,
        onRecoveryExhausted,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      expect(adoptRunning).toHaveBeenCalledTimes(2); // one per attempt + the final look
      expect(onRecoveryExhausted).toHaveBeenCalledOnce();
    });

    it("treats a throwing adoption probe as a failed attempt, not a fatal one", async () => {
      const initial = createInstance();
      const replacement = createInstance();
      const onAdoptProbeFailed = vi.fn();
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: () => replacement.instance,
        restartDelaysMs: [0],
        adoptRunning: () => { throw new Error("probe exploded"); },
        probeRunning: async () => true,
        onAdoptProbeFailed,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      expect(onAdoptProbeFailed).toHaveBeenCalledWith(expect.objectContaining({ message: "probe exploded" }), 1);
      expect(supervisor.current()).toBe(replacement.instance);
    });

    it("recovers when an adopted postmaster disappears", async () => {
      const initial = createInstance();
      const adopted = createAdoptedInstance();
      let alive = true;
      const onAdoptedLost = vi.fn();
      const onRestarted = vi.fn();
      const replacement = createInstance();
      // Adoption and the liveness probe share one predicate in production: once the postmaster is
      // gone, adoptRunning stops returning it.
      let adoptedAvailable = true;
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: () => replacement.instance,
        restartDelaysMs: [0],
        adoptRunning: () => {
          if (!adoptedAvailable) return null;
          adoptedAvailable = false;
          return adopted;
        },
        probeRunning: async () => alive,
        adoptedProbeIntervalMs: 2,
        adoptedProbeFailureThreshold: 2,
        onAdoptedLost,
        onRestarted,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      expect(supervisor.current()).toBe(adopted);
      alive = false;
      await tick(60);
      expect(onAdoptedLost).toHaveBeenCalledWith(adopted);
      expect(onRestarted).toHaveBeenCalledWith(1);
      expect(supervisor.current()).toBe(replacement.instance);
    });

    it("survives a single missed probe without starting a restart loop", async () => {
      const initial = createInstance();
      const adopted = createAdoptedInstance();
      let alive = true;
      const onAdoptedLost = vi.fn();
      const createReplacement = vi.fn(() => createInstance().instance);
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: createReplacement,
        restartDelaysMs: [0],
        adoptRunning: () => adopted,
        probeRunning: async () => alive,
        adoptedProbeIntervalMs: 2,
        adoptedProbeFailureThreshold: 2,
        onAdoptedLost,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      alive = false;
      await tick(3);
      alive = true;
      await tick(40);
      expect(onAdoptedLost).not.toHaveBeenCalled();
      expect(createReplacement).not.toHaveBeenCalled();
    });

    it("never stops a postmaster it adopted", async () => {
      const initial = createInstance();
      const adopted = createAdoptedInstance();
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: () => createInstance().instance,
        restartDelaysMs: [0],
        adoptRunning: () => adopted,
        probeRunning: async () => true,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      await supervisor.shutdown();
      expect(adopted.stop).not.toHaveBeenCalled();
      expect(initial.instance.stop).not.toHaveBeenCalled(); // already exited
    });

    // The production probe opens a fresh admin connection and the client has no
    // connect/query timeout, so a postmaster that accepts the socket but never answers leaves the
    // probe promise pending forever. That used to freeze the watchdog on its first tick: one pending
    // promise, no timer, no further probes, and the adopted postmaster stopped being watched.
    it("keeps probing when a probe never settles, and counts the wedge as a miss", async () => {
      const initial = createInstance();
      const adopted = createAdoptedInstance();
      let calls = 0;
      const onAdoptedLost = vi.fn();
      const replacement = createInstance();
      let adoptedAvailable = true;
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: () => replacement.instance,
        restartDelaysMs: [0],
        adoptRunning: () => {
          if (!adoptedAvailable) return null;
          adoptedAvailable = false;
          return adopted;
        },
        probeRunning: () => {
          calls += 1;
          return new Promise<boolean>(() => {}); // never settles
        },
        adoptedProbeIntervalMs: 5,
        adoptedProbeTimeoutMs: 5,
        adoptedProbeFailureThreshold: 2,
        onAdoptedLost,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      expect(supervisor.current()).toBe(adopted);
      await tick(80);
      expect(calls).toBeGreaterThan(1); // the watchdog survived the first hung probe
      expect(onAdoptedLost).toHaveBeenCalledOnce();
      expect(supervisor.current()).toBe(replacement.instance);
    });

    it("does not hang shutdown while a probe is still pending", async () => {
      const initial = createInstance();
      const adopted = createAdoptedInstance();
      const supervisor = createEmbeddedPostgresSupervisor({
        initialInstance: initial.instance,
        createInstance: () => createInstance().instance,
        restartDelaysMs: [0],
        adoptRunning: () => adopted,
        probeRunning: () => new Promise<boolean>(() => {}),
        adoptedProbeIntervalMs: 5,
        adoptedProbeTimeoutMs: 5,
        adoptedProbeFailureThreshold: 5,
      });
      initial.process.emit("exit", 1, null);
      await supervisor.waitForRecovery();
      await tick(12);
      await expect(supervisor.shutdown()).resolves.toBeUndefined();
      expect(adopted.stop).not.toHaveBeenCalled();
    });
  });
});
