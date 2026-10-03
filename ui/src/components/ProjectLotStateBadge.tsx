import type { ProjectLotState } from "@paperclipai/shared";
import { LOT_STATE_LABELS } from "@paperclipai/shared";
import { cn } from "../lib/utils";
import { lotStateBadge } from "../lib/status-colors";

/**
 * Project lot-state chip — how far the night crew has worked a parked
 * (zone-"a") idea (`prepping` gray, `questions` amber, `ready` green,
 * `built` blue, via the dedicated `lotStateBadge` map). Label comes from
 * `LOT_STATE_LABELS` (single source of truth in @paperclipai/shared) so a
 * rename stays a one-file edit. Mirrors {@link ProjectZoneBadge}.
 *
 * Per the night-crew contract (doc/plans/2026-10-02-night-crew.md §1) this
 * chip only ever renders inside the deliberate "walk the lot" view — lot
 * content never surfaces on attention surfaces (dashboard, inbox,
 * notifications), server-enforced.
 */
export function ProjectLotStateBadge({ state }: { state: ProjectLotState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0",
        lotStateBadge[state],
      )}
    >
      {LOT_STATE_LABELS[state]}
    </span>
  );
}
