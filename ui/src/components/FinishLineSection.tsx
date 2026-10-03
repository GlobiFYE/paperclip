import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FinishLineItem, FinishLineItemStatus, FinishLineItemTask } from "@paperclipai/shared";
import { Check, ListChecks, Plus, Trash2, X } from "lucide-react";
import { finishLineItemsApi } from "../api/finishLineItems";
import { queryKeys } from "../lib/queryKeys";
import { issueStatusIcon, issueStatusIconDefault } from "../lib/status-colors";
import { cn } from "../lib/utils";
import { createIssueDetailPath } from "../lib/issueDetailBreadcrumb";
import { Link } from "../lib/router";
import { InlineEditor } from "./InlineEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Anchor id for deep links (the task-detail chip links here). */
export const FINISH_LINE_SECTION_ANCHOR = "finish-line";

const SECTION_HEADER_TEXT = "Finish Line";
const ADD_BULLET_TEXT = "Add bullet";
const NO_ITEMS_HINT = "Describe what done looks like for this project — one bullet per outcome.";
const NUDGE_TEXT = "All tasks done — check it off?";

function toggleLabel(item: FinishLineItem): string {
  return item.status === "done"
    ? `Reopen finish-line item: ${item.title}`
    : `Mark finish-line item done: ${item.title}`;
}

/* ── One bullet row ──
   Checkbox-style toggle (StatusIcon-style: a bordered circle that fills with
   the done-green recipe when checked), title + description as inline-editable
   text, and a thumb-friendly delete. Under the row, the tasks tagged to this
   bullet nest automatically (linked through finish_line_item_id — never wired
   by hand); when every one of them is done and the bullet is still open, a
   quiet amber nudge offers the same one-tap check-off. Never auto-marks. The
   whole row stays quiet: no tables, comfortable tap targets, muted secondary
   description. ── */

