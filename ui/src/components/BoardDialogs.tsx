import { lazy, Suspense, useState, type ReactNode } from "react";
import { useDialogState } from "../context/DialogContext";
import { PaperclipLoading } from "./AnimatedPaperclipIcon";

const NewIssueDialog = lazy(() => import("./NewIssueDialog").then((module) => ({ default: module.NewIssueDialog })));
const NewProjectDialog = lazy(() => import("./NewProjectDialog").then((module) => ({ default: module.NewProjectDialog })));
const NewGoalDialog = lazy(() => import("./NewGoalDialog").then((module) => ({ default: module.NewGoalDialog })));
const NewAgentDialog = lazy(() => import("./NewAgentDialog").then((module) => ({ default: module.NewAgentDialog })));

function DeferredDialog({ open, children }: { open: boolean; children: ReactNode }) {
  const [activated, setActivated] = useState(open);
  if (open && !activated) setActivated(true);
  if (!open && !activated) return null;
  return <Suspense fallback={open ? <div className="fixed inset-0 z-50 bg-background/80"><PaperclipLoading /></div> : null}>{children}</Suspense>;
}

export function BoardDialogs() {
  const { newIssueOpen, newProjectOpen, newGoalOpen, newAgentOpen } = useDialogState();
  return <>
    <DeferredDialog open={newIssueOpen}><NewIssueDialog /></DeferredDialog>
    <DeferredDialog open={newProjectOpen}><NewProjectDialog /></DeferredDialog>
    <DeferredDialog open={newGoalOpen}><NewGoalDialog /></DeferredDialog>
    <DeferredDialog open={newAgentOpen}><NewAgentDialog /></DeferredDialog>
  </>;
}
