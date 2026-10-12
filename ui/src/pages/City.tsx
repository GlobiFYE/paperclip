/**
 * City — embeds the locally installed City app inside the Pantheon board.
 *
 * The City app is served by the launch service `com.pantheon.city` on the
 * local M4 host, default origin `http://127.0.0.1:5180`.
 *
 * Origin configuration uses the established app configuration pattern (same
 * as VITE_FEEDBACK_TERMS_URL in pages/InstanceGeneralSettings.tsx): set
 * `VITE_CITY_URL` at build time to override the default origin.
 *
 * Remaining remote wiring (documented per TOP-163; no server/API changes were
 * made for this):
 * - The default origin is `127.0.0.1:5180` on the M4 host. A localhost origin
 *   only resolves in a browser running ON that host; it never works from
 *   another device, and this page says so explicitly instead of pretending.
 * - To use City from another device, expose the City port (5180) on an origin
 *   reachable from that device's network (reverse proxy, VPN, or tunnel to the
 *   M4 host) and build the UI with `VITE_CITY_URL` set to that origin.
 * - The page probes the configured origin from the browser and reports the
 *   actual connection state (checking / connected / unreachable); when
 *   unreachable it offers a usable fallback (retry, open-in-new-tab) instead
 *   of a blank frame.
 *
 * The product page intentionally keeps copy minimal (City, connection state,
 * Open City, Full screen, retry fallback) — the launch-service/configuration/
 * wiring details above stay here in source comments. A successful opaque
 * probe is labeled "Service reachable": it proves the origin answers, not a
 * verified agent feed. A loopback origin requires a browser on the M4 host;
 * a non-loopback page hostname does not prove a different physical device
 * (the M4 can open its own Tailscale name), so the UI never claims that.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  ExternalLink,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/** Default City origin: the M4 host's localhost. Overridable via VITE_CITY_URL. */
export const CITY_DEFAULT_ORIGIN = "http://127.0.0.1:5180";

const CITY_ORIGIN = (
  import.meta.env.VITE_CITY_URL?.trim() || CITY_DEFAULT_ORIGIN
).replace(/\/+$/, "");

export type CityConnectionState = "checking" | "connected" | "unreachable";

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Reachability probe from the browser: an opaque no-cors request succeeds
 * (resolves) whenever the origin answers at all, and rejects on network-level
 * failure (service down, or loopback resolving on a machine without City).
 * A successful probe means only "Service reachable" — the origin answered.
 * It is not a verified agent feed and must not be presented as one.
 */
async function probeCityOrigin(origin: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(`${origin}/`, {
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export const STATE_LABEL: Record<CityConnectionState, string> = {
  checking: "Checking connection…",
  connected: "Service reachable",
  unreachable: "Not reachable from this browser",
};

/** Usable fallback shown when the configured City origin does not answer. */
export function CityUnavailableFallback({
  origin,
  onRetry,
}: {
  origin: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 rounded-lg border border-border bg-muted p-6">
      <h2 className="text-(length:--text-compact) font-semibold text-foreground">
        City is not reachable at {origin}
      </h2>
      <p className="text-sm text-muted-foreground">
        The City app did not answer at this origin. If the origin is a loopback
        address, the browser must be on the M4 host.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={origin} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open {origin} in a new tab
          </a>
        </Button>
      </div>
    </div>
  );
}

export function City() {
  const [connection, setConnection] = useState<CityConnectionState>("checking");
  const [probeNonce, setProbeNonce] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const frameAreaRef = useRef<HTMLDivElement | null>(null);

  const originIsLoopback = isLoopbackOrigin(CITY_ORIGIN);

  useEffect(() => {
    let cancelled = false;
    setConnection("checking");
    probeCityOrigin(CITY_ORIGIN).then((reachable) => {
      if (!cancelled) setConnection(reachable ? "connected" : "unreachable");
    });
    return () => {
      cancelled = true;
    };
  }, [probeNonce]);

  useEffect(() => {
    const onChange = () => setFullscreenActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const retry = useCallback(() => setProbeNonce((n) => n + 1), []);

  const toggleFullscreen = useCallback(async () => {
    const el = frameAreaRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Fullscreen can be blocked by policy or embedding contexts; opening
      // City directly keeps the control usable instead of failing silently.
      window.open(CITY_ORIGIN, "_blank", "noopener,noreferrer");
    }
  }, []);

  return (
    <div
      ref={frameAreaRef}
      className="flex h-full min-h-0 flex-col gap-3 bg-background p-4"
      data-page="city"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Building2 className="h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
        <h1 className="text-(length:--text-compact) font-semibold text-foreground">City</h1>
        <span
          data-testid="city-connection-state"
          className="rounded-lg border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {STATE_LABEL[connection]}
        </span>
        <span className="font-mono text-xs text-muted-foreground break-all">{CITY_ORIGIN}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            data-testid="city-fullscreen-control"
          >
            {fullscreenActive ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
            {fullscreenActive ? "Exit full screen" : "Full screen"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            asChild
            data-testid="city-open-control"
          >
            <a href={CITY_ORIGIN} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open City
            </a>
          </Button>
        </div>
      </header>

      <p data-testid="city-local-m4-caveat" className="text-xs text-muted-foreground">
        {originIsLoopback ? "Loopback origin — this page requires a browser on the M4 host. " : null}
        &quot;Service reachable&quot; means the City app answered at this origin, not a verified
        agent feed.
      </p>

      {connection === "connected" ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          <iframe
            src={`${CITY_ORIGIN}/`}
            title="City application"
            className="h-full w-full border-0 bg-background"
          />
        </div>
      ) : connection === "checking" ? (
        <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 rounded-lg border border-border bg-muted p-6">
          <p className="text-sm text-foreground" aria-live="polite">
            Contacting City at{" "}
            <span className="font-mono break-all">{CITY_ORIGIN}</span>…
          </p>
        </div>
      ) : (
        <CityUnavailableFallback origin={CITY_ORIGIN} onRetry={retry} />
      )}

      <p className="text-xs text-muted-foreground">
        If the embedded view stays blank while the service is reachable, the City app may disallow
        framing — use Open City above. Press Escape to leave full screen.
      </p>
    </div>
  );
}
