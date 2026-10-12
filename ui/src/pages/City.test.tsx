import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BreadcrumbProvider } from "../context/BreadcrumbContext";
import {
  City,
  CITY_DEFAULT_ORIGIN,
  CityUnavailableFallback,
  isLoopbackOrigin,
  STATE_LABEL,
} from "./City";

describe("City origin handling", () => {
  it("defaults to the local M4 host's localhost origin", () => {
    expect(CITY_DEFAULT_ORIGIN).toBe("http://127.0.0.1:5180");
  });

  it("classifies loopback origins explicitly", () => {
    expect(isLoopbackOrigin("http://127.0.0.1:5180")).toBe(true);
    expect(isLoopbackOrigin("http://localhost:5180")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:5180")).toBe(true);
    expect(isLoopbackOrigin("https://city.example-lan.local")).toBe(false);
    expect(isLoopbackOrigin("not a url")).toBe(false);
  });
});

describe("City connection state", () => {
  it("labels a successful probe as service reachability, not live-feed proof", () => {
    expect(STATE_LABEL.checking).toBeTruthy();
    expect(STATE_LABEL.connected).toBe("Service reachable");
    expect(STATE_LABEL.connected).not.toMatch(/agent feed|verified/i);
    expect(STATE_LABEL.unreachable).toBeTruthy();
  });

  it("renders the page with controls and a concise local-M4 caveat only", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <BreadcrumbProvider>
          <City />
        </BreadcrumbProvider>
      </MemoryRouter>,
    );
    expect(markup).toContain("data-testid=\"city-connection-state\"");
    expect(markup).toContain("data-testid=\"city-fullscreen-control\"");
    expect(markup).toContain("data-testid=\"city-open-control\"");
    expect(markup).toContain("Checking connection…");
    expect(markup).toContain(CITY_DEFAULT_ORIGIN);
    expect(markup).toContain("requires a browser on the M4 host");
    // Developer setup/filepath/launchd prose stays in source comments, not the UI.
    expect(markup).not.toContain("VITE_CITY_URL");
    expect(markup).not.toContain("com.pantheon.city");
    expect(markup).not.toContain("launch service");
    expect(markup).not.toContain("City.tsx");
    // No physical-device inference from the page hostname.
    expect(markup).not.toContain("different device");
    expect(markup).not.toContain("city-remote-browser-warning");
  });
});

describe("City unavailable fallback", () => {
  it("stays usable: retry and open-in-new-tab, without setup prose", () => {
    const onRetry = vi.fn();
    const markup = renderToStaticMarkup(
      <CityUnavailableFallback origin={CITY_DEFAULT_ORIGIN} onRetry={onRetry} />,
    );
    expect(markup).toContain(`City is not reachable at ${CITY_DEFAULT_ORIGIN}`);
    expect(markup).toContain("Try again");
    expect(markup).toContain(`href="${CITY_DEFAULT_ORIGIN}"`);
    expect(markup).toContain("target=\"_blank\"");
    expect(markup).toContain("rel=\"noopener noreferrer\"");
    expect(markup).toContain("browser must be on the M4 host");
    expect(markup).not.toContain("VITE_CITY_URL");
    expect(markup).not.toContain("com.pantheon.city");
    expect(markup).not.toContain("reverse proxy");
  });
});
