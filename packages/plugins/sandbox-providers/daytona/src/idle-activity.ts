import type { PluginDefinition } from "@paperclipai/plugin-sdk";

type Resource = {
  keys: Set<string>;
  absenceProofKeys: Set<string>;
  confirmed: boolean;
};

/** Worker-local evidence complements the host's durable lease and task gates. */
export class DaytonaIdleActivity {
  private readonly requests = new Set<object>();
  private readonly resources = new Map<string, Set<Resource>>();

  track<T>(run: () => Promise<T>): Promise<T> {
    const request = {};
    this.requests.add(request);
    let pending: Promise<T>;
    try {
      pending = run();
    } catch (error) {
      this.requests.delete(request);
      throw error;
    }
    return Promise.resolve(pending).then(
      (value) => { this.requests.delete(request); return value; },
      (error: unknown) => { this.requests.delete(request); throw error; },
    );
  }

  resource(key: string, provisional = false): Resource {
    const existing = this.resources.get(key)?.values().next().value;
    if (existing) return existing;
    const resource: Resource = {
      keys: new Set([key]),
      absenceProofKeys: new Set(provisional ? [] : [key]),
      confirmed: false,
    };
    this.resources.set(key, new Set([resource]));
    return resource;
  }

  /** Attach an observed immutable ID without reviving a confirmed allocation. */
  observe(resource: Resource, key: string): void {
    if (resource.confirmed) return;
    resource.keys.add(key);
    resource.absenceProofKeys.add(key);
    const linked = this.resources.get(key) ?? new Set<Resource>();
    linked.add(resource);
    this.resources.set(key, linked);
  }

  confirm(key: string, absenceOnly = false): void {
    // One request is the cleanup/inspection hook itself. If another hook or
    // an underlying timed-out request is still running, it can change the
    // provider after this receipt. Require a later, quiescent observation.
    if (this.requests.size > 1) return;
    for (const resource of [...(this.resources.get(key) ?? [])]) {
      // An unobserved create name can materialize after a not-found response.
      if (absenceOnly && !resource.absenceProofKeys.has(key)) continue;
      resource.confirmed = true;
      for (const alias of resource.keys) {
        const linked = this.resources.get(alias);
        linked?.delete(resource);
        if (linked?.size === 0) this.resources.delete(alias);
      }
    }
  }

  present(): boolean {
    return this.requests.size > 0 || this.resources.size > 0;
  }

  resetForTest(): void {
    this.requests.clear();
    this.resources.clear();
  }
}

/** Count hooks before they start, including terminal/PTY setup before registration. */
export function trackDaytonaHooks(definition: PluginDefinition, activity: DaytonaIdleActivity): PluginDefinition {
  const tracked = { ...definition };
  for (const [name, hook] of Object.entries(definition)) {
    if (!name.startsWith("on") || name === "onIdleDrain" || name === "onHealth" || typeof hook !== "function") continue;
    Object.defineProperty(tracked, name, {
      enumerable: true,
      value: (...args: unknown[]) => activity.track(async () => Reflect.apply(hook, definition, args)),
    });
  }
  return tracked;
}
