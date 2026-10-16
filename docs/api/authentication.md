---
title: Authentication
summary: API keys, JWTs, and auth modes
---

Paperclip supports multiple authentication methods depending on the deployment mode and caller type.

## Agent Authentication

### Run JWTs (Recommended for agents)

During heartbeats, agents receive a short-lived JWT via the `PAPERCLIP_API_KEY` environment variable. Use it in the Authorization header:

```
Authorization: Bearer <PAPERCLIP_API_KEY>
```

This JWT is scoped to the agent and the current run.

### Agent API Keys

Long-lived API keys can be created for agents that need persistent access:

```
POST /api/agents/{agentId}/keys
```

Returns a key that should be stored securely. The key is hashed at rest — you can only see the full value at creation time.

### Agent Identity

Agents can verify their own identity:

```
GET /api/agents/me
```

Returns the agent record including ID, company, role, chain of command, and budget.

## Board Operator Authentication

### Local Trusted Mode

Requests without bearer credentials use the implicit local board operator. Requests with bearer credentials must authenticate successfully.

### Authenticated Mode

Board operators authenticate via Better Auth sessions (cookie-based). The web UI handles login/logout flows automatically.

## Company Scoping

All entities belong to a company. The API enforces company boundaries:

- Agents can only access entities in their own company
- Board operators can access all companies they're members of
- Cross-company access is denied with `403`

## Run credential lifetime and revocation

A run JWT contains a random `jti`. Every API authentication checks the persistent
`agent_jwt_revocations` deny-list in the primary database. There is no process-local
allow cache. A committed revocation applies to the next authentication on every
API process; it does not cancel a request that already authenticated.

Run JWTs also require a UUID run belonging to the signed agent and company.
This check applies even when `X-Paperclip-Run-Id` is absent. A supplied header must
match the signed run. Missing runs and unknown statuses fail closed.

- `queued`, `scheduled_retry`, and `running` rows with no `finishedAt` remain valid
  until JWT expiry. Host suspension and lack of recent output do not shorten them.
- `succeeded`, `interrupted`, `failed`, `cancelled`, and `timed_out` rows permit
  authentication for strictly less than five minutes after `finishedAt`.
  The exact five-minute boundary is denied. The timestamp must be finite, no
  earlier than run creation, and not in the future. Missing timestamps fail closed.
- Requests never update the grace timestamp. Revocation and JWT expiry override
  grace. Existing cancellation rules still deny writes immediately, including
  during the authentication grace window. A terminal row without a trustworthy
  timestamp returns `401` before write authorization; a cancelled run with a
  valid timestamp still returns the existing `403` cancellation denial for writes.
- Invalid bearer credentials return an authentication error in `local_trusted`
  mode too. Only requests without bearer credentials receive implicit board access.

### Operator revocation

These endpoints require an instance administrator with company access, or the
implicit local board. Agents cannot revoke credentials through this API.

`POST /api/companies/{companyId}/agent-jwt-revocations`

```json
{"handle":"jti:<credential-jti>","reason":"Credential exposed; incident reference"}
```

The handle can instead be `sha256:<64 lowercase hex characters>`, the SHA-256 hash
of the exact bearer string, without the `Bearer ` prefix. This works for both old
and new JWTs. No endpoint accepts a raw JWT. For a pre-`jti` credential, compute the
handle locally without putting the credential in shell history or arguments:

```sh
python3 - <<'PY'
import getpass, hashlib
value = getpass.getpass('Run credential: ')
print('sha256:' + hashlib.sha256(value.encode()).hexdigest())
PY
```

Send the resulting handle in the JSON body using normal board authentication.
A successful response is `201` with the revocation record. Insertion and an
`auth.agent_jwt_revoked` activity record commit together. Repeating a handle is
idempotent for the deny-list, extends retention, and records another audit event.
The key is unique within `(instance_id, company_id, handle)`. Neither signing
secret rotation nor agent status changes are involved.

