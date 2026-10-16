import type { Db } from "@paperclipai/db";
import type { WorkerHostCallContext } from "@paperclipai/plugin-sdk";
import { forbidden, unprocessable } from "../errors.js";
import { agentFilePath, agentFileStore, inspectAgentFile } from "./agent-file-store.js";
import { instructionBytes } from "./agent-instruction-files.js";

export function instructionActionActor(companyId: string, context?: WorkerHostCallContext) {
  const scope = context?.invocationScope;
  if (context?.invalidInvocationScope || !scope?.actionUserId || scope.companyId !== companyId) {
    throw forbidden("Agent instruction access requires an authenticated user action in this company");
  }
  return { type: "board" as const, userId: scope.actionUserId };
}

export function pluginAgentInstructions(db: Db) {
  const files = agentFileStore(db);
  return {
    async read(input: { companyId: string; agentId: string; path: string }, context?: WorkerHostCallContext) {
      const actor = instructionActionActor(input.companyId, context);
      const relative = agentFilePath(input.path);
      return files.locked(input.companyId, input.agentId, actor, false, async (_tx, _agent, root) => {
        const file = await inspectAgentFile(root, relative);
        if (file && !file.bytes) throw unprocessable("Plugin instruction files must be UTF-8 text no larger than 1 MiB");
        const bytes = file?.bytes ? instructionBytes(file.bytes) : null;
        if (bytes?.includes(0)) throw unprocessable("Plugin instruction files must be text");
        return { path: relative, content: bytes?.toString("utf8") ?? null, contentHash: file?.hash ?? null };
      });
    },
    async write(input: { companyId: string; agentId: string; path: string; content: string; baseHash: string | null }, context?: WorkerHostCallContext) {
      const actor = instructionActionActor(input.companyId, context);
      if (typeof input.content !== "string" || input.content.includes("\0")) throw unprocessable("Plugin instruction files must be text");
      if (input.baseHash !== null && !/^[a-f0-9]{64}$/.test(input.baseHash)) throw unprocessable("A SHA-256 base hash or null is required");
      return files.write({ companyId: input.companyId, agentId: input.agentId, path: agentFilePath(input.path), baseHash: input.baseHash, bytes: instructionBytes(input.content), requireIdle: true }, actor);
    },
  };
}
