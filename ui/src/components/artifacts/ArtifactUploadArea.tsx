import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileUp, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidePanelFrame } from "@/components/side-panel/SidePanelFrame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ArtifactUploadEntry {
  id: string;
  filename: string;
  status: "uploading" | "error";
  error?: string;
}

/** Upload controls and a pane-wide drop target; the host owns persistence. */
export function ArtifactUploadArea({
  children,
  header,
  empty = false,
  entries = [],
  onUpload,
  onRetry,
  onDismiss,
}: {
  children?: ReactNode;
  header?: ReactNode;
  empty?: boolean;
  entries?: ArtifactUploadEntry[];
  onUpload: (files: File[]) => void;
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  function hasFiles(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  return (
    <section
      aria-label="Artifact uploads"
      className="relative h-full min-h-0"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onUpload(files);
      }}
    >
      <SidePanelFrame presentation="sheet" label="Task artifacts" header={header} trailingControls={
        <>
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Choose artifact files"
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) onUpload(files);
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Upload files" className="size-(--sz-44px) bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent sm:size-9" onClick={() => inputRef.current?.click()}>
              <Upload aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload files</TooltipContent>
        </Tooltip>
        </>
      }>
      <div className="flex min-h-full flex-col gap-3">
      {entries.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Uploads">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2 rounded-lg border border-border p-3">
              {entry.status === "uploading" ? (
                <Loader2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
              ) : <FileUp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="break-words text-sm font-medium">{entry.filename}</span>
                <span role={entry.status === "error" ? "alert" : "status"} className={cn("text-xs", entry.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                  {entry.status === "uploading" ? "Uploading…" : entry.error ?? "Upload failed. Try again."}
                </span>
              </div>
              {entry.status === "error" ? (
                <div className="flex shrink-0 items-center gap-1">
                  {onRetry ? <Button variant="ghost" size="sm" onClick={() => onRetry(entry.id)}>Retry</Button> : null}
                  {onDismiss ? <Button variant="ghost" size="icon-sm" aria-label={`Dismiss upload: ${entry.filename}`} onClick={() => onDismiss(entry.id)}><X aria-hidden="true" /></Button> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <FileUp aria-hidden="true" className="size-6 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Add files to this task</p>
            <p className="text-sm text-muted-foreground">Drop files anywhere in this panel or use the upload icon.</p>
          </div>
        </div>
      ) : children}
      </div>
      </SidePanelFrame>
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-primary bg-background/95 px-6 text-center" role="status">
          <Upload aria-hidden="true" className="size-6 text-primary" />
          <p className="text-sm font-medium">Drop files to add them to this task</p>
        </div>
      ) : null}
    </section>
  );
}