function FinishLineItemRow({
  item,
  onToggle,
  onEdit,
  onDelete,
  deleteError,
}: {
  item: FinishLineItem;
  onToggle: (item: FinishLineItem) => void;
  onEdit: (id: string, data: { title?: string; description?: string | null }) => void;
  onDelete: (item: FinishLineItem) => void;
  deleteError: string | null;
}) {
  const done = item.status === "done";
  const tasks = item.tasks ?? [];
  // The server nests each bullet's tasks non-done first, so the live work
  // sits directly under the bullet and the muted done rows follow as the
  // record of what accomplished it.
  const allTasksDone = tasks.length > 0 && tasks.every((task) => task.status === "done");
  return (
    <li
      data-testid="finish-line-item"
      data-item-id={item.id}
      className="rounded-lg px-2 py-2 transition-colors hover:bg-accent/30 sm:px-3"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          data-testid="finish-line-toggle"
          aria-pressed={done}
          aria-label={toggleLabel(item)}
          onClick={() => onToggle(item)}
          className={cn(
            "mt-0.5 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors hover:bg-accent/50",
            done ? issueStatusIcon.done : issueStatusIconDefault,
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
        </button>
        <div className="min-w-0 flex-1 space-y-0.5">
          <InlineEditor
            value={item.title}
            onSave={(title) => onEdit(item.id, { title })}
            placeholder="Untitled bullet"
            className={cn(
              "text-sm font-medium",
              done && "text-muted-foreground line-through",
            )}
          />
          <InlineEditor
            value={item.description ?? ""}
            onSave={(description) => onEdit(item.id, { description: description || null })}
            placeholder="Add description..."
            nullable
            className="text-xs text-muted-foreground"
          />
        </div>
        <button
          type="button"
          data-testid="finish-line-delete"
          aria-label={`Delete finish-line item: ${item.title}`}
          onClick={() => onDelete(item)}
          className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {tasks.length > 0 ? (
        <ul
          data-testid="finish-line-item-tasks"
          aria-label={`Tasks serving: ${item.title}`}
          className="mt-1 space-y-1 pl-9"
        >
          {tasks.map((task) => {
            const taskDone = task.status === "done";
            return (
              <li
                key={task.id}
                data-testid="finish-line-item-task"
                data-task-id={task.id}
                className="flex min-w-0 items-center gap-2"
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full border",
                    issueStatusIcon[task.status] ?? issueStatusIconDefault,
                  )}
                />
                <Link
                  to={createIssueDetailPath(task.id)}
                  aria-label={`Open task: ${task.title}`}
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs hover:underline",
                    taskDone ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {task.title}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!done && allTasksDone ? (
        <button
          type="button"
          data-testid="finish-line-nudge"
          onClick={() => onToggle(item)}
          className="mt-1 inline-flex min-h-8 cursor-pointer items-center rounded-md pl-9 text-xs text-amber-600 transition-colors hover:underline dark:text-amber-400"
        >
          {NUDGE_TEXT}
        </button>
      ) : null}
      {deleteError ? (
        <p
          role="alert"
          data-testid="finish-line-delete-error"
          className="mt-1 pl-9 text-xs text-destructive"
        >
          {deleteError}
        </p>
      ) : null}
    </li>
  );
}

/* ── Inline "Add bullet" affordance: expandable title + optional description
   form. POSTs the new item; the server orders it (position, then createdAt). ── */

function AddBulletForm({
  onCreate,
  pending,
}: {
  onCreate: (data: { title: string; description: string | null }) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        data-testid="finish-line-add-toggle"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {ADD_BULLET_TEXT}
      </button>
    );
  }

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    onCreate({ title: trimmed, description: description.trim() || null });
    setTitle("");
    setDescription("");
    setOpen(false);
  };

  return (
    <div data-testid="finish-line-add-form" className="space-y-2 rounded-lg border border-border bg-muted/20 p-2 sm:p-3">
      <Input
        data-testid="finish-line-add-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What done looks like..."
        className="h-9 text-sm"
        // Enter submits — the description stays optional behind Tab.
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        autoFocus
      />
      <Input
        data-testid="finish-line-add-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="h-9 text-sm"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={!title.trim() || pending} data-testid="finish-line-add-submit">
          {ADD_BULLET_TEXT}
        </Button>
        <button
          type="button"
          aria-label="Cancel adding finish-line item"
          onClick={() => {
            setTitle("");
            setDescription("");
            setOpen(false);
          }}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * Finish Line — the project page's bullet list of "what done looks like".
 * Reads and writes through `finishLineItemsApi`; every mutation stays scoped
 * to one company + project. The checkbox toggle PATCHes optimistically (the
 * row flips immediately and reverts on failure), deletes surface the server's
 * message inline (a 409 means a task still tags the bullet — never silently
 * dropped), and the "X of N done" progress line is derived from the list, no
 * extra backend call.
 */
export function FinishLineSection({
  companyId,
  projectId,
  className,
}: {
  companyId: string;
  projectId: string;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const listQueryKey = queryKeys.finishLineItems.list(companyId, projectId);
  // Delete failures surface per item (keyed by id) so the message lands on the
  // row that produced it and clears on the next attempt.
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const { data: items, error } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => finishLineItemsApi.list(companyId, projectId),
  });

  const invalidateList = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.finishLineItems.all(companyId) });
  };

  // Optimistic status toggle: patch the cached row immediately, revert on error.
  // The same mutation path also serves title/description edits (non-optimistic
  // — an editor save already shows its own pending treatment).
  const updateItem = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title?: string; description?: string | null; status?: FinishLineItemStatus } }) =>
      finishLineItemsApi.update(companyId, id, data),
    onMutate: async ({ id, data }) => {
      if (data.status === undefined) return {};
      await queryClient.cancelQueries({ queryKey: listQueryKey });
      const previous = queryClient.getQueryData<FinishLineItem[]>(listQueryKey);
      if (previous) {
        queryClient.setQueryData(
          listQueryKey,
          previous.map((item) => (item.id === id ? { ...item, status: data.status } : item)),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(listQueryKey, context.previous);
      }
    },
    onSettled: invalidateList,
  });

  const createItem = useMutation({
    mutationFn: (data: { title: string; description: string | null }) =>
      finishLineItemsApi.create(companyId, projectId, data),
    onSuccess: invalidateList,
  });

  const deleteItem = useMutation({
    mutationFn: (item: FinishLineItem) => finishLineItemsApi.remove(companyId, item.id),
    onMutate: (item) => {
      setDeleteErrors((current) => {
        if (!(item.id in current)) return current;
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    },
    onSuccess: invalidateList,
    // A 409 (still referenced by tasks) must never disappear silently — the
    // server message shows inline under the row that was refused.
    onError: (mutationError, item) => {
      setDeleteErrors((current) => ({
        ...current,
        [item.id]: mutationError instanceof Error ? mutationError.message : "Failed to delete finish-line item",
      }));
    },
  });

  const list = items ?? [];
  const doneCount = list.filter((item) => item.status === "done").length;

  return (
    <section
      id={FINISH_LINE_SECTION_ANCHOR}
      data-testid="finish-line-section"
      aria-labelledby="finish-line-heading"
      className={cn("space-y-3", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="finish-line-heading" className="text-sm font-semibold">
          {SECTION_HEADER_TEXT}
        </h2>
        {list.length >= 2 ? (
          <span data-testid="finish-line-progress" className="text-xs text-muted-foreground">
            {doneCount} of {list.length} done
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load finish-line items."}
        </p>
      ) : null}

      {list.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">{NO_ITEMS_HINT}</p>
      ) : null}

      {list.length > 0 ? (
        <ul className="space-y-1">
          {list.map((item) => (
            <FinishLineItemRow
              key={item.id}
              item={item}
              onToggle={(next) =>
                updateItem.mutate({
                  id: next.id,
                  data: { status: next.status === "done" ? "open" : "done" },
                })
              }
              onEdit={(id, data) => updateItem.mutate({ id, data })}
              onDelete={(target) => deleteItem.mutate(target)}
              deleteError={deleteErrors[item.id] ?? null}
            />
          ))}
        </ul>
      ) : null}

      <AddBulletForm
        onCreate={(data) => createItem.mutate(data)}
        pending={createItem.isPending}
      />
    </section>
  );
}
