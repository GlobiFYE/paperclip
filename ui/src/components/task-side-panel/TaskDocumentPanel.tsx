import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue, IssueDocument } from "@paperclipai/shared";
import { FileQuestion, Loader2, Trash2 } from "lucide-react";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { DocumentAnnotationsCountChip, IssueDocumentAnnotations } from "@/components/IssueDocumentAnnotations";
import { MarkdownBody } from "@/components/MarkdownBody";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";
import { documentDisplayTitle } from "@/lib/issue-artifacts";
import { useLocation } from "@/lib/router";

type DeleteDocumentTarget = {
  issueId: string;
  documentKey: string;
};

export function TaskDocumentPanel({
  issueId,
  documentKey,
  initialDocument,
  canDeleteDocuments = false,
  onDeleted,
}: {
  issueId: string;
  documentKey: string;
  initialDocument?: IssueDocument;
  canDeleteDocuments?: boolean;
  onDeleted?: (documentKey: string) => void;
}) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [annotationPanelOpen, setAnnotationPanelOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const query = useQuery<IssueDocument | null>({
    queryKey: [...queryKeys.issues.documents(issueId), documentKey],
    queryFn: async () => {
      try {
        return await issuesApi.getDocument(issueId, documentKey);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    initialData: initialDocument,
  });
  const deleteDocument = useMutation({
    mutationFn: (target: DeleteDocumentTarget) => issuesApi.deleteDocument(target.issueId, target.documentKey),
    onSuccess: (_result, target) => {
      const removeDocumentSummary = (issue: Issue | undefined) => issue
        ? {
            ...issue,
            documentSummaries: issue.documentSummaries?.filter((document) => document.key !== target.documentKey),
          }
        : issue;
      queryClient.setQueryData<IssueDocument[] | undefined>(
        [...queryKeys.issues.documents(target.issueId), "list"],
        (documents) => documents?.filter((document) => document.key !== target.documentKey),
      );
      queryClient.setQueryData<IssueDocument | null>(
        [...queryKeys.issues.documents(target.issueId), target.documentKey],
        null,
      );
      queryClient.setQueryData<Issue | undefined>(
        queryKeys.issues.detail(target.issueId),
        removeDocumentSummary,
      );
      const detailAliases = queryClient.getQueriesData<Issue>({ queryKey: ["issues", "detail"] })
        .filter(([, issue]) => issue?.id === target.issueId || issue?.identifier === target.issueId);
      for (const [queryKey] of detailAliases) {
        queryClient.setQueryData<Issue | undefined>(queryKey, removeDocumentSummary);
        void queryClient.invalidateQueries({ queryKey, exact: true });
      }
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.issues.documents(target.issueId), "list"],
        exact: true,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(target.issueId) });
      setConfirmDeleteOpen(false);
      onDeleted?.(target.documentKey);
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading document…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="py-8 text-sm text-muted-foreground" role="alert">
        The document could not be loaded. Retry from the tab launcher or refresh the task.
      </div>
    );
  }
  const document = query.data;
  if (!document) {
    return (
      <div className="flex items-start gap-3 py-8 text-sm" role="status">
        <FileQuestion className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">Document no longer available</p>
          <p className="text-muted-foreground">
            This tab is preserved so the missing resource is explicit. Close it or choose another document.
          </p>
        </div>
      </div>
    );
  }

  const title = documentDisplayTitle(document);

  return (
    <article className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>{`Revision ${document.latestRevisionNumber ?? 1}`}</span>
            <span aria-hidden>·</span>
            <span>{`Updated ${new Date(document.updatedAt).toLocaleString()}`}</span>
            <DocumentAnnotationsCountChip
              issueId={issueId}
              docKey={document.key}
              panelOpen={annotationPanelOpen}
              onToggle={() => setAnnotationPanelOpen((open) => !open)}
            />
          </div>
        </div>
        {canDeleteDocuments && !document.lockedAt ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-destructive focus-visible:text-destructive"
            title="Delete document"
            aria-label={`Delete ${title}`}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 aria-hidden />
          </Button>
        ) : null}
      </header>
      {document.body.trim() ? (
        <IssueDocumentAnnotations
          issueId={issueId}
          doc={document}
          bodyMarkdown={document.body}
          draftDirty={false}
          draftConflicted={false}
          historicalPreview={false}
          locationHash={location.hash}
          panelOpen={annotationPanelOpen}
          onPanelOpenChange={setAnnotationPanelOpen}
          panelPlacement="popover"
        >
          <MarkdownBody>{document.body}</MarkdownBody>
        </IssueDocumentAnnotations>
      ) : (
        <p className="text-sm text-muted-foreground">Document is empty.</p>
      )}
      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (deleteDocument.isPending) return;
          setConfirmDeleteOpen(open);
          if (!open) deleteDocument.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the document and its revision history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteDocument.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteDocument.error instanceof Error
                ? deleteDocument.error.message
                : "The document could not be deleted."}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDocument.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteDocument.isPending}
              onClick={(event) => {
                event.preventDefault();
                deleteDocument.mutate({ issueId, documentKey });
              }}
            >
              {deleteDocument.isPending ? "Deleting…" : "Delete document"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
