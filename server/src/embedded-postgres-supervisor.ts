export type EmbeddedPostgresExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

export interface SupervisedEmbeddedPostgres {
  start(): Promise<void>;
  stop(): Promise<void>;
  process?: { once(event: "exit", listener: EmbeddedPostgresExitListener): unknown };
  /**
   * `false` marks a postmaster we adopted but do not own (it is the child of another supervisor).
   * Such an instance has no child handle to watch and must never be stopped by `shutdown()`.
   */
  owned?: boolean;
  pid?: number | null;
}

export interface EmbeddedPostgresSupervisor {
  current(): SupervisedEmbeddedPostgres;
  shutdown(): Promise<void>;
  waitForRecovery(): Promise<void>;
}

type Options = {
  initialInstance: SupervisedEmbeddedPostgres;
  createInstance: () => SupervisedEmbeddedPostgres;
  beforeRestart?: (attempt: number) => Promise<void> | void;
  restartDelaysMs?: number[];
  delay?: (milliseconds: number) => Promise<void>;
  onUnexpectedExit?: EmbeddedPostgresExitListener;
  onRestartAttemptFailed?: (error: unknown, attempt: number) => void;
  onRestarted?: (attempt: number) => void;
  onRecoveryExhausted?: (error: unknown) => void;
  /**
   * Called before each restart attempt (and once more after the last one) to look for a live
   * postmaster we do not own on the cluster. Returning an instance adopts it instead of counting a
   * failed restart attempt: a serving database is not a failed recovery.
   */
  adoptRunning?: (attempt: number) => Promise<SupervisedEmbeddedPostgres | null> | SupervisedEmbeddedPostgres | null;
  /** Liveness probe for an adopted instance, which exposes no child handle. */
  probeRunning?: (instance: SupervisedEmbeddedPostgres) => Promise<boolean>;
  adoptedProbeIntervalMs?: number;
  /**
   * A probe that never settles must not freeze the watchdog. A probe slower than this is counted
   * as a miss (the postmaster is not answering), and the next probe is still scheduled.
   */
  adoptedProbeTimeoutMs?: number;
  adoptedProbeFailureThreshold?: number;
  onAdopted?: (instance: SupervisedEmbeddedPostgres, attempt: number) => void;
  onAdoptProbeFailed?: (error: unknown, attempt: number) => void;
  onAdoptedLost?: (instance: SupervisedEmbeddedPostgres) => void;
  onAdoptionUnmonitored?: (instance: SupervisedEmbeddedPostgres) => void;
};

