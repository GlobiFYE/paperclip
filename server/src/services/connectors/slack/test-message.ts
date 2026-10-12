import { and, eq, gte, ne } from "drizzle-orm";
import { agents, chatActions, chatEndpoints, chatExternalPrincipals, chatIdentityLinks, chatSlackManagerGrants, companyMemberships, toolConnections, type Db } from "@paperclipai/db";
import { slackTestMessageSchema, type SlackTestMessageInput, type SlackTestMessageResult } from "@paperclipai/shared";
import { conflict, forbidden, notFound, tooManyRequests, unprocessable } from "../../../errors.js";
import { logActivity } from "../../activity-log.js";
import { instanceSettingsService } from "../../instance-settings.js";
import { createSlackSetupClient, object } from "./setup/provider-client.js";
import type { SlackSetupActor, SlackSetupOptions } from "./setup/registration.js";

type Options = Pick<SlackSetupOptions, "fetch" | "withLock" | "runtimeBotToken" | "linkInstaller">;
const human = (user: Record<string, unknown>, workspaceId: string) =>
  typeof user.id === "string" && /^[UW][A-Z0-9]+$/.test(user.id) && user.team_id === workspaceId &&
  user.is_bot === false && user.is_app_user !== true && user.deleted !== true && user.id !== "USLACKBOT";

