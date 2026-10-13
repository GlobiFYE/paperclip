import { IssuesList } from "@/components/IssuesList";
import { storybookAgents, storybookIssues, storybookProjects } from "../fixtures/paperclipData";

export function PaginatedTaskFixture({ state }: { state: "more" | "loading" | "retry" }) {
  return (
    <div className="paperclip-story p-6">
      <IssuesList
        issues={state === "more" ? storybookIssues.slice(0, 2) : []}
        agents={storybookAgents}
        projects={storybookProjects}
        viewStateKey={`storybook:paginated-tasks:${state}`}
        rowPresentation="task"
        toolbarPresentation="collection"
        hasMoreIssues
        isLoadingMoreIssues={state === "loading"}
        error={state === "retry" ? new Error("Could not load the next task page") : undefined}
        onLoadMoreIssues={() => undefined}
        onUpdateIssue={() => undefined}
      />
    </div>
  );
}
