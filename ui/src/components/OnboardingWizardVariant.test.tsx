// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizardVariant } from "./OnboardingWizardVariant";

const state = vi.hoisted(() => ({ onboardingOpen: false, onboardingRouteDismissed: false, pathname: "/PAP/issues/PAP-1" }));
const mount = vi.hoisted(() => vi.fn());
vi.mock("../context/DialogContext", () => ({ useDialogState: () => state, useDialogActions: () => ({ closeOnboarding: vi.fn(), setOnboardingRouteDismissed: vi.fn() }) }));
vi.mock("../lib/router", () => ({ useLocation: () => state }));
vi.mock("./OnboardingWizard", () => ({
  OnboardingWizard: () => { mount(); return <div data-testid="wizard-capsule" />; },
}));

describe("OnboardingWizardVariant", () => {
  let container: HTMLDivElement;
  let root: Root;
  async function renderVariant() {
    await act(async () => { root.render(<OnboardingWizardVariant />); });
  }
  beforeEach(() => {
    state.onboardingOpen = false;
    state.pathname = "/PAP/issues/PAP-1";
    mount.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it("does not mount the onboarding dependency tree when opening a task", async () => {
    await renderVariant();
    expect(container.innerHTML).toBe("");
    expect(mount).not.toHaveBeenCalled();
  });
  it.each(["/onboarding", "/PAP/onboarding"])("loads the wizard for %s", async (pathname) => {
    state.pathname = pathname;
    await renderVariant();
    expect(container.querySelector('[data-testid="wizard-capsule"]')).not.toBeNull();
  });
  it("loads on dialog request and preserves the mounted wizard after closing", async () => {
    await renderVariant();
    state.onboardingOpen = true;
    await renderVariant();
    const wizard = container.querySelector('[data-testid="wizard-capsule"]');
    expect(wizard).not.toBeNull();
    state.onboardingOpen = false;
    await renderVariant();
    expect(container.querySelector('[data-testid="wizard-capsule"]')).toBe(wizard);
  });
});
