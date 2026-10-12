/** Response storage policy only. These operations still use ordinary REST authorization. */
export function runnerApiSensitiveResponse(method: string, path: string): boolean {
  if (/\/secrets\/\{[^}]+\}\/value$/.test(path)) return true;
  return /^\/api\/tool-gateway\/sessions(?:\/|$)/.test(path)
    || (method === "POST" && /^\/api\/routines\/\{[^}]+\}\/triggers$/.test(path))
    || /\/(keys|board-api-keys|credentials|invites|join-requests|gateway-tokens|tokens|token|rotate-secret|terminal-session-token|claim-api-key)(\/|$)/.test(path);
}
