#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let supportsTypedSessionFailure = false;
let resumedSession = false;
let nextClientRequestId = 1;
const pendingClientRequests = new Map();

function requestClient(method, params) {
  const id = `fixture-${nextClientRequestId++}`;
  writeMessage({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => pendingClientRequests.set(id, { resolve, reject }));
}

async function handleRequest(request) {
  if (request.method === "initialize") {
    const air = request.params?.clientCapabilities?._meta?.jetbrains?.air;
    supportsTypedSessionFailure =
      Number.isInteger(air?.version) &&
      air.version >= 1 &&
      Array.isArray(air?.capabilities) &&
      air.capabilities.includes("sessionFailure");
    process.stderr.write(
      "Error handling request { method: 'nes/close' } { code: -32601 }\n",
    );
    process.stderr.write("paperclip-acp-echo-agent started\n");
    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: Boolean(process.env.PAPERCLIP_ACPX_SESSION_FILE),
        sessionCapabilities: { close: {} },
      },
      agentInfo: { name: "paperclip-acp-echo-agent", version: "1.0.0" },
    };
  }
  if (request.method === "session/new") {
    const sessionId = randomUUID();
    if (process.env.PAPERCLIP_ACPX_SESSION_FILE) {
      await writeFile(process.env.PAPERCLIP_ACPX_SESSION_FILE, sessionId);
    }
    return { sessionId };
  }
  if (request.method === "session/load") {
    const sessionId = await readFile(process.env.PAPERCLIP_ACPX_SESSION_FILE, "utf8");
    if (sessionId !== request.params.sessionId) throw new Error("Unknown session");
    resumedSession = true;
    return {};
  }
  if (request.method === "session/prompt") {
    if (process.env.PAPERCLIP_ACPX_TERMINAL_ENV_SMOKE) {
      const created = await requestClient("terminal/create", {
        sessionId: request.params.sessionId,
        command: process.execPath,
        args: ["-e", `process.stdout.write(JSON.stringify({key:process.env.PAPERCLIP_API_KEY,run:process.env.PAPERCLIP_RUN_ID,secret:process.env.PAPERCLIP_AGENT_JWT_SECRET??null,providerPid:${process.pid},terminalPid:process.pid,resumed:${resumedSession}}))`],
      });
      const exited = await requestClient("terminal/wait_for_exit", { sessionId: request.params.sessionId, terminalId: created.terminalId });
      const output = await requestClient("terminal/output", { sessionId: request.params.sessionId, terminalId: created.terminalId });
      await requestClient("terminal/release", { sessionId: request.params.sessionId, terminalId: created.terminalId });
      if (exited.exitCode !== 0) throw new Error(`terminal failed: ${exited.exitCode}`);
      writeMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: request.params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: output.output } },
        },
      });
      return { stopReason: "end_turn" };
    }
    const typedFailure = process.env.PAPERCLIP_ACPX_TYPED_FAILURE_FILE
      ? JSON.parse(await readFile(process.env.PAPERCLIP_ACPX_TYPED_FAILURE_FILE, "utf8"))
      : {};
    const typedFailureCanary = typedFailure.title ?? process.env.PAPERCLIP_ACPX_TYPED_FAILURE_CANARY;
    if (typedFailureCanary) {
      if (!supportsTypedSessionFailure) {
        throw new Error(
          "client did not advertise typed session-failure support",
        );
      }
      const sessionFailure = {
        id: `${request.params.sessionId}:error`,
        revision: 1,
        category: typedFailure.category ?? process.env.PAPERCLIP_ACPX_TYPED_FAILURE_CATEGORY ?? "request",
        severity: "error",
        title: typedFailureCanary,
        ...(typedFailure.details
          ? { details: typedFailure.details }
          : {}),
        actions: [],
      };
      writeMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: request.params.sessionId,
          update: {
            sessionUpdate: "session_info_update",
            _meta: { jetbrains: { air: { version: 1, sessionFailure } } },
          },
        },
      });
      return {
        stopReason: "end_turn",
        _meta: { jetbrains: { air: { version: 1, sessionFailure } } },
      };
    }
    const typedWarningCanary = process.env.PAPERCLIP_ACPX_TYPED_WARNING_CANARY;
    let responseMeta;
    if (typedWarningCanary) {
      if (!supportsTypedSessionFailure) {
        throw new Error(
          "client did not advertise typed session-failure support",
        );
      }
      const sessionFailure = {
        id: `${request.params.sessionId}:warning`,
        revision: 1,
        category: "connection",
        severity: "warning",
        title: typedWarningCanary,
        actions: [],
      };
      responseMeta = { jetbrains: { air: { version: 1, sessionFailure } } };
      writeMessage({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: request.params.sessionId,
          update: { sessionUpdate: "session_info_update", _meta: responseMeta },
        },
      });
    }
    writeMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: request.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: process.env.PAPERCLIP_ACPX_SPAWN_SMOKE ?? "missing",
          },
        },
      },
    });
    return {
      stopReason: "end_turn",
      ...(responseMeta ? { _meta: responseMeta } : {}),
    };
  }
  if (
    request.method === "session/close" ||
    request.method === "session/set_mode" ||
    request.method === "session/set_config_option"
  )
    return {};
  if (request.method === "session/cancel") return null;
  throw new Error(`Unsupported ACP method: ${request.method}`);
}

const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    if (request.id !== undefined && request.method === undefined) {
      const pending = pendingClientRequests.get(request.id);
      if (pending) {
        pendingClientRequests.delete(request.id);
        if (request.error) pending.reject(new Error(request.error.message));
        else pending.resolve(request.result);
      }
      return;
    }
    const result = await handleRequest(request);
    if (request.id !== undefined && result !== null)
      writeMessage({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    if (request?.id !== undefined) {
      writeMessage({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: String(error?.message ?? error) },
      });
    }
  }
});
