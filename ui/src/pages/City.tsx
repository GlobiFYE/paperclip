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
 *
 * Dragon World (TOP-175):
 * - An optional second City world served at `http://127.0.0.1:5182` (M4-only
 *   private preview), configurable via `VITE_DRAGON_CITY_URL`.
 * - The page header includes an accessible two-choice Town / Dragon World
 *   toggle. Default is Town; `?world=dragon` selects Dragon World.
 * - Both worlds share the same connection probe, retry, fullscreen, and
 *   open-in-new-tab controls; the active origin reflects the selected world.
 * - The page height (phone canvas `h-(--sz-calc-38)`), document title,
 *   breadcrumb, and source role board remain unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2,
  ExternalLink,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

/** Default City origin: the M4 host's localhost. Overridable via VITE_CITY_URL. */
export const CITY_DEFAULT_ORIGIN = "http://127.0.0.1:5180";

/** Default Dragon World origin: the M4 host's localhost. Overridable via VITE_DRAGON_CITY_URL. */
export const DRAGON_DEFAULT_ORIGIN = "http://127.0.0.1:5182";

const CITY_ORIGIN = (
  import.meta.env.VITE_CITY_URL?.trim() || CITY_DEFAULT_ORIGIN
).replace(/\/+$/, "");

const DRAGON_CITY_ORIGIN = (
  import.meta.env.VITE_DRAGON_CITY_URL?.trim() || DRAGON_DEFAULT_ORIGIN
).replace(/\/+$/, "");

export type CityWorld = "town" | "dragon";

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
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "City" }]); }, [setBreadcrumbs]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [connection, setConnection] = useState<CityConnectionState>("checking");
  const [probeNonce, setProbeNonce] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const frameAreaRef = useRef<HTMLDivElement | null>(null);

  // Default to Town; ?world=dragon selects Dragon World preview.
  // URL is the single source of truth — no local useState that bypasses React Router.
  const world: CityWorld = searchParams.get("world") === "dragon" ? "dragon" : "town";

  const activeOrigin = world === "dragon" ? DRAGON_CITY_ORIGIN : CITY_ORIGIN;
  const activeOriginIsLoopback = isLoopbackOrigin(activeOrigin);

  // Probe the active origin whenever world or probeNonce changes.
  useEffect(() => {
    let cancelled = false;
    setConnection("checking");
    probeCityOrigin(activeOrigin).then((reachable) => {
      if (!cancelled) setConnection(reachable ? "connected" : "unreachable");
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrigin, probeNonce]);

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
      window.open(activeOrigin, "_blank", "noopener,noreferrer");
    }
  }, [activeOrigin]);

  const selectWorld = useCallback((next: CityWorld) => {
    // Only exact world=dragon selects Dragon; no arbitrary URL allowed.
    if (next === "dragon") {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("world", "dragon");
          return next;
        },
        { replace: false },
      );
    } else {
      // Remove 'world' param so default stays Town, preserving other params.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("world");
          return next;
        },
        { replace: false },
      );
    }
  }, [setSearchParams]);

  return (
    <div
      ref={frameAreaRef}
      className={`flex min-h-0 flex-col gap-3 bg-background p-4 ${fullscreenActive ? "h-dvh" : "h-(--sz-calc-38) md:h-full"}`}
      data-page="city"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Building2 className="h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
        <h1 className="text-(length:--text-compact) font-semibold text-foreground">City</h1>

        {/* Accessible two-choice Town / Dragon World selector */}
        <div
          role="group"
          aria-label="Select City world"
          className="flex items-center rounded-md border border-border bg-muted p-0.5"
        >
          <button
            type="button"
            aria-pressed={world === "town"}
            data-testid="city-world-town"
            onClick={() => selectWorld("town")}
            className={cn(
              "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              world === "town"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Town
          </button>
          <button
            type="button"
            aria-pressed={world === "dragon"}
            data-testid="city-world-dragon"
            onClick={() => selectWorld("dragon")}
            className={cn(
              "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              world === "dragon"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Dragon World
          </button>
        </div>

        <span
          data-testid="city-connection-state"
          className="rounded-lg border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {STATE_LABEL[connection]}
        </span>
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
            <a href={activeOrigin} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open City
            </a>
          </Button>
        </div>
      </header>

      <p data-testid="city-local-m4-caveat" className="text-xs text-muted-foreground">
        {activeOriginIsLoopback ? "City requires a browser on the M4 host." : "Explore your workforce in City."}
      </p>

      {connection === "connected" ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          <iframe
            src={`${activeOrigin}/`}
            title="City application"
            className="h-full w-full border-0 bg-background"
          />
        </div>
      ) : connection === "checking" ? (
        <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 rounded-lg border border-border bg-muted p-6">
          <p className="text-sm text-foreground" aria-live="polite">
            Contacting City at{" "}
            <span className="font-mono break-all">{activeOrigin}</span>…
          </p>
        </div>
      ) : (
        <CityUnavailableFallback origin={activeOrigin} onRetry={retry} />
      )}

      <p className="text-xs text-muted-foreground">
        {fullscreenActive ? "Press Escape to leave full screen." : "Use Open City to explore in a separate tab."}
      </p>
    </div>
  );
}
