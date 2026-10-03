import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Fallback client for hosts that render gated components without a
 * QueryClientProvider (isolated unit-test mounts). The query is disabled in
 * that case, so this client never fetches — it only keeps `useQuery` from
 * throwing. Created lazily so app code never pays for it.
 */
let detachedClient: QueryClient | null = null;
function getDetachedClient(): QueryClient {
  detachedClient ??= new QueryClient();
  return detachedClient;
}

/**
 * The night-crew focus dashboard flag (ADHD edition, plan §2b).
 *
 * Wraps the board-readable experimental-settings GET (same query the settings
 * page and the other per-flag hooks use) so the dashboard gate shares one
 * source of truth with every other enableFocusDashboard consumer. While the
 * query is in flight (and when the flag is off) `enabled` is false, which
 * renders the classic dashboard — no flash of the focus surface before the
 * flag value is known. Fails closed: anything but an explicit `true` keeps
 * the byte-compatible classic dashboard.
 *
 * Renders without a QueryClientProvider resolve to the flag-off default
 * (`{ enabled: false, loaded: true }`) instead of throwing.
 */
export function useFocusDashboardEnabled(): { enabled: boolean; loaded: boolean } {
  const contextClient = useContext(QueryClientContext);
  const { data, isFetched } = useQuery(
    {
      queryKey: queryKeys.instance.experimentalSettings,
      queryFn: () => instanceSettingsApi.getExperimental(),
      enabled: contextClient != null,
    },
    contextClient ?? getDetachedClient(),
  );
  if (!contextClient) {
    return { enabled: false, loaded: true };
  }
  return { enabled: data?.enableFocusDashboard === true, loaded: isFetched };
}