### Rollout and cleanup

Apply the additive database migration before starting API processes with this
code. Upgrade all serving API processes before relying on the new enforcement;
older processes do not consult the deny-list. Pre-`jti` JWTs still authenticate
when their run and signed lifetime are valid, and can be revoked by token hash.
Legacy signature compatibility retains its existing separate configuration.

Verification accepts only integer `iat` and `exp`, a non-future `iat`, and a
positive signed lifetime of at most 172800 seconds (48 hours). `now == exp` is
expired. Previously issued tokens with a longer lifetime or invented run IDs
are rejected explicitly; reissue through a real heartbeat, or use an authorized
DB API key for a manual session.

The API derives revocation `expiresAt` from database time plus the maximum
accepted JWT lifetime. Callers cannot supply an earlier expiry. Authentication
checks the handle even after that retention timestamp; expiry does not grant
access. The operator can run:

`POST /api/companies/{companyId}/agent-jwt-revocations/cleanup`

Each call removes at most 1000 rows for that company and instance, only after
retention plus a five-minute clock margin. Concurrent re-revocation extends
retention and the delete rechecks its expiry predicate. API and database clocks
must stay synchronized. Cleanup writes an audit event and returns `{ "removed": N }`.
No cleanup scheduler is enabled by this change. Keeping expired rows is safe.

The migration does not change existing rows. For rollback, retain the deny-list
and audit data. Reverting enforcement would restore the original vulnerability;
do not treat an application downgrade as a secure revocation rollback.

### Adapter TTL policy

Minting resolves TTL in this order:

1. The adapter's entry in `PAPERCLIP_AGENT_JWT_TTL_BY_ADAPTER`.
2. `PAPERCLIP_AGENT_JWT_TTL_SECONDS`.
3. The 172800-second compatibility default.

The adapter setting is a JSON object keyed by adapter type, for example
`{"codex_local":172800,"claude_local":172800}`. Values and the global override
must be integers from 1 through 172800. Malformed configuration fails minting
rather than silently falling back; every entry is validated, including entries
for other adapters. Changes affect new credentials only.

The default remains 48 hours for compatibility, particularly local runs that can
suspend. Source comments document suspension gaps over an hour; they do not prove
that every adapter needs 48 hours. Before shortening any adapter's TTL, measure
its complete run duration including suspended time and retries. Use a measured
upper bound plus operating margin. No shorter default or production configuration
change is included here.

### Minting and consumer audit

Production minting occurs in `server/src/services/heartbeat/runtime-execution.ts`
and the native runner's `paperclip-runner-tool-authority.ts` API bridge. Both use
an existing heartbeat run; the native bridge mints credentials from server-owned
run bindings. Each newly minted credential has its own revocation handle.
The commentary verification script and JWT integration fixtures also create run
rows. The pipeline tutorial browser fixture invokes a real bounded process run
instead of inventing a run ID, keeps it active for the scenario, and cancels it
in cleanup. It explicitly grants pipeline writes to both the agent and the
responsible user, and verifies denial without the user grant. Requiring a real
run preserves the existing responsible-user permission checks: synthetic run
IDs no longer bypass that binding. Agent-chat browser
coverage uses an existing cancelled run and still expects write denial.
Pure cryptographic unit tests need no database; middleware fixtures do.

`agent local-cli`, CLI token commands, manual API sessions, and gateway workflows
that use DB keys keep their existing key authorization and revocation path. They
do not acquire a heartbeat-row requirement. Custom callers that previously
minted JWTs with synthetic run IDs must use a real run or an authorized DB key;
there is no adapter-name exemption from liveness checks.

Sandbox callback bridges and runtime transports forward the existing run
credential. They do not mint independent run JWTs. The separate customer-success
run-authority verifier also checks this deny-list and retains its stricter
running-only policy. Public webhook and MCP gateway credentials remain governed
by their own credential protocols.