export function slackTestMessageService(db: Db, options: Options) {
  const api = createSlackSetupClient(options.fetch);
  return async (endpointId: string, actor: SlackSetupActor, rawInput: SlackTestMessageInput): Promise<SlackTestMessageResult> => {
    const input = slackTestMessageSchema.parse(rawInput);
    if (!(await instanceSettingsService(db).getExperimental()).enableChatConnectors) throw forbidden("Chat connectors are disabled");
    return options.withLock(endpointId, async lease => {
      const [record] = await db.select({ endpoint: chatEndpoints, agentName: agents.name }).from(chatEndpoints)
        .innerJoin(agents, and(eq(agents.id, chatEndpoints.assignedAgentId), eq(agents.companyId, chatEndpoints.companyId)))
        .innerJoin(toolConnections, and(eq(toolConnections.id, chatEndpoints.connectionId), eq(toolConnections.companyId, chatEndpoints.companyId), eq(toolConnections.enabled, true), eq(toolConnections.status, "active")))
        .where(eq(chatEndpoints.id, endpointId));
      if (!record || record.endpoint.provider !== "slack") throw notFound("Active Slack connection not found");
      const endpoint = record.endpoint;
      if (!["active", "verifying"].includes(endpoint.status) || !endpoint.providerAccountId || !endpoint.allowDirectMessages) throw conflict("Enable direct messages on an active Slack connection first");
      const [membership] = await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, endpoint.companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.userId), eq(companyMemberships.status, "active"), ne(companyMemberships.membershipRole, "viewer"),
      ));
      if (!membership) throw forbidden("An active Paperclip account is required");
      const actionKey = `slack_test_message:${actor.userId}:${input.requestId}`;
      const [previous] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, endpointId), eq(chatActions.companyId, endpoint.companyId), eq(chatActions.providerActionId, actionKey)));
      if (previous) {
        if (previous.status === "processed" && typeof previous.result?.slackUrl === "string") return { status: "sent", slackUrl: previous.result.slackUrl };
        throw conflict("This message may already have been sent. Check your Slack DMs before sending another.");
      }
      const recent = await db.select({ id: chatActions.id }).from(chatActions).where(and(
        eq(chatActions.endpointId, endpointId), eq(chatActions.companyId, endpoint.companyId), eq(chatActions.kind, "slack_test_message"), gte(chatActions.createdAt, new Date(Date.now() - 60_000)),
      )).limit(5);
      if (recent.length >= 5) throw tooManyRequests("Wait a minute before sending another test message");
      const links = await db.select({ endpointId: chatIdentityLinks.endpointId, slackUserId: chatExternalPrincipals.externalId }).from(chatIdentityLinks)
        .innerJoin(chatExternalPrincipals, and(eq(chatExternalPrincipals.id, chatIdentityLinks.principalId), eq(chatExternalPrincipals.companyId, chatIdentityLinks.companyId)))
        .where(and(eq(chatIdentityLinks.companyId, endpoint.companyId), eq(chatIdentityLinks.paperclipUserId, actor.userId), eq(chatIdentityLinks.status, "linked"),
          eq(chatExternalPrincipals.provider, "slack"), eq(chatExternalPrincipals.providerAccountId, endpoint.providerAccountId), eq(chatExternalPrincipals.isBot, false)));
      const current = links.filter(link => link.endpointId === endpointId);
      const grants = await db.select({ slackUserId: chatSlackManagerGrants.slackUserId }).from(chatSlackManagerGrants).where(and(
        eq(chatSlackManagerGrants.companyId, endpoint.companyId), eq(chatSlackManagerGrants.userId, actor.userId), eq(chatSlackManagerGrants.workspaceId, endpoint.providerAccountId), eq(chatSlackManagerGrants.status, "active"),
      ));
      const known = [...new Set((current.length ? current : [...links, ...grants]).map(link => link.slackUserId))];
      const userId = input.slackUserId ?? (known.length === 1 ? known[0] : undefined);
      const token = await options.runtimeBotToken(endpointId);
      if (!token) throw conflict("Reconnect this Slack app before sending a message");
      async function call(method: string, fields: Record<string, string>) {
        try { return await api(method, fields, token); }
        catch { throw unprocessable("Slack could not complete this request. Check the connection and try again."); }
      }
      if (!userId) {
        const accounts: { id: string; name: string }[] = [];
        let cursor = "";
        // Bound discovery; the operator only sees accounts in this bot's workspace.
        for (let page = 0; page < 5; page++) {
          const result = await call("users.list", { limit: "200", ...(cursor ? { cursor } : {}) });
          for (const value of Array.isArray(result.members) ? result.members : []) {
            const user = object(value);
            if (human(user, endpoint.providerAccountId)) accounts.push({ id: String(user.id), name: String(user.real_name || user.name || user.id) });
          }
          cursor = String(object(result.response_metadata).next_cursor ?? "");
          if (!cursor) break;
        }
        return { status: "connection_required", accounts };
      }
      const user = object((await call("users.info", { user: userId })).user);
      if (user.id !== userId || !human(user, endpoint.providerAccountId)) throw unprocessable("Choose your personal Slack account in this workspace");
      await options.linkInstaller(endpointId, user, actor, lease);
      await logActivity(db, { companyId: endpoint.companyId, actorType: "user", actorId: actor.userId, action: "chat_slack.test_message_requested", entityType: "tool_connection", entityId: endpoint.connectionId, details: { endpointId, slackUserId: userId } });
      await lease.assertOwned();
      // Persist before dispatch: a crash or ambiguous response must never replay the DM.
      const [action] = await db.insert(chatActions).values({ companyId: endpoint.companyId, endpointId, kind: "slack_test_message", providerActionId: actionKey,
        status: "processing", payload: { userId: actor.userId, slackUserId: userId } }).returning();
      try {
        const response = await call("chat.postMessage", { channel: userId,
          text: `Hi, I’m ${record.agentName}. This is your test message. Reply here to talk to me.`, unfurl_links: "false", unfurl_media: "false" });
        if (typeof response.channel !== "string" || !/^D[A-Z0-9]+$/.test(response.channel) || typeof response.ts !== "string") throw unprocessable("Slack did not confirm delivery. Check your DMs before trying again.");
        const slackUrl = `https://app.slack.com/client/${encodeURIComponent(endpoint.providerAccountId)}/${response.channel}`;
        await lease.assertOwned();
        await db.update(chatActions).set({ status: "processed", result: { slackUrl }, updatedAt: new Date() }).where(eq(chatActions.id, action!.id));
        await logActivity(db, { companyId: endpoint.companyId, actorType: "user", actorId: actor.userId, action: "chat_slack.test_message_sent", entityType: "tool_connection", entityId: endpoint.connectionId, details: { endpointId, slackUserId: userId } });
        return { status: "sent", slackUrl };
      } catch {
        await db.update(chatActions).set({ status: "uncertain", result: { code: "slack_test_message_unconfirmed" }, updatedAt: new Date() }).where(eq(chatActions.id, action!.id));
        throw unprocessable("Delivery was not confirmed. Check your Slack DMs before sending another test message.");
      }
    });
  };
}
