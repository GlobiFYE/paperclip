import { lazy, Suspense, useState } from "react";
import { useDialogState } from "../context/DialogContext";
import { useLocation } from "../lib/router";
import { isOnboardingPath } from "../lib/onboarding-route";
import { PaperclipLoading } from "./AnimatedPaperclipIcon";

const OnboardingWizard = lazy(() => import("./OnboardingWizard").then((module) => ({ default: module.OnboardingWizard })));

/**
 * Default onboarding wizard. Conference-room chat is now the only surface left
 * behind `enableConferenceRoomChat`; onboarding stays available without that
 * experimental flag.
 */
export function OnboardingWizardVariant() {
  const { onboardingOpen } = useDialogState();
  const { pathname } = useLocation();
  const requested = onboardingOpen || isOnboardingPath(pathname);
  const [activated, setActivated] = useState(requested);
  if (requested && !activated) setActivated(true);
  if (!requested && !activated) return null;
  return <Suspense fallback={<div className="fixed inset-0 z-50 bg-background"><PaperclipLoading /></div>}><OnboardingWizard /></Suspense>;
}
