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
 * The Lot experimental flag (night-crew ADHD edition, plan §7).
 *
 * Wraps the board-readable experimental-settings GET (same query the settings
 * page and the other per-flag hooks use) so every lot surface shares one gate.
 * While the query is in flight (and when the flag is off) `enabled` is false,
 * which renders the classic always-expanded zone-a group on Projects — no
 * flash of the collapsed lot view before the flag value is known.
 *
 * Renders without a QueryClientProvider resolve to the flag-off default
 * (`{ enabled: false, loaded: true }`) instead of throwing.
 */
export function useLotViewEnabled(): { enabled: boolean; loaded: boolean } {
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
  return { enabled: data?.enableLotView === true, loaded: isFetched };
}
