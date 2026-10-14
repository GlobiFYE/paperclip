import { createHash } from "node:crypto";
import { isSpanContextValid, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";

type PreparationPhase = "environment_selection" | "execution_configuration" | "session"
  | "workspace" | "github_environment" | "github_launchers" | "run_output"
  | "workspace_validation" | "runtime_services" | "instructions" | "runtime_selection"
  | "configuration_mentions" | "configuration_github_identity" | "configuration_secrets"
  | "configuration_ai_runtime" | "configuration_skills" | "configuration_connector_assignments"
  | "configuration_connector_skills" | "configuration_connector_delivery"
  | "configuration_connection_instructions" | "configuration_agent_identity"
  | "workspace_source_resolution"
  | "workspace_provision_policy"
  | "workspace_base_validation"
  | "workspace_source_authorization"
  | "workspace_provision"
  | "workspace_source_retention"
  | "workspace_binding"
  | "workspace_record_update"
  | "workspace_record_create"
  | "workspace_operation_binding"
  | "workspace_config_recording"
  | "workspace_repository_admission"
  | "workspace_project_repositories"
  | "workspace_recovery_root";

export function createHeartbeatPreparationTiming(runId: string) {
  const runIdHash = createHash("sha256").update(runId).digest("hex").slice(0, 12);
  return <T>(phase: PreparationPhase, work: () => Promise<T>): Promise<T> => {
    const trigger = trace.getActiveSpan()?.spanContext();
    return trace.getTracer("paperclip.heartbeat-preparation").startActiveSpan(
      `heartbeat.prepare.${phase}`,
      {
        attributes: { "paperclip.task.run.run_id": runIdHash },
        ...(trigger && isSpanContextValid(trigger) ? { links: [{ context: trigger }] } : {}),
      },
      ROOT_CONTEXT,
      async (span) => {
        try {
          return await work();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}
