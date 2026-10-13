import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { CreateGrokInvitation, GrokConnection } from "@paperclipai/shared";
import { GrokBotSetupContent, type GrokSetupStep } from "@/components/new-agent/GrokBotSetupContent";
import { AnimatedDialogContent } from "@/components/AnimatedDialogContent";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QuestionChat } from "../../../fixtures/unansweredQuestionChat";

const bindingId = "11111111-1111-4111-8111-111111111111";
const connection: GrokConnection = { enabled: true, resourceUrl: "https://paperclip.example/mcp/runner", agentStatus: "idle",
  agentLifecycleState: "ready", canConfigureConnection: true, recoveryNeeded: false,
  binding: { id: bindingId, providerKind: "grok_bot", status: "connected", connected: true, subscriptionVerified: false,
    hasPendingChallenge: false, pairingExpiresAt: null, challengeExpiresAt: null, wakeVerified: false, routine: null } };
function SetupPreview({ initialStep = 0, outboundOnly = false, rejected = false, recovering = false, saved = false }: {
  initialStep?: GrokSetupStep; outboundOnly?: boolean; rejected?: boolean; recovering?: boolean; saved?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(initialStep);
  const [details, setDetails] = useState<CreateGrokInvitation>({ name: "Night Shift", botName: "Night Shift", role: "researcher", reportsTo: null });
  const [credentials, setCredentials] = useState({ url: "", key: "" });
  const [created, setCreated] = useState(saved);
  const [verified, setVerified] = useState(false);
  const [sent, setSent] = useState(outboundOnly || rejected || recovering);
  const routine = step === 3 ? { bindingId, botName: "Night Shift", revision: 1, configured: true, verified,
    verifiedAt: verified ? new Date().toISOString() : null, lastContactAt: verified ? new Date().toISOString() : null,
    recoveryNeeded: recovering, lastExchange: sent || verified ? { id: "synthetic-exchange", kind: "verify" as const,
      status: verified ? "acknowledged" as const : recovering ? "unknown" as const : rejected ? "rejected" as const : "accepted" as const,
      httpStatus: rejected ? 401 : recovering ? null : 200, sentAt: new Date().toISOString(), acknowledgedAt: verified ? new Date().toISOString() : null,
      expiresAt: new Date(Date.now() + 600000).toISOString() } : null } : null;
  const state: GrokConnection = { ...connection, recoveryNeeded: recovering, binding: { ...connection.binding!, status: verified ? "ready" : "connected", routine, wakeVerified: verified } };
  return open ? <Dialog open onOpenChange={setOpen}><AnimatedDialogContent className="sm:max-w-(--sz-560px)">
    <GrokBotSetupContent step={step} companyName="Acme" details={details} managers={[]} created={created}
      connection={state} pairing={{ bindingId, pairingCode: "synthetic-code-never-a-credential", expiresAt: new Date(Date.now() + 900000).toISOString() }}
      webhookUrl={credentials.url} webhookKey={credentials.key} onCredentials={(url, key) => setCredentials({ url, key })} onDetails={setDetails}
      onBack={() => setStep(Math.max(0, step - 1) as GrokSetupStep)} onExit={() => setOpen(false)}
      onRetry={() => { setSent(false); setVerified(false); }} onNext={() => {
        if (step < 3) { setCreated(true); setStep((step + 1) as GrokSetupStep); }
        else if (verified) setOpen(false); else { setSent(true); if (!outboundOnly && !rejected && !recovering) setVerified(true); }
      }} />
  </AnimatedDialogContent></Dialog> : <p className="p-6">Setup saved. Reopen Grok Bot setup to continue with the same agent.</p>;
}
const meta = {
  id: "onboarding-grok-bot-journeys",
  title: "Agents and reusable capabilities/Hiring, configuration, and organization/Onboarding/Grok Bot/Journeys",
  component: SetupPreview, parameters: { layout: "fullscreen", docs: { description: { component: "Production setup presentation with simulated server evidence. These stories create no OAuth connection, routine, task or managed job. A real authenticated challenge receipt is required in the app. The question fixture uses the existing task thread and durable input-card UI; its callbacks are simulated." } } },
} satisfies Meta<typeof SetupPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FreshSetup: Story = {};
export const SavedSetup: Story = { args: { initialStep: 1, saved: true } };
export const ConfigureRoutine: Story = { args: { initialStep: 2, saved: true } };
export const OutboundOnly: Story = { args: { initialStep: 3, outboundOnly: true, saved: true }, play: async ({ canvasElement }) => {
  const page = within(canvasElement.ownerDocument.body);
  await expect(page.getByText("The routine accepted delivery. Waiting for an authenticated reply to Paperclip.")).toBeVisible();
  await expect(page.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
} };
export const IncorrectCredentials: Story = { args: { initialStep: 3, rejected: true, saved: true } };
export const BrokenConnection: Story = { args: { initialStep: 3, recovering: true, saved: true } };
export const VerifyAndFinish: Story = { args: { initialStep: 3, saved: true }, play: async ({ canvasElement }) => {
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(page.getByRole("button", { name: "Verify connection" }));
  await expect(page.getByRole("heading", { name: "Your Grok Bot is connected" })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Done" }));
  await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
} };
function WorkJourney() {
  const [stage, setStage] = useState(0);
  const stages = ["First assignment", "Question and answer", "Result and review", "Proactive work", "Broken connection", "Recovery"];
  return <div className="space-y-4 p-6">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Night Shift in Paperclip</h1><p className="text-sm text-muted-foreground">Guided fixture journey. Runs in Grok Bot · Usage not reported.</p></div><Button disabled={stage === stages.length - 1} onClick={() => setStage(stage + 1)}>Next</Button></div>
    <h2 className="text-lg font-medium">{stages[stage]}</h2>
    {stage === 0 && <p className="text-sm">Assign “Research three competitors and write a comparison” with the normal task composer. The task begins awaiting acknowledgement, then shows Paperclip-reported progress.</p>}
    {stage === 1 && <QuestionChat conversationMode={false} />}
    {stage === 2 && <p className="text-sm">Open the task’s comparison document and attached files. Reported completion follows the company’s normal assessment and review rules.</p>}
    {stage === 3 && <p className="text-sm">Tell Night Shift in Grok: “Track this investigation in Paperclip.” It creates one governed intake and claims the admitted session without an immediate duplicate dispatch.</p>}
    {stage === 4 && <p role="alert" className="text-sm">Recovery needed. Delivery is uncertain; Paperclip will not resend it automatically.</p>}
    {stage === 5 && <p className="text-sm">Stop Paperclip work, inspect Night Shift in the Grok Bot desktop app, clear the recovery hold, then verify again. Paperclip records the inspection without asserting remote termination.</p>}
  </div>;
}
export const GuidedWorkJourney: Story = { render: () => <WorkJourney /> };
