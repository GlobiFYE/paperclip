import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
  it("labels every state, naming the local M4 host when connected", () => {
    expect(STATE_LABEL.checking).toBeTruthy();
    expect(STATE_LABEL.connected).toContain("local M4 host");
    expect(STATE_LABEL.unreachable).toBeTruthy();
  });

  it("renders the page with navigation controls and the localhost caveat", () => {
    const markup = renderToStaticMarkup(<City />);
    expect(markup).toContain("data-testid=\"city-connection-state\"");
    expect(markup).toContain("data-testid=\"city-fullscreen-control\"");
    expect(markup).toContain("data-testid=\"city-open-control\"");
    expect(markup).toContain("Checking connection…");
    expect(markup).toContain(CITY_DEFAULT_ORIGIN);
    expect(markup).toContain("does not work from another device");
    expect(markup).toContain("VITE_CITY_URL");
  });
});

describe("City unavailable fallback", () => {
  it("stays usable: retry, open-in-new-tab, and remote wiring notes", () => {
    const onRetry = vi.fn();
    const markup = renderToStaticMarkup(
      <CityUnavailableFallback origin={CITY_DEFAULT_ORIGIN} onRetry={onRetry} />,
    );
    expect(markup).toContain(`City is not reachable at ${CITY_DEFAULT_ORIGIN}`);
    expect(markup).toContain("Try again");
    expect(markup).toContain(`href="${CITY_DEFAULT_ORIGIN}"`);
    expect(markup).toContain("target=\"_blank\"");
    expect(markup).toContain("rel=\"noopener noreferrer\"");
    expect(markup).toContain("VITE_CITY_URL");
  });
});
