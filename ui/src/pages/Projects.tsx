import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectZone } from "@paperclipai/shared";
import { PROJECT_ZONE_HINTS, PROJECT_ZONE_LABELS } from "@paperclipai/shared";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EntityRow } from "../components/EntityRow";
import { ProjectTile } from "../components/ProjectTile";
import { ProjectStatusBadge } from "../components/StatusBadge";
import { ProjectZonePicker } from "../components/ProjectZonePicker";
import { ProjectLotStateBadge } from "../components/ProjectLotStateBadge";
import { MembershipAction } from "../components/MembershipAction";
import { StarToggle } from "../components/StarToggle";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { cn, formatDate, formatNumber, formatProjectBudget, projectUrl } from "../lib/utils";
import {
  isStarred,
  resourceMembershipState,
  useResourceMembershipMutation,
  useResourceMemberships,
} from "../hooks/useResourceMemberships";
import { useLotViewEnabled } from "../hooks/useLotViewEnabled";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowUpDown, Check, ChevronRight, Hexagon, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";

type ProjectSortField = "name" | "updated" | "created" | "targetDate";
type ProjectSortDir = "asc" | "desc";

const PROJECT_SORT_OPTIONS: Array<{ field: ProjectSortField; label: string }> = [
  { field: "name", label: "Name" },
  { field: "updated", label: "Updated" },
  { field: "created", label: "Created" },
  { field: "targetDate", label: "Target date" },
];

// Zone-grouped section titles, composed from the shared zone constants so a
// rename ("lanes", "focus", …) stays a one-file edit in @paperclipai/shared.
// The Active Lane (zone b) renders FIRST and always expanded. The Lot
// (zone a — the night-crew parking zone, doc/plans/2026-10-02-night-crew.md)
// follows as the deliberate, collapsed-by-default "walk the lot" view.
// Projects left by the current operator keep their own trailing section.
const ZONE_B_SECTION_TITLE = `${PROJECT_ZONE_LABELS.b} (${PROJECT_ZONE_HINTS.b})`;
const ZONE_A_SECTION_TITLE = `${PROJECT_ZONE_LABELS.a} (${PROJECT_ZONE_HINTS.a})`;
const LEFT_SECTION_TITLE = "Other Projects";

/** Effective zone: legacy/undefined rows park in zone "a" (the DB default). */
function projectZone(project: Project): ProjectZone {
  return project.zone === "b" ? "b" : "a";
}

function compareProjectNames(left: Project, right: Project) {
  const nameDiff = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  return nameDiff !== 0 ? nameDiff : left.id.localeCompare(right.id);
}

function projectTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function compareOptionalTime(
  left: Date | string | null | undefined,
  right: Date | string | null | undefined,
  sortDir: ProjectSortDir,
) {
  const leftTime = projectTime(left);
  const rightTime = projectTime(right);
  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return sortDir === "asc" ? leftTime - rightTime : rightTime - leftTime;
}

function sortProjects(projects: Project[], sortField: ProjectSortField, sortDir: ProjectSortDir) {
  return [...projects].sort((left, right) => {
    let comparison = 0;
    if (sortField === "name") {
      comparison = compareProjectNames(left, right);
      return sortDir === "asc" ? comparison : -comparison;
    }

    if (sortField === "updated") comparison = compareOptionalTime(left.updatedAt, right.updatedAt, sortDir);
    else if (sortField === "created") comparison = compareOptionalTime(left.createdAt, right.createdAt, sortDir);
    else comparison = compareOptionalTime(left.targetDate, right.targetDate, sortDir);

    if (comparison === 0) comparison = compareProjectNames(left, right);
    return comparison;
  });
}

