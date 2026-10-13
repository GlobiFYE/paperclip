export interface OpenCodeProxyPersistentServer {
  baseUrl: string;
  authHeader: string;
  version?: string;
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === "[::1]") return true;
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.slice(1).every((octet) => {
      const value = Number(octet);
      return /^\d{1,3}$/.test(octet) && value >= 0 && value <= 255;
    })
  );
}

export function parseOpenCodeProxyPersistentServer(
  environment: NodeJS.ProcessEnv = process.env,
): OpenCodeProxyPersistentServer | undefined {
  const baseUrl = environment.PAPERCLIP_OPENCODE_SERVER_URL?.trim();
  const authHeader = environment.PAPERCLIP_OPENCODE_SERVER_AUTH?.trim();
  if (!baseUrl && !authHeader) return undefined;
  if (!baseUrl || !authHeader)
    throw new Error(
      "PAPERCLIP_OPENCODE_SERVER_URL and PAPERCLIP_OPENCODE_SERVER_AUTH must be provided together",
    );
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password || parsed.hash)
    throw new Error("PAPERCLIP_OPENCODE_SERVER_URL contains forbidden URL data");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("PAPERCLIP_OPENCODE_SERVER_URL must use HTTP or HTTPS");
  if (
    parsed.protocol === "http:" &&
    !isLoopbackHost(parsed.hostname)
  )
    throw new Error(
      "PAPERCLIP_OPENCODE_SERVER_URL requires HTTPS for non-loopback hosts",
    );
  if (!/^(Basic|Bearer)\s+\S+$/i.test(authHeader))
    throw new Error("PAPERCLIP_OPENCODE_SERVER_AUTH must be an HTTP auth header");
  return {
    baseUrl: parsed.toString().replace(/\/$/, ""),
    authHeader,
    ...(environment.PAPERCLIP_OPENCODE_SERVER_VERSION?.trim()
      ? { version: environment.PAPERCLIP_OPENCODE_SERVER_VERSION.trim() }
      : {}),
  };
}