const defaultDelay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createEmbeddedPostgresSupervisor(options: Options): EmbeddedPostgresSupervisor {
  const restartDelaysMs = options.restartDelaysMs ?? [0, 250, 1_000];
  const wait = options.delay ?? defaultDelay;
  const adoptedProbeIntervalMs = options.adoptedProbeIntervalMs ?? 5_000;
  const adoptedProbeTimeoutMs = Math.max(
    1,
    options.adoptedProbeTimeoutMs ?? Math.max(1_000, adoptedProbeIntervalMs),
  );
  const adoptedProbeFailureThreshold = Math.max(1, options.adoptedProbeFailureThreshold ?? 2);
  let activeInstance = options.initialInstance;
  let activeInstanceExited = false;
  let shuttingDown = false;
  let recoveryPromise: Promise<void> | null = null;
  let stopAdoptedWatch: (() => void) | null = null;

  const stopWatch = () => {
    const stop = stopAdoptedWatch;
    stopAdoptedWatch = null;
    stop?.();
  };

  const beginRecovery = (): Promise<void> => {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = recover().finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  };

  // An adopted postmaster has no child process handle, so its liveness is polled. Two consecutive
  // misses (not one) are required before it counts as lost, so a slow probe on a busy host cannot
  // start a restart loop.
  const watchAdopted = (instance: SupervisedEmbeddedPostgres) => {
    const probe = options.probeRunning;
    if (!probe) {
      options.onAdoptionUnmonitored?.(instance);
      return;
    }
    let stopped = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      // One timer at a time. A resolution timer and a timeout timer must not both arm, or the probe
      // rate doubles instead of staying at the configured interval.
      if (stopped || shuttingDown || timer) return;
      timer = setTimeout(() => { void tick(); }, adoptedProbeIntervalMs);
      // Never hold the process open for a watchdog of something we do not own.
      (timer as { unref?: () => void }).unref?.();
    };
    // The production probe opens a fresh admin connection, and that client has no connect/query
    // timeout of its own. A postmaster that accepts the socket and never answers would leave this
    // promise pending forever, so bound it: a postmaster that does not answer is not alive.
    const probeAlive = async (): Promise<boolean> => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        return await Promise.race([
          probe(instance),
          new Promise<boolean>((settle) => {
            timeout = setTimeout(() => settle(false), adoptedProbeTimeoutMs);
            (timeout as { unref?: () => void }).unref?.();
          }),
        ]);
      } catch {
        return false;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    };
    const tick = async () => {
      timer = null;
      if (stopped || shuttingDown) return;
      if (running) {
        // A probe outlived its interval; keep the chain alive rather than dropping the watchdog.
        schedule();
        return;
      }
      running = true;
      const alive = await probeAlive();
      running = false;
      if (stopped || shuttingDown) return;
      if (alive) {
        failures = 0;
        schedule();
        return;
      }
      failures += 1;
      if (failures < adoptedProbeFailureThreshold) {
        schedule();
        return;
      }
      stopped = true;
      if (activeInstance !== instance) return;
      activeInstanceExited = true;
      options.onAdoptedLost?.(instance);
      void beginRecovery();
    };
    stopWatch();
    stopAdoptedWatch = () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    schedule();
  };

  const monitor = (instance: SupervisedEmbeddedPostgres) => {
    const child = instance.process;
    if (!child) {
      // Declaring the host unhealthy the moment we adopt a postmaster we do not own would
      // reproduce this bug one layer up. Watch it instead.
      if (instance.owned === false) {
        watchAdopted(instance);
        return;
      }
      options.onRecoveryExhausted?.(new Error("Embedded PostgreSQL started without a child process to monitor"));
      return;
    }
    child.once("exit", (code, signal) => {
      if (activeInstance !== instance) return;
      activeInstanceExited = true;
      if (shuttingDown) return;
      options.onUnexpectedExit?.(code, signal);
      void beginRecovery();
    });
  };

  const adopt = async (attempt: number): Promise<boolean> => {
    if (!options.adoptRunning) return false;
    let adopted: SupervisedEmbeddedPostgres | null = null;
    try {
      adopted = await options.adoptRunning(attempt);
    } catch (error) {
      options.onAdoptProbeFailed?.(error, attempt);
      return false;
    }
    if (!adopted) return false;
    if (shuttingDown) return true;
    stopWatch();
    activeInstance = adopted;
    activeInstanceExited = false;
    options.onAdopted?.(adopted, attempt);
    monitor(adopted);
    return true;
  };

  const recover = async () => {
    let lastError: unknown = new Error("Embedded PostgreSQL exited unexpectedly");
    for (let index = 0; index < restartDelaysMs.length; index += 1) {
      if (shuttingDown) return;
      const attempt = index + 1;
      const delayMs = restartDelaysMs[index] ?? 0;
      if (delayMs > 0) await wait(delayMs);
      if (shuttingDown) return;
      if (await adopt(attempt)) return;
      try {
        await options.beforeRestart?.(attempt);
        const replacement = options.createInstance();
        await replacement.start();
        if (shuttingDown) {
          await replacement.stop();
          return;
        }
        stopWatch();
        activeInstance = replacement;
        activeInstanceExited = false;
        monitor(replacement);
        options.onRestarted?.(attempt);
        return;
      } catch (error) {
        lastError = error;
        options.onRestartAttemptFailed?.(error, attempt);
      }
    }
    // One last look before calling the server unhealthy: the port may have come back while the
    // last attempt was failing.
    if (!shuttingDown && (await adopt(restartDelaysMs.length + 1))) return;
    if (!shuttingDown) options.onRecoveryExhausted?.(lastError);
  };

  monitor(activeInstance);
  return {
    current: () => activeInstance,
    waitForRecovery: async () => { await recoveryPromise; },
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      stopWatch();
      await recoveryPromise;
      // A postmaster we adopted is somebody else's child. Leave it running.
      if (!activeInstanceExited && activeInstance.owned !== false) await activeInstance.stop();
    },
  };
}
