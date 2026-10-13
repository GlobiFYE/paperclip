import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  toolProfileBindings,
  toolProfileEntries,
  toolProfiles,
} from "@paperclipai/db";

export const PLUGIN_TOOL_GRANT_PROFILE_KEY_PREFIX = "plugin-grant:";
export const PLUGIN_TOOL_GRANT_MANAGED_BY = "plugin-tool-grants";

export function pluginToolGrantProfileKey(pluginKey: string, agentId: string) {
  return `${PLUGIN_TOOL_GRANT_PROFILE_KEY_PREFIX}${pluginKey}:${agentId}`;
}

export function pluginToolGrantProfileName(pluginKey: string, agentId: string) {
  return `Plugin tools ${pluginKey} (${agentId})`;
}

export interface SyncPluginToolGrantsInput {
  companyId: string;
  agentId: string;
  pluginKey: string;
  grantedToolNames: string[];
}

export async function syncPluginToolGrants(db: Db, input: SyncPluginToolGrantsInput): Promise<void> {
  const profileKey = pluginToolGrantProfileKey(input.pluginKey, input.agentId);
  const grantedToolNames = [...new Set(input.grantedToolNames)]
    .map((toolName) => toolName.trim())
    .filter((toolName) => toolName.length > 0)
    .sort();

  const existing = await db
    .select({ id: toolProfiles.id })
    .from(toolProfiles)
    .where(and(eq(toolProfiles.companyId, input.companyId), eq(toolProfiles.profileKey, profileKey)))
    .then((rows) => rows[0] ?? null);

  if (grantedToolNames.length === 0) {
    if (existing) {
      await db.delete(toolProfiles).where(eq(toolProfiles.id, existing.id));
    }
    return;
  }

  const metadata = {
    managedBy: PLUGIN_TOOL_GRANT_MANAGED_BY,
    pluginKey: input.pluginKey,
    agentId: input.agentId,
  };
  const name = pluginToolGrantProfileName(input.pluginKey, input.agentId);

  let profileId: string;
  if (existing) {
    profileId = existing.id;
    await db
      .update(toolProfiles)
      .set({ name, status: "active", defaultAction: "deny", metadata, updatedAt: new Date() })
      .where(eq(toolProfiles.id, profileId));
    await db
      .delete(toolProfileEntries)
      .where(and(eq(toolProfileEntries.companyId, input.companyId), eq(toolProfileEntries.profileId, profileId)));
  } else {
    const inserted = await db
      .insert(toolProfiles)
      .values({
        companyId: input.companyId,
        profileKey,
        name,
        description: `Plugin-contributed tools granted by ${input.pluginKey}`,
        status: "active",
        defaultAction: "deny",
        metadata,
      })
      .returning({ id: toolProfiles.id });
    profileId = inserted[0]!.id;
  }

  await db.insert(toolProfileEntries).values(
    grantedToolNames.map((toolName) => ({
      companyId: input.companyId,
      profileId,
      selectorType: "tool_name" as const,
      effect: "include" as const,
      toolName,
    })),
  );

  const binding = await db
    .select({ id: toolProfileBindings.id })
    .from(toolProfileBindings)
    .where(
      and(
        eq(toolProfileBindings.companyId, input.companyId),
        eq(toolProfileBindings.profileId, profileId),
        eq(toolProfileBindings.targetType, "agent"),
        eq(toolProfileBindings.targetId, input.agentId),
      ),
    )
    .then((rows) => rows[0] ?? null);

  if (!binding) {
    await db.insert(toolProfileBindings).values({
      companyId: input.companyId,
      profileId,
      targetType: "agent",
      targetId: input.agentId,
      priority: 100,
      metadata,
    });
  }
}
