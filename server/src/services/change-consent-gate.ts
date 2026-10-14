import { createHash } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { issueThreadInteractions } from "@paperclipai/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type {
  AgentDesiredSkillEntry,
  RequestConfirmationPayload,
  RequestConfirmationResult,
} from "@paperclipai/shared";
import { forbidden } from "../errors.js";

export const AGENT_PROFILE_CHANGE_CONSENT_FIELDS = ["name", "role", "title", "capabilities"] as const;

type ConsumedRequestConfirmationResult = RequestConfirmationResult & {
  consumedAt?: string | null;
  consumedByRunId?: string | null;
};

export type ChangeConsentTarget = {
  key: string;
  revisionId?: string | null;
};

export function agentInstructionsChangeTargetKey(agentId: string) {
  return `agent:${agentId}:instructions`;
}

export function agentProfileChangeTargetKey(agentId: string) {
  return `agent:${agentId}:profile`;
}

export function agentSkillAssignmentChangeTargetKey(agentId: string) {
  return `agent:${agentId}:skills`;
}

export function agentSkillAssignmentChangeRevisionId(desiredSkills: AgentDesiredSkillEntry[]) {
  const selectionsByKey = new Map<string, AgentDesiredSkillEntry>();
  for (const entry of desiredSkills) {
    const key = entry.key.trim();
    if (key && !selectionsByKey.has(key)) {
      selectionsByKey.set(key, { key, versionId: entry.versionId ?? null });
    }
  }
  const canonicalSelections = [...selectionsByKey.values()]
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalSelections))
    .digest("hex");
  return `add:sha256:${digest}`;
}

export function skillChangeTargetKey(skillId: string) {
  return `skill:${skillId}`;
}

export function skillSlugChangeTargetKey(slug: string) {
  return `skill-slug:${slug}`;
}

export function skillImportChangeTargetKey(source: string) {
  return `skill-import:${source}`;
}

export function skillsScanProjectsChangeTargetKey() {
  return "skills:scan-projects";
}