export function Projects() {
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [sortField, setSortField] = useState<ProjectSortField>("name");
  const [sortDir, setSortDir] = useState<ProjectSortDir>("asc");
  // The Lot stays closed until the operator walks it on purpose (night-crew
  // design §1: deliberate access only — never a badge, never a ping).
  const [lotOpen, setLotOpen] = useState(false);
  // The collapsed "walk the lot" section renders only when the instance has
  // the enableLotView experimental flag on. Flag off (the default) keeps the
  // classic always-expanded zone-a group — no collapse toggle, no lot chips.
  const { enabled: lotViewEnabled } = useLotViewEnabled();

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const membershipsQuery = useResourceMemberships(selectedCompanyId);
  const membershipMutation = useResourceMembershipMutation(selectedCompanyId);
  // Zone changes from the card picker: PATCH the project, then refresh the
  // list so the one-active-lane grouping (and any server-side demotions of
  // the previous zone-b project) lands immediately.
  const updateZoneMutation = useMutation({
    mutationFn: ({ project, zone }: { project: Project; zone: ProjectZone }) =>
      projectsApi.update(project.id, { zone }, selectedCompanyId!),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(selectedCompanyId) });
      }
    },
    onError: (error) => {
      console.error("Failed to update project zone:", error);
    },
  });
  const projects = useMemo(
    () => allProjects ?? [],
    [allProjects],
  );
  const sortedProjects = useMemo(
    () => sortProjects(projects, sortField, sortDir),
    [projects, sortDir, sortField],
  );
  const groupedProjects = useMemo(() => {
    const groups = {
      zoneB: [] as typeof sortedProjects,
      zoneA: [] as typeof sortedProjects,
      left: [] as typeof sortedProjects,
    };

    for (const project of sortedProjects) {
      const state = resourceMembershipState(membershipsQuery.data, "project", project.id);
      if (state === "left") groups.left.push(project);
      else if (projectZone(project) === "b") groups.zoneB.push(project);
      else groups.zoneA.push(project);
    }

    return groups;
  }, [membershipsQuery.data, sortedProjects]);
  const sortLabel = PROJECT_SORT_OPTIONS.find((option) => option.field === sortField)?.label ?? "Name";

  /** Standard section header: title left, plain muted count right. */
  function sectionHeading(label: string, count: number) {
    return (
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{label}</h2>
        <span className="text-xs text-muted-foreground">
          {count} project{count === 1 ? "" : "s"}
        </span>
      </div>
    );
  }

  /** The grouped project-card list shared by every section. */
  function sectionCards(sectionProjects: Project[]) {
    if (sectionProjects.length === 0) return null;
    return (
      <Card className="block py-0 overflow-hidden divide-y divide-border">
        {sectionProjects.map((project) => {
          const state = resourceMembershipState(membershipsQuery.data, "project", project.id);
          const pending = membershipMutation.isPending &&
            membershipMutation.variables?.resourceType === "project" &&
            membershipMutation.variables.resourceId === project.id;
          const starPending = pending && membershipMutation.variables?.starred !== undefined;
          const joinLeavePending = pending && membershipMutation.variables?.starred === undefined;
          const starred = isStarred(membershipsQuery.data, "project", project.id);
          return (
            <EntityRow
              key={project.id}
              leading={<ProjectTile color={project.color ?? null} icon={project.icon ?? null} size="sm" />}
              title={project.name}
              subtitle={project.description ?? undefined}
              reserveSubtitleSpace
              to={projectUrl(project)}
              className={state === "left" ? "group text-foreground/55" : "group"}
              trailing={
                <div className="flex items-center gap-3">
                  <span
                    className="hidden text-xs text-muted-foreground tabular-nums sm:inline"
                    title={`${formatNumber(project.taskCount ?? 0)} task${(project.taskCount ?? 0) === 1 ? "" : "s"}`}
                  >
                    {formatNumber(project.taskCount ?? 0)} task{(project.taskCount ?? 0) === 1 ? "" : "s"}
                  </span>
                  {project.budget && (
                    <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                      {formatProjectBudget(project.budget)}
                    </span>
                  )}
                  {project.targetDate && (
                    <span className="hidden text-xs text-muted-foreground md:inline">
                      {formatDate(project.targetDate)}
                    </span>
                  )}
                  {/* Lot-state chip — how far the night crew has worked this
                      idea; only ever shown inside the deliberate lot view
                      (enableLotView), never in the classic zone-a group. */}
                  {lotViewEnabled && project.lot_state && (
                    <ProjectLotStateBadge state={project.lot_state} />
                  )}
                  {/* Zone picker — the trailing zone badge is its
                      trigger; the wrapper stops the click so the
                      row link does not navigate. */}
                  <span
                    className="inline-flex"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <ProjectZonePicker
                      zone={projectZone(project)}
                      disabled={
                        updateZoneMutation.isPending &&
                        updateZoneMutation.variables?.project.id === project.id
                      }
                      onChange={(next) => updateZoneMutation.mutate({ project, zone: next })}
                    />
                  </span>
                  <ProjectStatusBadge status={project.status} />
                  <MembershipAction
                    state={state}
                    pending={joinLeavePending}
                    pendingState={joinLeavePending ? membershipMutation.variables?.state : null}
                    resourceName={project.name}
                    onJoin={() => membershipMutation.mutate({
                      resourceType: "project",
                      resourceId: project.id,
                      resourceName: project.name,
                      state: "joined",
                    })}
                    onLeave={() => membershipMutation.mutate({
                      resourceType: "project",
                      resourceId: project.id,
                      resourceName: project.name,
                      state: "left",
                    })}
                  />
                  <StarToggle
                    size="row"
                    starred={starred}
                    pending={starPending}
                    resourceName={project.name}
                    onToggle={(next) => membershipMutation.mutate({
                      resourceType: "project",
                      resourceId: project.id,
                      resourceName: project.name,
                      starred: next,
                    })}
                  />
                </div>
              }
            />
          );
        })}
      </Card>
    );
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={Hexagon} message="Select an organization to view projects." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="w-fit text-xs" title="Sort">
              <ArrowUpDown className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
              <span>Sort: {sortLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-0">
            <div className="p-2 space-y-0.5">
              {PROJECT_SORT_OPTIONS.map((option) => (
                <button
                  key={option.field}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm ${
                    sortField === option.field
                      ? "bg-accent/50 text-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  }`}
                  onClick={() => {
                    if (sortField === option.field) {
                      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
                      return;
                    }
                    setSortField(option.field);
                    setSortDir(option.field === "name" || option.field === "targetDate" ? "asc" : "desc");
                  }}
                >
                  <span>{option.label}</span>
                  {sortField === option.field ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="h-3 w-3" />
                      {sortDir === "asc" ? "Asc" : "Desc"}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="outline" onClick={openNewProject}>
          <Plus className="h-4 w-4 mr-1" />
          Add Project
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {!isLoading && projects.length === 0 && (
        <EmptyState
          icon={Hexagon}
          message="No projects yet."
          action="Add Project"
          onAction={openNewProject}
        />
      )}

      {projects.length > 0 && (
        <div className="space-y-6">
          {/* The Active Lane — THE one zone-b group; first and always
              expanded, never behind a toggle. */}
          {groupedProjects.zoneB.length > 0 && (
            <section className="space-y-2">
              {sectionHeading(ZONE_B_SECTION_TITLE, groupedProjects.zoneB.length)}
              {sectionCards(groupedProjects.zoneB)}
            </section>
          )}

          {/* enableLotView OFF (the default): the classic zone-a group —
              always expanded, no collapse toggle, no lot-state chips, exactly
              the pre-lot rendering. */}
          {!lotViewEnabled && groupedProjects.zoneA.length > 0 && (
            <section className="space-y-2">
              {sectionHeading(ZONE_A_SECTION_TITLE, groupedProjects.zoneA.length)}
              {sectionCards(groupedProjects.zoneA)}
            </section>
          )}

          {/* enableLotView ON: The Lot — the deliberate "walk the lot" view
              (night-crew design §1). Lot items are invisible on every
              attention surface by contract; this is the one place they open
              on purpose. Collapsed by default and quiet — a single muted row,
              plain count, no urgency colors — so the lot never pulls, it only
              waits. */}
          {lotViewEnabled && groupedProjects.zoneA.length > 0 && (
            <section className="space-y-2" data-testid="lot-section">
              <h2 className="text-sm font-medium">
                <button
                  type="button"
                  data-testid="lot-section-toggle"
                  aria-expanded={lotOpen}
                  aria-controls="lot-section-projects"
                  onClick={() => setLotOpen((open) => !open)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight
                    className={cn("h-3.5 w-3.5 shrink-0 transition-transform", lotOpen && "rotate-90")}
                    aria-hidden="true"
                  />
                  <span aria-hidden="true">🗄</span>
                  <span>{PROJECT_ZONE_LABELS.a}</span>
                  <span className="text-xs font-normal">
                    {groupedProjects.zoneA.length} project{groupedProjects.zoneA.length === 1 ? "" : "s"}
                  </span>
                </button>
              </h2>
              {lotOpen ? (
                <div id="lot-section-projects">{sectionCards(groupedProjects.zoneA)}</div>
              ) : null}
            </section>
          )}

          {/* Projects the current operator left keep their own trailing
              section, unchanged. */}
          {groupedProjects.left.length > 0 && (
            <section className="space-y-2">
              {sectionHeading(LEFT_SECTION_TITLE, groupedProjects.left.length)}
              {sectionCards(groupedProjects.left)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
