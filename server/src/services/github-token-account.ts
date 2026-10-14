import { and, eq } from "drizzle-orm";
import { connectionGrants, type Db } from "@paperclipai/db";

export type GitHubTokenAccount = {
  userId: string;
  login: string;
  avatarUrl?: string;
  verifiedAt: string;
};

const GITHUB_LOGIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/;
/** Short on purpose: this runs while a run waits for its git credential. */
const GITHUB_ACCOUNT_LOOKUP_TIMEOUT_MS = 8_000;
const GITHUB_ACCOUNT_RESPONSE_LIMIT_BYTES = 64 * 1024;

/**
 * The GitHub account a personal access token authenticates as. A token has no GitHub
 * App installations, so `GET /user` is the only way to learn whose token it is: that
 * identity de-duplicates several connections for one account and authors managed commits.
 * Errors never include the token or the provider's response body.
 */
export async function loadGitHubTokenAccount(
  token: string,
  request: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<GitHubTokenAccount> {
  let response: Response;
  try {
    response = await request("https://api.github.com/user", {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(GITHUB_ACCOUNT_LOOKUP_TIMEOUT_MS),
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new Error("GitHub is unavailable");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GitHub rejected the token (HTTP ${response.status})`);
  }
  const text = await response.text();
  if (text.length > GITHUB_ACCOUNT_RESPONSE_LIMIT_BYTES) throw new Error("GitHub returned an oversized account");
  let user: { id?: unknown; login?: unknown; avatar_url?: unknown };
  try {
    user = JSON.parse(text);
  } catch {
    throw new Error("GitHub returned an invalid account identity");
  }
  if (
    typeof user?.id !== "number"
    || !Number.isSafeInteger(user.id)
    || user.id < 1
    || typeof user.login !== "string"
    || !GITHUB_LOGIN_PATTERN.test(user.login)
  ) {
    throw new Error("GitHub returned an invalid account identity");
  }
  return {
    userId: String(user.id),
    login: user.login,
    ...(typeof user.avatar_url === "string" && user.avatar_url.startsWith("https://")
      ? { avatarUrl: user.avatar_url }
      : {}),
    verifiedAt: now().toISOString(),
  };
}

/**
 * Store the token's account on its grant, keeping every other provider-tenant field.
 * `null` clears a recorded account (a replaced token may belong to someone else); the
 * account is then learned again on the token's next use. `updatedAt` is left alone:
 * setup uses it for optimistic concurrency and this is derived metadata.
 */
export async function recordGitHubTokenAccount(
  db: Pick<Db, "update">,
  grant: Pick<typeof connectionGrants.$inferSelect, "id" | "companyId" | "providerTenant">,
  account: GitHubTokenAccount | null,
) {
  const { githubAccount: _previous, ...providerTenant } = grant.providerTenant ?? {};
  const [updated] = await db
    .update(connectionGrants)
    .set({ providerTenant: account ? { ...providerTenant, githubAccount: account } : providerTenant })
    .where(and(eq(connectionGrants.id, grant.id), eq(connectionGrants.companyId, grant.companyId)))
    .returning();
  return updated ?? null;
}