export function touchesAgentProfileChangeConsentFields(patchData: Record<string, unknown>) {
  return AGENT_PROFILE_CHANGE_CONSENT_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(patchData, key),
  );
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function payloadHasDisplayedDiff(payload: RequestConfirmationPayload) {
  const details = readNonEmptyString(payload.detailsMarkdown);
  if (!details) return false;
  if (/```diff\b/i.test(details)) return true;
  return /(^|\n)[+-][^\n]+/.test(details);
}

function requestConfirmationResultConsumed(result: RequestConfirmationResult | null) {
  const consumed = result as ConsumedRequestConfirmationResult | null;
  return Boolean(readNonEmptyString(consumed?.consumedByRunId) || readNonEmptyString(consumed?.consumedAt));
}

function markRequestConfirmationResultConsumed(
  result: RequestConfirmationResult,
  actorRunId: string,
  consumedAt: Date,
): ConsumedRequestConfirmationResult {
  return {
    ...result,
    consumedAt: consumedAt.toISOString(),
    consumedByRunId: actorRunId,
  };
}

function legacyTargetKeysFor(targetKey: string) {
  if (targetKey.startsWith("agent:") && targetKey.endsWith(":instructions")) {
    const agentId = targetKey.slice("agent:".length, -":instructions".length);
    if (agentId) return [`reflection-coach:agent-instructions:${agentId}`];
  }
  if (targetKey.startsWith("agent:") && targetKey.endsWith(":profile")) {
    const agentId = targetKey.slice("agent:".length, -":profile".length);
    if (agentId) return [`reflection-coach:agent-description:${agentId}`];
  }
  if (targetKey.startsWith("skill:")) {
    const skillId = targetKey.slice("skill:".length);
    if (skillId) return [`reflection-coach:company-skill:${skillId}`];
  }
  if (targetKey.startsWith("skill-slug:")) {
    const slug = targetKey.slice("skill-slug:".length);
    if (slug) return [`reflection-coach:company-skill-slug:${slug}`];
  }
  if (targetKey.startsWith("skill-import:")) {
    const source = targetKey.slice("skill-import:".length);
    if (source) {
      return [
        `reflection-coach:company-skill-import:${source}`,
        `reflection-coach:company-skill-catalog:${source}`,
      ];
    }
  }
  if (targetKey === "skills:scan-projects") {
    return ["reflection-coach:company-skills:scan-projects"];
  }
  return [];
}

function normalizeConsentTargets(input: {
  targetKeys?: string[];
  targets?: ChangeConsentTarget[];
}) {
  const exactTargets = (input.targets ?? []).flatMap((target) => {
    const key = readNonEmptyString(target.key);
    if (!key) return [];
    return [{ key, revisionId: readNonEmptyString(target.revisionId) }];
  });
  const keyOnlyTargets = (input.targetKeys ?? [])
    .map(readNonEmptyString)
    .filter((key): key is string => Boolean(key))
    .map((key) => ({ key, revisionId: null }));
  const targets = [...exactTargets, ...keyOnlyTargets];
  const expanded = new Map<string, ChangeConsentTarget>();
  for (const target of targets) {
    expanded.set(`${target.key}\u0000${target.revisionId ?? ""}`, target);
    for (const legacyKey of legacyTargetKeysFor(target.key)) {
      expanded.set(`${legacyKey}\u0000${target.revisionId ?? ""}`, {
        key: legacyKey,
        revisionId: target.revisionId,
      });
    }
  }
  return [...expanded.values()];
}

export function changeConsentGateService(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]) {
  return {
    assertConsented: async (input: {
      companyId: string;
      actorAgentId: string | null | undefined;
      actorRunId: string | null | undefined;
      targetKeys?: string[];
      targets?: ChangeConsentTarget[];
    }): Promise<boolean> => {
      const actorAgentId = readNonEmptyString(input.actorAgentId);
      if (!actorAgentId) return false;

      const actorRunId = readNonEmptyString(input.actorRunId);
      if (!actorRunId) {
        throw forbidden("Reflection Coach mutations require a run id", {
          code: "reflection_coach_mutation_run_id_required",
        });
      }

      const targets = normalizeConsentTargets(input);
      if (targets.length === 0) {
        throw forbidden("Reflection Coach mutation target is not gateable", {
          code: "reflection_coach_mutation_target_required",
        });
      }
      const targetKeys = [...new Set(targets.map((target) => target.key))];

      const targetKeyPredicate = or(
        ...targetKeys.map((targetKey) =>
          sql`${issueThreadInteractions.payload}->'target'->>'key' = ${targetKey}`,
        ),
      );

      const rows = await db
        .select({
          id: issueThreadInteractions.id,
          sourceRunId: issueThreadInteractions.sourceRunId,
          payload: issueThreadInteractions.payload,
          result: issueThreadInteractions.result,
        })
        .from(issueThreadInteractions)
        .where(and(
          eq(issueThreadInteractions.companyId, input.companyId),
          eq(issueThreadInteractions.createdByAgentId, actorAgentId),
          eq(issueThreadInteractions.kind, "request_confirmation"),
          eq(issueThreadInteractions.status, "accepted"),
          targetKeyPredicate,
        ))
        .orderBy(desc(issueThreadInteractions.resolvedAt), desc(issueThreadInteractions.createdAt))
        .limit(10);

      const accepted = rows.find((row) => {
        const payload = row.payload as RequestConfirmationPayload;
        const result = row.result as RequestConfirmationResult | null;
        const matchingTarget = payload.target?.type === "custom"
          ? targets.find((target) => target.key === payload.target?.key)
          : null;
        return payload.target?.type === "custom"
          && Boolean(matchingTarget)
          && (!matchingTarget?.revisionId || payload.target.revisionId === matchingTarget.revisionId)
          && result?.outcome === "accepted"
          && !requestConfirmationResultConsumed(result)
          && payloadHasDisplayedDiff(payload)
          && Boolean(row.sourceRunId)
          && row.sourceRunId !== actorRunId;
      });

      if (!accepted) {
        throw forbidden(
          "Reflection Coach mutations require an accepted request_confirmation with a displayed diff for this target, "
            + "created in a previous run and not already consumed.",
          {
            code: "reflection_coach_mutation_gate_required",
            targetKeys,
          },
        );
      }

      const acceptedResult = accepted.result as RequestConfirmationResult | null;
      if (!acceptedResult) {
        throw forbidden(
          "Reflection Coach mutations require an accepted request_confirmation with a displayed diff for this target, "
            + "created in a previous run and not already consumed.",
          {
            code: "reflection_coach_mutation_gate_required",
            targetKeys,
          },
        );
      }

      const now = new Date();
      const [consumed] = await db
        .update(issueThreadInteractions)
        .set({
          result: markRequestConfirmationResultConsumed(acceptedResult, actorRunId, now),
          updatedAt: now,
        })
        .where(and(
          eq(issueThreadInteractions.id, accepted.id),
          eq(issueThreadInteractions.companyId, input.companyId),
          eq(issueThreadInteractions.createdByAgentId, actorAgentId),
          eq(issueThreadInteractions.kind, "request_confirmation"),
          eq(issueThreadInteractions.status, "accepted"),
          sql`${issueThreadInteractions.result}->>'outcome' = 'accepted'`,
          sql`coalesce(${issueThreadInteractions.result}->>'consumedByRunId', ${issueThreadInteractions.result}->>'consumedAt') is null`,
        ))
        .returning({ id: issueThreadInteractions.id });

      if (!consumed) {
        throw forbidden(
          "Reflection Coach mutations require an accepted request_confirmation with a displayed diff for this target, "
            + "created in a previous run and not already consumed.",
          {
            code: "reflection_coach_mutation_gate_required",
            targetKeys,
          },
        );
      }

      return true;
    },
  };
}
