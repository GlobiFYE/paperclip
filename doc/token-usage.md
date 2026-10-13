# Dashboard AI token usage

The dashboard reads the Token Steward summary on each request through
`GET /api/companies/:companyId/token-usage?window=today|d7|d30` (default `d7`).
The file is read-only. This is machine-wide usage, not company accounting.
Access requires a board instance admin and company access; local trusted board
access qualifies. Other board members and agents receive 403, hiding the card.

Configuration:

- `PANTHEON_USAGE_COMPANY_ID`: the only company allowed to see this file;
  defaults to `57cfaea0-c864-4bff-9433-2fad7be3d4c5`. Other companies receive
  `{available:false, reason:"not_configured"}`.
- `PANTHEON_USAGE_SUMMARY_PATH`: defaults to
  `/Volumes/AI-Models/paperclip/usage/summary.json`.
- `PANTHEON_USAGE_TZ`: collector timezone, default `America/Los_Angeles`.

The response contains provider/model input and output tokens, cached tokens,
per-provider counts, and a token total. Subscription counts are runs; other
counts are calls. Counts are never summed across providers. Empty rows are
removed, but cached-only, error-only, limited-only, warning-only, and call-only
providers remain. The card refreshes every five minutes.

`collection` supplies sanitized source names and statuses, never the static
`sources` paths. Any failed/skipped source or missing expected status marks the
result partial. A missing collection means completeness is unknown (partial).
The collector's previous-collection coverage check is per collection run;
this card does not independently verify historical coverage.

`generated_at` is interpreted in the collector timezone, independently of the
server timezone, and returned with an offset and epoch milliseconds. More than
one hour old is stale. Because the source has no offset, the repeated fall-back
hour cannot be disambiguated: the earlier occurrence is used. Nonexistent
spring-forward times and malformed dates return unavailable, as do malformed
or unreadable files. Reasons are generic and do not expose paths or contents.

Proof:

```sh
pnpm --filter @paperclipai/server exec vitest run src/__tests__/token-usage && pnpm --filter ./ui exec vitest run src/components/TokenUsage src/pages/Dashboard
pnpm -r typecheck
pnpm check:token-gates
```
