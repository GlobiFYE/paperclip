import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "@/lib/router";
import { Layout } from "@/components/Layout";
import { TaskChatBubble } from "@/components/task-chat/TaskChatBubble";
import { TaskChatComposer } from "@/components/task-chat/TaskChatComposer";
import { WorkspaceExportRecovery } from "@/components/WorkspaceExportRecovery";
import { StatusBadge } from "@/components/StatusBadge";
import { PluginLauncherProvider } from "@/plugins/launchers";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { RecoveryApiFixture, issueId, recoveryAction } from "./fixtures";

function TaskConversation() {
  const [messages, setMessages] = useState<string[]>([]);
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "Tasks", href: "/PAP/issues" }, { label: "Prepare the rollout plan", identifier: "PAP-24" }]); }, [setBreadcrumbs]);
  return <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status="in_progress" /><span className="font-mono text-xs text-muted-foreground">PAP-24</span></div>
      <h1 className="text-xl font-semibold">Prepare the rollout plan</h1>
      <p className="text-sm text-muted-foreground">Assigned to Jordan Lee</p>
    </header>
    <TaskChatBubble item={{ id: "request", kind: "message", author: "human", text: "Prepare the rollout plan and wait for my confirmation before starting implementation." }} />
    <TaskChatBubble item={{ id: "saved-result", kind: "message", author: "agent", authorName: "Jordan Lee", text: "The plan is ready. I’m waiting for your confirmation before continuing." }} />
    <WorkspaceExportRecovery issueId={issueId} action={recoveryAction} canManage onQueued={() => {}} />
    {messages.map((text, index) => <TaskChatBubble key={index} item={{ id: `followup-${index}`, kind: "message", author: "human", text }} />)}
    <div className="flex-1" />
    <TaskChatComposer workMode="standard" onAdd={async body => setMessages(current => [...current, body])} placeholder="Message Jordan Lee…" />
  </main>;
}

function Journey() {
  return <RecoveryApiFixture><PluginLauncherProvider><Routes><Route path="/:companyPrefix" element={<Layout />}><Route path="issues/:issueId" element={<TaskConversation />} /></Route></Routes></PluginLauncherProvider></RecoveryApiFixture>;
}
const meta = {
  title: "Workspace finalization recovery/02 Task journey", component: Journey,
  parameters: { layout: "fullscreen", initialEntries: ["/PAP/issues/PAP-24"], docs: { description: { component: "A composed task conversation in the production app shell, using the shipped recovery notice, task bubbles and composer. Record stop evidence, confirm shutdown, and resume the saved result. This simulates queue admission only; finalization and approval resolution are verified separately by server tests." }, story: { inline: false } } },
} satisfies Meta<typeof Journey>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ResumeInContext: Story = {};
export const Mobile: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
