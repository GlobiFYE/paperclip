import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus } from "lucide-react";

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Payload => (v && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : {});

export function pendingHires<T extends { type: string; status: string }>(approvals: T[] | undefined): T[] {
  return (approvals ?? []).filter((a) => a.type === "hire_agent" && a.status === "pending");
}

function firstSentence(text: string) {
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

const RECENT_STATUSES = new Set(["active", "idle", "running", "paused", "error"]);
const STATUS_LABEL: Record<string, string> = { idle: "ready", running: "working", active: "ready", paused: "paused", error: "error" };

export function Hiring() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const running = useRef(false);

  useEffect(() => setBreadcrumbs([{ label: "Hiring" }]), [setBreadcrumbs]);

  const { data: approvals, isLoading } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const nameOf = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a.name])), [agents]);
  const pending = pendingHires(approvals);
  const recent = useMemo(() => {
    const cutoff = Date.now() - days * 86_400_000;
    return (agents ?? [])
      .filter((a) => RECENT_STATUSES.has(a.status) && new Date(a.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [agents, days]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["approvals", selectedCompanyId] });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.attention(selectedCompanyId!) });
  };

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id);
    setMessage(null);
    try {
      if (action === "approve") await approvalsApi.approve(id, "Confirmed by the owner on the Hiring page.");
      else await approvalsApi.reject(id, "Cancelled by the owner on the Hiring page.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function confirmAll() {
    if (running.current) return;
    running.current = true;
    const ids = pending.map((a) => a.id); // snapshot: later arrivals are never included
    let ok = 0;
    const failed: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      setBusy(`all:${i + 1}/${ids.length}`);
      try {
        const res = await approvalsApi.approve(ids[i], "Confirmed by the owner with Confirm all on the Hiring page.");
        if (res.status === "approved") ok++;
        else failed.push(ids[i]);
      } catch {
        failed.push(ids[i]);
      }
    }
    setBusy(null);
    running.current = false;
    setMessage(failed.length ? `${ok} hired, ${failed.length} could not be confirmed. They are still listed below.` : `${ok} hired.`);
    refresh();
  }

  const progress = busy?.startsWith("all:") ? busy.slice(4) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserPlus className="size-5 text-muted-foreground" aria-hidden />
          <h1 className="text-xl font-semibold">Hiring</h1>
        </div>
        {pending.length > 0 ? (
          <Button onClick={confirmAll} disabled={!!busy} aria-live="polite">
            {progress ? `Confirming ${progress}…` : `Confirm all (${pending.length})`}
          </Button>
        ) : null}
      </header>

      {message ? (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      <section aria-labelledby="pending-h" className="flex flex-col gap-2">
        <h2 id="pending-h" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Waiting for you {pending.length ? <Badge variant="secondary">{pending.length}</Badge> : null}
        </h2>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {!isLoading && pending.length === 0 ? (
          <p className="rounded-md border px-3 py-4 text-sm text-muted-foreground">No hires waiting. You're all caught up.</p>
        ) : null}
        <ul className="flex flex-col divide-y rounded-md border">
          {pending.map((a) => {
            const p = obj(a.payload);
            const meta = obj(p.metadata);
            const model = str(obj(p.adapterConfig).model) || (str(p.adapterType) === "process" ? "Local AI / Jev" : "");
            const manager = nameOf.get(str(p.reportsTo)) ?? "";
            const reason = firstSentence(str(p.capabilities) || str(p.title));
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{str(p.name) || "New agent"}</div>
                  <div className="text-sm text-muted-foreground">
                    {[str(meta.division), model, manager ? `reports to ${manager}` : ""].filter(Boolean).join(" · ")}
                  </div>
                  {reason ? <div className="mt-1 text-sm">{reason}</div> : null}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(a.id, "approve")} disabled={!!busy}>
                    {busy === a.id ? "Confirming…" : "Confirm"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide(a.id, "reject")} disabled={!!busy}>
                    Cancel
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="recent-h" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="recent-h" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recently hired
          </h2>
          <div className="flex gap-1" role="group" aria-label="Time range">
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant={days === d ? "default" : "ghost"} onClick={() => setDays(d)}>
                {d} days
              </Button>
            ))}
          </div>
        </div>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">No new hires in this period.</p> : null}
        <ul className="flex flex-col divide-y rounded-md border">
          {recent.map((a) => {
            const meta = obj(a.metadata);
            const model = str(obj(a.adapterConfig).model) || (a.adapterType === "process" ? "Local AI / Jev" : "");
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <a href={`../agents/${a.urlKey ?? a.id}`} className="font-medium hover:underline">
                    {a.name}
                  </a>
                  <div className="text-sm text-muted-foreground">
                    {[a.title ?? "", str(meta.division), model, nameOf.get(a.reportsTo ?? "") ? `reports to ${nameOf.get(a.reportsTo ?? "")}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <Badge variant="outline">{STATUS_LABEL[a.status] ?? a.status}</Badge>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** Pending hire count for the sidebar badge. */
export function usePendingHireCount(companyId: string | null | undefined) {
  const { data } = useQuery({
    queryKey: queryKeys.approvals.list(companyId!),
    queryFn: () => approvalsApi.list(companyId!),
    enabled: !!companyId,
    refetchInterval: 60_000,
  });
  return pendingHires(data).length;
}
