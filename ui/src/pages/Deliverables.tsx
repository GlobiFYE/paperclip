import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CalendarRange, Check, FolderOpen, PackageCheck } from "lucide-react";
import { deliverablesApi } from "../api/deliverables";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { DeliverableCard } from "../components/deliverables/DeliverableCard";
import { useSearchParams } from "@/lib/router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const DELIVERABLES_PAGE_SIZE = 30;

/**
 * Date filter presets (TOP-193). Each maps to an inclusive ISO lower bound on
 * the issue completion date; "all" leaves the bound unset. Newest first is the
 * endpoint's fixed order.
 */
export const DELIVERABLE_RANGE_OPTIONS: { value: DeliverableRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "365d", label: "Past year" },
];

export type DeliverableRange = "all" | "7d" | "30d" | "90d" | "365d";

const RANGE_DAYS: Record<Exclude<DeliverableRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

export function deliverableRangeLabel(value: DeliverableRange): string {
  return DELIVERABLE_RANGE_OPTIONS.find((option) => option.value === value)?.label ?? "All time";
}

export function parseDeliverableRange(value: string | null): DeliverableRange {
  return value === "7d" || value === "30d" || value === "90d" || value === "365d" ? value : "all";
}

/** Inclusive ISO lower bound for a range preset, or null for "all". */
export function deliverableRangeFrom(value: DeliverableRange, now = Date.now()): string | null {
  if (value === "all") return null;
  return new Date(now - RANGE_DAYS[value] * 24 * 60 * 60 * 1000).toISOString();
}

export function Deliverables() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();

  const projectId = searchParams.get("project") ?? undefined;
  const range = parseDeliverableRange(searchParams.get("range"));

  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Deliverables" }]);
  }, [setBreadcrumbs]);

  const updateParams = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      });
    },
    [setSearchParams],
  );

  const selectProject = useCallback(
    (value: string | null) => {
      updateParams((next) => {
        if (value) next.set("project", value);
        else next.delete("project");
      });
    },
    [updateParams],
  );

  const selectRange = useCallback(
    (value: DeliverableRange) => {
      updateParams((next) => {
        if (value === "all") next.delete("range");
        else next.set("range", value);
      });
    },
    [updateParams],
  );

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const from = useMemo(() => deliverableRangeFrom(range), [range]);

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteQuery({
    queryKey: queryKeys.deliverables.list(selectedCompanyId!, projectId, from ?? undefined),
    queryFn: ({ pageParam }) =>
      deliverablesApi.list(selectedCompanyId!, {
        projectId,
        from: from ?? undefined,
        limit: DELIVERABLES_PAGE_SIZE,
        cursor: pageParam,
      }),
    enabled: !!selectedCompanyId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const deliverables = useMemo(
    () => data?.pages.flatMap((page) => page.deliverables) ?? [],
    [data],
  );

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      await fetchNextPage();
    } finally {
      setLoadingMore(false);
    }
  }, [fetchNextPage]);

  if (!selectedCompanyId) {
    return <EmptyState icon={PackageCheck} message="Select an organization to view deliverables." />;
  }

  const projects = projectsQuery.data ?? [];
  const selectedProjectName = projectId
    ? (projects.find((project) => project.id === projectId)?.name ?? "Selected project")
    : "All projects";

  return (
    <div className="w-full max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Deliverables</h1>
          <p className="text-sm text-muted-foreground">
            Everything that was finished, in plain English — newest first.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Filter deliverables by project (currently ${selectedProjectName})`}
                data-testid="deliverable-project-filter"
                className={cn("h-8", projectId && "bg-accent")}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="max-w-32 truncate">{selectedProjectName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Project</DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="deliverable-project-option-all"
                aria-selected={!projectId}
                onSelect={() => selectProject(null)}
                className="justify-between"
              >
                All projects
                {!projectId ? <Check className="h-3.5 w-3.5" /> : null}
              </DropdownMenuItem>
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  data-testid={`deliverable-project-option-${project.id}`}
                  aria-selected={projectId === project.id}
                  onSelect={() => selectProject(project.id)}
                  className="justify-between"
                >
                  <span className="truncate">{project.name}</span>
                  {projectId === project.id ? <Check className="h-3.5 w-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Filter deliverables by date (currently ${deliverableRangeLabel(range)})`}
                data-testid="deliverable-range-filter"
                data-range={range}
                className={cn("h-8", range !== "all" && "bg-accent")}
              >
                <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{deliverableRangeLabel(range)}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Completed</DropdownMenuLabel>
              {DELIVERABLE_RANGE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  data-testid={`deliverable-range-option-${option.value}`}
                  aria-selected={range === option.value}
                  onSelect={() => selectRange(option.value)}
                  className="justify-between"
                >
                  {option.label}
                  {range === option.value ? <Check className="h-3.5 w-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {isLoading ? (
        <PageSkeleton variant="list" />
      ) : deliverables.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          message={
            projectId || range !== "all"
              ? "No finished work matches these filters."
              : "Nothing finished yet. Completed tasks will appear here with a plain-English summary."
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {deliverables.map((deliverable) => (
              <DeliverableCard key={deliverable.id} deliverable={deliverable} />
            ))}
          </div>
          <div className="flex min-h-10 items-center justify-center pb-2 text-xs text-muted-foreground">
            {hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={isFetchingNextPage || loadingMore}
                data-testid="deliverables-load-more"
              >
                {isFetchingNextPage || loadingMore ? "Loading more..." : "Load more"}
              </Button>
            ) : isFetching ? (
              "Updating deliverables..."
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
