# Adversarial review log — Paperclip+kow smoke test

Radek asked for 3 pre-implementation adversarial sweeps + fixes, then 3 more
post-implementation. Provider reality during this session (2026-10-08):

- **Sweep 1 (design): Oracle / codex `gpt-6-astra` (cross-vendor, OpenAI-family).**
  Completed, 10 concerns (C1-C10), ALL accepted and applied → SPEC v2. 87s.
- **Codex degraded thereafter.** kow's transparent MITM proxy presents its own
  cert for `wss://chatgpt.com/backend-api/codex/responses`; codex (Rust, ignores
  NODE_EXTRA_CA_CERTS/SSL_CERT_FILE for its WS stack) rejects it as UnknownIssuer,
  retries 5x, falls back to HTTPS, and the proxy cuts the long reasoning stream
  before completion. Confirmed the MITM is forced (persists even with HTTP(S)_PROXY
  unset). Short calls (~19s) succeed; long review streams (>~120s) do not.
- **OpenAI metered fallback unavailable:** account returns 429 insufficient_quota.
- **Decision:** cross-vendor Oracle is environmentally unavailable for heavy
  reviews this session. Remaining sweeps use **Max (Anthropic-family)**, the
  sanctioned second-look/security-boundary reviewer. Trade-off recorded openly:
  in-family review shares some blind spots with the author; it is NOT a
  substitute for the eventual cross-vendor pass. TODO: re-run a true cross-vendor
  Oracle sweep once codex WS trusts the kow CA (or on a host without the MITM),
  before this harness is used as external evidence for the ADR-0005 PR.
