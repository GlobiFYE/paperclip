# Vercel MCP connection status

Verified 2026-10-12. This page concerns Vercel's own MCP server at
`https://mcp.vercel.com`. It is separate from [Vercel Connect](./VERCEL-CONNECT.md),
which stores credentials for other providers.

## Current availability

Paperclip has a Vercel catalog definition and local brand assets, but its
connection action remains unavailable. [Vercel's MCP guide](https://vercel.com/docs/agent-resources/vercel-mcp)
says that Vercel reviews and approves MCP clients and lists the supported clients.
Paperclip is not on that list. The provider's published registration endpoint
does not establish that a newly registered Paperclip client can receive consent.
The [connection authoring runbook](./CONNECTOR-PLAYBOOK.md) requires this entry
to stay unavailable until Paperclip has provider approval and account-bound proof.

## Reviewed protocol facts

| Item | Observed value |
| --- | --- |
| Streamable HTTP endpoint | `https://mcp.vercel.com` |
| Unauthenticated endpoint response | HTTP 401 with `WWW-Authenticate` pointing to protected-resource metadata |
| `https://mcp.vercel.com/mcp` | HTTP 404; do not use this path |
| Protected-resource metadata | `https://mcp.vercel.com/.well-known/oauth-protected-resource` |
| OAuth issuer | `https://vercel.com` |
| OAuth metadata | `https://vercel.com/.well-known/oauth-authorization-server` |
| Requested MCP scope | `openid`, from protected-resource metadata |
| OAuth endpoints | Authorization: `https://vercel.com/oauth/authorize`; token: `https://api.vercel.com/login/oauth/token`; registration: `https://api.vercel.com/login/oauth/register`; revocation: `https://api.vercel.com/login/oauth/token/revoke` |
| PKCE | `S256` advertised |

The [Vercel tool reference](https://vercel.com/docs/agent-resources/vercel-mcp/tools)
describes documentation search, projects, deployments, and logs. Provider account
and team permissions govern authenticated actions. The published `openid` scope
does not by itself grant project administration. No Paperclip account-bound tool
catalog, safe read, write classification, refresh, or revoke proof has run.

## Path to enable the connector

1. Obtain confirmation that Vercel approves Paperclip as an MCP client, including
   the permitted client registration or client credentials and callback rules.
2. Perform the runbook's live lifecycle with an authorized Vercel account:
   connect, discover tools, read, classify writes, invoke through an agent run,
   refresh, remove, reconnect, and inspect redaction and audit.
3. Update the permission review with the observed tool names and proof status.
   Then remove the catalog availability block and expose the existing branded
   connection flow.

Until then, operators can use a Vercel-supported MCP client outside Paperclip.
Paperclip's generic remote MCP setup must not be presented as a bypass for
Vercel's client approval requirement.
