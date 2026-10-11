import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { WorkspaceExportRecovery } from "@/components/WorkspaceExportRecovery";
import { IssueRecoveryActionCard } from "@/components/IssueRecoveryActionCard";
import { RecoveryApiFixture, confirmStopped, issueId, queuedAction, recoveryAction, stopEvidence } from "./fixtures";

const meta = {
  title: "Workspace finalization recovery/01 Notice",
  component: WorkspaceExportRecovery,
  args: { issueId, action: recoveryAction, canManage: true, onQueued: () => {} },
  parameters: { layout: "fullscreen", docs: { description: { component: "The production recovery notice from PR #15824. Record platform stop evidence and confirm the exact previous controller and all copyback processes stopped, then resume the saved result. API responses are simulated; these examples do not modify staging." } } },
  decorators: [(Story, context) => <RecoveryApiFixture response={context.parameters.recoveryResponse ?? "success"}><div className="mx-auto max-w-2xl p-4 sm:p-8"><Story /></div></RecoveryApiFixture>],
} satisfies Meta<typeof WorkspaceExportRecovery>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsVerification: Story = {};
export const ReadyToResume: Story = { play: async ({ canvasElement }) => { await confirmStopped(canvasElement); } };
export const Queueing: Story = {
  parameters: { recoveryResponse: "pending" },
  play: async ({ canvasElement }) => {
    const { canvas, button } = await confirmStopped(canvasElement);
    await userEvent.click(button);
    await expect(await canvas.findByRole("button", { name: "Queueing…" })).toBeDisabled();
  },
};
export const ResumeSavedResult: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, button } = await confirmStopped(canvasElement);
    await userEvent.click(button);
    await expect(await canvas.findByRole("status")).toHaveTextContent("The agent will not repeat its work.");
  },
};
export const AlreadyQueued: Story = { args: { action: queuedAction } };
export const OwnerChanged: Story = {
  parameters: { recoveryResponse: "conflict" },
  play: async ({ canvasElement }) => {
    const { canvas, button } = await confirmStopped(canvasElement);
    await userEvent.click(button);
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Refresh the task and inspect its run.");
    await expect(canvas.getByRole("textbox")).toHaveValue(stopEvidence);
  },
};
export const ReadOnly: Story = { args: { canManage: false } };
export const Mobile: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
export const RecoveryDetails: Story = {
  render: () => <IssueRecoveryActionCard action={recoveryAction} onResolve={() => {}} canFalsePositive />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId("recovery-action-resolve-trigger")).not.toBeInTheDocument();
  },
};
