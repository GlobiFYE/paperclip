import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { resolveCodexAcpBillingIdentity } from "@paperclipai/adapter-codex-local/server";
import { resolveClaudeAcpBillingIdentity } from "@paperclipai/adapter-claude-local/server";
import type { TaskBudgetMeteringSupport } from "@paperclipai/shared";

/** Capabilities describe authoritative receipts, never a model-price estimate. */
export function taskBudgetMeteringSupport(
  adapterType: string,
  context: Pick<AdapterExecutionContext, "config"> & Partial<Pick<AdapterExecutionContext, "executionTarget">>,
  nativeProvider?: string,
): TaskBudgetMeteringSupport {
  const unsupported: TaskBudgetMeteringSupport = {
    billedCents: "unsupported", totalTokens: "unsupported", reportingBoundary: "run_end",
  };
  if (adapterType === "paperclip_runner") {
    const config = context.config;
    const provider = nativeProvider ?? config.provider ?? "codex";
    adapterType = provider === "codex" || provider === "acpx" && config.acpxAgent === "codex" ? "codex_local"
      : provider === "acpx" && config.acpxAgent === "claude" ? "claude_local" : "unsupported";
  }
  if (nativeProvider && !["acpx", "codex"].includes(nativeProvider)) return unsupported;
  if (adapterType !== "codex_local" && adapterType !== "claude_local") return unsupported;
  const identity = adapterType === "codex_local"
    ? resolveCodexAcpBillingIdentity(context) : resolveClaudeAcpBillingIdentity(context);
  // Remote images may contain credentials that the controller cannot inspect.
  // Their included billing mode cannot be proven by absence of a host API key.
  const remoteSubscription = context.executionTarget?.kind === "remote" && identity.billingType === "subscription";
  return {
    billedCents: remoteSubscription ? "unsupported"
      : identity.billingType === "subscription" ? "included_zero"
      : adapterType === "claude_local" && identity.biller === "anthropic" ? "reported" : "unsupported",
    totalTokens: "reported", reportingBoundary: "run_end",
  };
}
