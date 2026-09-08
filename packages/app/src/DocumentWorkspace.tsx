import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronDown,
  CodeXml,
  Download,
  Eye,
  Loader2,
  MessageSquarePlus,
  PencilLine,
  RefreshCcw,
  Upload,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DocumentEditorViewMode } from "./app-navigation";
import { RemoteSessionBanner } from "./components/RemoteSessionBanner";
import { Button } from "./components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
} from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { criticMarkdownHasReviewRail } from "./critic-markup";
import { cn } from "./lib/utils";
import { toHtml } from "./markdown";
import {
  type DocumentInteractionMode,
  type DocumentSaveController,
  type DocumentSaveState,
  PageCard,
} from "./PageCard";
import type { CompleteReviewOptions, Page, StorageBackend } from "./storage";

type DiskChangeState = "clean" | "changed" | "conflict" | "paused";
type ReviewHandoffState =
  | "idle"
  | "notifying"
  | "notified"
  | "undelivered"
  | "error";
type FileCopyAction = "path" | "filename" | "markdown" | "rich-text";

const documentInteractionModeOptions = [
  { value: "editing", label: "Editing", Icon: PencilLine },
  { value: "suggesting", label: "Suggesting", Icon: MessageSquarePlus },
  { value: "viewing", label: "Viewing", Icon: Eye },
] satisfies {
  value: DocumentInteractionMode;
  label: string;
  Icon: typeof Eye;
}[];

const conflictNoticeCopy: Record<
  Exclude<DiskChangeState, "clean">,
  {
    title: string;
    body: string;
  }
> = {
  changed: {
    title: "File changed on disk",
    body: "Quick Notes found a newer version of this file on disk. Reload to use that version, or overwrite it with your current draft.",
  },
  conflict: {
    title: "Save conflict",
    body: "This file changed on disk while you have unsaved edits. Autosave is paused so your draft will not overwrite those changes.",
  },
  paused: {
    title: "Autosave paused",
    body: "Keep editing locally, then reload from disk to discard your draft or overwrite the disk file when you are ready.",
  },
};

const fileCopyMenuOptions = [
  { action: "path", label: "Copy path" },
  { action: "filename", label: "Copy filename" },
  { action: "markdown", label: "Copy markdown" },
  { action: "rich-text", label: "Copy rich text" },
] satisfies {
  action: FileCopyAction;
  label: string;
}[];

async function writePlainTextToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

async function writeRichTextToClipboard(markdown: string) {
  const clipboardWithRichText = navigator.clipboard as Clipboard & {
    write?: Clipboard["write"];
  };

  if (clipboardWithRichText.write && typeof ClipboardItem !== "undefined") {
    await clipboardWithRichText.write([
      new ClipboardItem({
        "text/html": new Blob([toHtml(markdown)], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      }),
    ]);
    return;
  }

  await writePlainTextToClipboard(markdown);
}

function getSaveStatusViewModel(
  saveState: DocumentSaveState,
  diskChangeState: DiskChangeState,
) {
  if (diskChangeState === "conflict") {
    return {
      label: "Save conflict",
      ariaLabel: "Save conflict",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (diskChangeState === "changed") {
    return {
      label: "File changed on disk",
      ariaLabel: "File changed on disk",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (diskChangeState === "paused") {
    return {
      label: "Autosave paused",
      ariaLabel: "Autosave paused",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (saveState === "saving") {
    return {
      label: "Saving",
      ariaLabel: "Saving",
      tone: "neutral" as const,
      Icon: Loader2,
    };
  }

  if (saveState === "error") {
    return {
      label: "Save failed",
      ariaLabel: "Save failed",
      tone: "danger" as const,
      Icon: AlertTriangle,
    };
  }

  if (saveState === "unsaved") {
    return {
      label: "Unsaved changes",
      ariaLabel: "Unsaved changes",
      tone: "neutral" as const,
      Icon: Loader2,
    };
  }

  return {
    label: "Saved",
    ariaLabel: "Saved",
    tone: "success" as const,
    Icon: Check,
  };
}

export function DocumentSaveStatusIndicator({
  saveState,
  diskChangeState,
}: {
  saveState: DocumentSaveState;
  diskChangeState: DiskChangeState;
}) {
  const saveStatus = getSaveStatusViewModel(saveState, diskChangeState);
  const SaveStatusIcon = saveStatus.Icon;

  return (
    <span
      data-testid="document-save-status"
      role="status"
      aria-label={saveStatus.ariaLabel}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center text-stone-400 dark:text-stone-500",
        saveStatus.tone === "warning" && "text-amber-600 dark:text-amber-400",
        saveStatus.tone === "danger" && "text-red-600 dark:text-red-400",
      )}
    >
      <SaveStatusIcon
        data-testid="document-save-status-icon"
        className={cn(
          "size-3.5 shrink-0",
          (saveStatus.label === "Saving" ||
            saveStatus.label === "Unsaved changes") &&
            "animate-spin",
          saveStatus.label === "Saved" && "document-save-status-saved",
        )}
        aria-hidden="true"
      />
    </span>
  );
}

export function isReviewHandoffDisabled({
  saveState,
  documentDiskChangeState,
  reviewHandoffState,
}: {
  saveState: DocumentSaveState;
  documentDiskChangeState: DiskChangeState;
  reviewHandoffState: ReviewHandoffState;
}) {
  // Transient save states ("saving"/"unsaved") intentionally do NOT disable the
  // button. Disabling on them dims the whole control on every keystroke while
  // autosave debounces. Instead the button stays enabled and flushes the
  // pending save on click, so the agent still receives the latest content.
  return (
    saveState === "error" ||
    reviewHandoffState !== "idle" ||
    documentDiskChangeState !== "clean"
  );
}

interface DocumentWorkspaceProps {
  isPractice?: boolean;
  documentPage: Page | null;
  activeDocumentPath: string | null;
  documentFilenameLabel: string;
  documentEditorViewMode: DocumentEditorViewMode;
  onDocumentEditorViewModeChange: (mode: DocumentEditorViewMode) => void;
  onSaveDocument: (id: string, content: string) => Promise<void>;
  onDocumentSaveStateChange: (state: DocumentSaveState) => void;
  onDocumentDirtyStateChange: (isDirty: boolean) => void;
  onDocumentLocalContentChange: (markdown: string) => void;
  documentDiskChangeState: DiskChangeState;
  documentForceResetKey: string | null;
  onReloadDocumentFromDisk: () => void | Promise<void>;
  onKeepEditingWithoutAutosave: () => void;
  onOverwriteDocumentOnDisk: () => void | Promise<void>;
  onCompleteReview: (
    options?: CompleteReviewOptions,
  ) => Promise<{ delivered: boolean }>;
  backend: StorageBackend | null;
}

export function DocumentWorkspace({
  isPractice = false,
  documentPage,
  activeDocumentPath,
  documentFilenameLabel,
  documentEditorViewMode,
  onDocumentEditorViewModeChange,
  onSaveDocument,
  onDocumentSaveStateChange,
  onDocumentDirtyStateChange,
  onDocumentLocalContentChange,
  documentDiskChangeState,
  documentForceResetKey,
  onReloadDocumentFromDisk,
  onKeepEditingWithoutAutosave,
  onOverwriteDocumentOnDisk,
  onCompleteReview,
  backend,
}: DocumentWorkspaceProps) {
  const [documentInteractionMode, setDocumentInteractionMode] =
    useState<DocumentInteractionMode>("editing");
  const [saveState, setSaveState] = useState<DocumentSaveState>("saved");
  const [reviewHandoffState, setReviewHandoffState] =
    useState<ReviewHandoffState>("idle");
  const [reviewWatcherCount, setReviewWatcherCount] = useState(0);
  const [reviewHandoffPopoverOpen, setReviewHandoffPopoverOpen] =
    useState(false);
  const [fileCopyMenuOpen, setFileCopyMenuOpen] = useState(false);
  const [copiedFileAction, setCopiedFileAction] =
    useState<FileCopyAction | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [readingSize, setReadingSize] = useState(() => {
    try {
      const stored = localStorage.getItem("iq-quick-notes-reading-size");
      return stored === "large" || stored === "largest" ? stored : "standard";
    } catch {
      return "standard";
    }
  });
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIdentity = `${activeDocumentPath ?? ""}:${documentPage?.id ?? ""}`;
  const currentDraft = useRef({
    identity: draftIdentity,
    markdown: documentPage?.content ?? "",
  });
  if (currentDraft.current.identity !== draftIdentity) {
    currentDraft.current = {
      identity: draftIdentity,
      markdown: documentPage?.content ?? "",
    };
  }
  const handleLocalContentChange = useCallback(
    (markdown: string) => {
      currentDraft.current.markdown = markdown;
      onDocumentLocalContentChange(markdown);
    },
    [onDocumentLocalContentChange],
  );
  useEffect(
    () => () => {
      if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
    },
    [],
  );
  const [overallComment, setOverallComment] = useState("");
  const sawNoWatcherAfterNotifiedRef = useRef(false);
  const saveControllerRef = useRef<DocumentSaveController | null>(null);

  const handleSaveStateChange = useCallback(
    (state: DocumentSaveState) => {
      setSaveState(state);
      onDocumentSaveStateChange(state);
    },
    [onDocumentSaveStateChange],
  );

  const [documentHasComments, setDocumentHasComments] = useState(
    () =>
      !!documentPage?.content &&
      criticMarkdownHasReviewRail(documentPage.content),
  );

  useEffect(() => {
    setDocumentHasComments(
      !!documentPage?.content &&
        criticMarkdownHasReviewRail(documentPage.content),
    );
  }, [documentPage?.content]);

  useEffect(() => {
    const documentIdentity = `${activeDocumentPath ?? ""}:${documentPage?.id ?? ""}`;
    if (!documentIdentity) return;
    setReviewHandoffState("idle");
  }, [activeDocumentPath, documentPage?.id]);

  useEffect(() => {
    if (!backend?.getReviewWatchStatus || !activeDocumentPath) {
      setReviewWatcherCount(0);
      return;
    }

    let cancelled = false;
    const refreshWatchStatus = async () => {
      try {
        const status = await backend.getReviewWatchStatus?.(activeDocumentPath);
        if (!cancelled) {
          setReviewWatcherCount(status?.watcherCount ?? 0);
        }
      } catch {
        if (!cancelled) {
          setReviewWatcherCount(0);
        }
      }
    };

    void refreshWatchStatus();
    const interval = window.setInterval(refreshWatchStatus, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeDocumentPath, backend]);

  useEffect(() => {
    if (reviewHandoffState === "undelivered" && reviewWatcherCount > 0) {
      setReviewHandoffState("idle");
      return;
    }

    if (reviewHandoffState !== "notified") {
      sawNoWatcherAfterNotifiedRef.current = false;
      return;
    }

    if (reviewWatcherCount === 0) {
      sawNoWatcherAfterNotifiedRef.current = true;
      return;
    }

    if (sawNoWatcherAfterNotifiedRef.current) {
      sawNoWatcherAfterNotifiedRef.current = false;
      setReviewHandoffState("idle");
    }
  }, [reviewHandoffState, reviewWatcherCount]);

  useEffect(() => {
    if (!documentPage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut =
        event.key.toLowerCase() === "s" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey;

      if (!isSaveShortcut) return;

      event.preventDefault();
      event.stopPropagation();

      if (documentDiskChangeState !== "clean") return;

      void saveControllerRef.current?.flushSave();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [documentDiskChangeState, documentPage]);

  const handleCompleteReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      if (!activeDocumentPath || reviewHandoffState === "notifying") return;

      setReviewHandoffState("notifying");
      try {
        // The button stays enabled while autosave is still pending, so make
        // sure any debounced edits are persisted before handing off.
        const flushResult = await saveControllerRef.current?.flushSave();
        if (flushResult && flushResult.status === "error") {
          throw flushResult.error;
        }

        const result = await onCompleteReview(options);
        if (result.delivered) {
          setReviewWatcherCount(0);
          setReviewHandoffState("notified");
          setOverallComment("");
          setReviewHandoffPopoverOpen(true);
        } else {
          setReviewWatcherCount(0);
          setReviewHandoffState("undelivered");
          setReviewHandoffPopoverOpen(true);
        }
      } catch (error) {
        console.error("Failed to complete review:", error);
        setReviewHandoffState("error");
        setReviewHandoffPopoverOpen(true);
      }
    },
    [activeDocumentPath, onCompleteReview, reviewHandoffState],
  );

  const handleCopyFileMenuAction = useCallback(
    async (action: FileCopyAction) => {
      if (!documentPage) return;

      const copyTextByAction: Record<
        Exclude<FileCopyAction, "rich-text">,
        string
      > = {
        path: activeDocumentPath ?? documentFilenameLabel,
        filename: documentFilenameLabel,
        markdown: currentDraft.current.markdown,
      };

      setFileActionError(null);
      setCopiedFileAction(null);
      try {
        if (action === "rich-text") {
          await writeRichTextToClipboard(currentDraft.current.markdown);
        } else {
          await writePlainTextToClipboard(copyTextByAction[action]);
        }

        setCopiedFileAction(action);
        if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
        copyFeedbackTimer.current = setTimeout(
          () => setCopiedFileAction(null),
          2500,
        );
      } catch (error) {
        console.error("Failed to copy document data:", error);
        setFileActionError(
          "Your browser could not copy this note. Choose Download a copy to keep your latest draft.",
        );
      }
    },
    [activeDocumentPath, documentFilenameLabel, documentPage],
  );

  const handleDownloadCopy = useCallback(() => {
    if (!documentPage) return;
    setFileActionError(null);
    setDownloadMessage(null);
    let url: string | null = null;
    try {
      const blob = new Blob([currentDraft.current.markdown], {
        type: "text/markdown;charset=utf-8",
      });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const safeName = Array.from(
        documentFilenameLabel.replace(/\.md$/i, ""),
        (character) =>
          character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character)
            ? "-"
            : character,
      ).join("");
      anchor.download = `${safeName || "note"}-copy.md`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setDownloadMessage(
        "A download was requested for your current draft. Check your browser’s Downloads. Your original note has not been changed.",
      );
    } catch (error) {
      console.error("Failed to download draft:", error);
      setFileActionError(
        "Your browser could not start the download. Keep this window open and try Copy markdown, or select and copy the note text.",
      );
    } finally {
      if (url) {
        const downloadUrl = url;
        const revokeObjectURL = URL.revokeObjectURL.bind(URL);
        setTimeout(() => revokeObjectURL(downloadUrl), 30_000);
      }
    }
  }, [documentFilenameLabel, documentPage]);

  const editorViewModeToggleLabel =
    documentEditorViewMode === "rich-text"
      ? "Switch to code view"
      : "Switch to rich text view";
  const activeDocumentInteractionMode = documentInteractionModeOptions.find(
    (option) => option.value === documentInteractionMode,
  );
  const ActiveDocumentInteractionModeIcon =
    activeDocumentInteractionMode?.Icon ?? PencilLine;
  const conflictNotice =
    documentDiskChangeState === "clean"
      ? null
      : conflictNoticeCopy[documentDiskChangeState];
  const showReviewHandoffButton =
    !!activeDocumentPath &&
    (reviewWatcherCount > 0 || reviewHandoffState !== "idle");
  const reviewHandoffButtonLabel =
    reviewHandoffState === "notifying"
      ? "Sending"
      : reviewHandoffState === "notified"
        ? "Sent"
        : reviewHandoffState === "error" || reviewHandoffState === "undelivered"
          ? "Not sent"
          : "I'm done";
  const ReviewHandoffButtonIcon =
    reviewHandoffState === "notifying"
      ? Loader2
      : reviewHandoffState === "error" || reviewHandoffState === "undelivered"
        ? AlertTriangle
        : null;
  const reviewHandoffStatusTitle =
    reviewHandoffState === "undelivered"
      ? "No agent is watching now"
      : reviewHandoffState === "error"
        ? "Could not notify agent"
        : "Your agent is now working";
  const reviewHandoffStatusBody =
    reviewHandoffState === "undelivered"
      ? "The handoff was not delivered because the watcher is no longer connected."
      : reviewHandoffState === "error"
        ? "Roughdraft could not send the handoff. Check that the local server is still running."
        : "It will take the appropriate next action, including replying to comments, questions, and suggestions, and/or directly editing the doc.";
  const reviewHandoffDisabled = isReviewHandoffDisabled({
    saveState,
    documentDiskChangeState,
    reviewHandoffState,
  });
  const trimmedOverallComment = overallComment.trim();

  return (
    <div
      data-testid="document-workspace"
      className={cn(
        "quick-notes-workspace min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-12",
        "pt-10",
      )}
      style={
        {
          "--reading-text-size":
            readingSize === "largest"
              ? "24px"
              : readingSize === "large"
                ? "21px"
                : "18px",
        } as CSSProperties
      }
    >
      <RemoteSessionBanner backend={backend} />
      <div
        className={cn(
          "fixed right-3 z-[60] flex max-w-[min(16rem,calc(100vw-1rem))] flex-col items-end gap-1.5",
          conflictNotice ? "top-[19rem] sm:top-[7rem]" : "top-3",
        )}
        data-testid="document-status-stack"
        data-document-status-stack="true"
      >
        <div className="flex max-w-full items-center justify-end gap-1.5">
          {showReviewHandoffButton ? (
            <Popover
              open={reviewHandoffPopoverOpen}
              onOpenChange={setReviewHandoffPopoverOpen}
            >
              <div className="relative flex items-center overflow-hidden rounded-[7px] shadow-[0_10px_28px_rgba(0,0,0,0.18)] after:pointer-events-none after:absolute after:top-px after:right-8 after:bottom-px after:z-10 after:w-px after:bg-[#444] after:content-[''] dark:after:bg-[#444]">
                <Button
                  type="button"
                  data-testid="review-handoff-button"
                  size="lg"
                  className="h-9 rounded-r-none rounded-l-[7px] border-0 bg-black px-3 text-sm font-bold text-white hover:bg-black/85 focus-visible:ring-black/25 dark:bg-black dark:text-white dark:hover:bg-black/85 dark:focus-visible:ring-white/30"
                  disabled={reviewHandoffDisabled}
                  onClick={() =>
                    void handleCompleteReview(
                      trimmedOverallComment
                        ? { overallComment: trimmedOverallComment }
                        : undefined,
                    )
                  }
                >
                  {ReviewHandoffButtonIcon ? (
                    <ReviewHandoffButtonIcon
                      className={cn(
                        "size-4",
                        reviewHandoffState === "notifying" && "animate-spin",
                      )}
                    />
                  ) : null}
                  {reviewHandoffButtonLabel}
                </Button>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      data-testid="review-handoff-comment-trigger"
                      size="icon-lg"
                      className="h-9 w-8 rounded-l-none rounded-r-[7px] border-0 bg-black text-white hover:bg-black/85 focus-visible:ring-black/25 dark:bg-black dark:text-white dark:hover:bg-black/85 dark:focus-visible:ring-white/30"
                      disabled={reviewHandoffDisabled}
                      aria-label="Add overall handoff comment"
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  }
                />
              </div>
              <PopoverContent
                aria-label={
                  reviewHandoffState === "idle"
                    ? "Review handoff comment"
                    : "Review handoff status"
                }
                data-testid={
                  reviewHandoffState === "idle"
                    ? "review-handoff-comment-popover"
                    : "review-handoff-status"
                }
              >
                {reviewHandoffState === "idle" ? (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleCompleteReview({
                        overallComment: trimmedOverallComment,
                      });
                    }}
                  >
                    <div>
                      <Textarea
                        id="review-handoff-overall-comment"
                        data-testid="review-handoff-overall-comment"
                        aria-label="Overall comment"
                        placeholder="Overall comment"
                        value={overallComment}
                        onChange={(event) =>
                          setOverallComment(event.currentTarget.value)
                        }
                        maxLength={4000}
                        rows={4}
                        className="min-h-24 resize-y"
                      />
                    </div>
                    <Button
                      type="submit"
                      data-testid="review-handoff-submit-comment"
                      size="lg"
                      className="w-full rounded-[7px] bg-black text-sm font-bold text-white hover:bg-black/85 focus-visible:ring-black/25 dark:bg-white dark:text-black dark:hover:bg-white/90"
                      disabled={!trimmedOverallComment}
                    >
                      <CheckCheck className="size-4" />
                      Submit with comment
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black">
                      {reviewHandoffState === "notifying" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : reviewHandoffState === "error" ||
                        reviewHandoffState === "undelivered" ? (
                        <AlertTriangle className="size-4" />
                      ) : (
                        <CheckCheck className="size-4" />
                      )}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-stone-950 dark:text-slate-50">
                        {reviewHandoffStatusTitle}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-slate-300">
                        {reviewHandoffStatusBody}
                      </p>
                    </div>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>
      {conflictNotice ? (
        <div
          data-testid="file-conflict-notice"
          role="status"
          aria-label="File conflict"
          className="sticky top-0 z-50 mx-auto mb-6 flex w-full max-w-4xl flex-col gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-4 text-amber-950 dark:text-amber-100 shadow-sm"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-5">
                {conflictNotice.title}
              </div>
              <div className="mt-0.5 text-xs leading-5 text-amber-900 dark:text-amber-200">
                {conflictNotice.body}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
            <Button
              type="button"
              data-testid="file-conflict-action-reload"
              variant="ghost"
              size="sm"
              className="h-8 rounded-[7px] bg-white/55 dark:bg-white/10 px-2 text-xs text-amber-950 dark:text-amber-100 hover:bg-white dark:hover:bg-white/20"
              onClick={() => void onReloadDocumentFromDisk()}
            >
              <RefreshCcw className="size-3.5" />
              Reload from disk
            </Button>
            {documentDiskChangeState !== "paused" ? (
              <Button
                type="button"
                data-testid="file-conflict-action-keep-editing"
                variant="ghost"
                size="sm"
                className="h-8 rounded-[7px] bg-white/55 dark:bg-white/10 px-2 text-xs text-amber-950 dark:text-amber-100 hover:bg-white dark:hover:bg-white/20"
                onClick={onKeepEditingWithoutAutosave}
              >
                <PencilLine className="size-3.5" />
                Keep editing with autosave paused
              </Button>
            ) : null}
            <Button
              type="button"
              data-testid="file-conflict-action-overwrite"
              variant="ghost"
              size="sm"
              className="h-8 rounded-[7px] bg-amber-900 dark:bg-amber-600 px-2 text-xs text-white hover:bg-amber-800 dark:hover:bg-amber-500"
              onClick={() => void onOverwriteDocumentOnDisk()}
            >
              <Upload className="size-3.5" />
              Overwrite disk file
            </Button>
          </div>
        </div>
      ) : null}
      <div className="mx-auto min-h-full max-w-[1080px]">
        {documentPage ? (
          <div
            data-testid="document-page-header"
            className={cn(
              "document-page-shell mb-2 flex flex-col gap-6 text-[0.62rem] font-medium tracking-[0.01em] text-stone-400 min-[1100px]:grid min-[1100px]:grid-cols-[minmax(0,46.5rem)_minmax(24rem,1fr)] min-[1100px]:items-start min-[1100px]:justify-between min-[1100px]:gap-8",
              !documentHasComments &&
                "document-page-shell-no-comments min-[1100px]:grid-cols-[minmax(0,46.5rem)] min-[1100px]:justify-center",
            )}
          >
            <div className="document-page-main w-full max-w-[46.5rem] min-w-0">
              <div className="flex w-full flex-wrap items-center gap-1.5 px-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-testid="document-editor-view-toggle"
                        className="grid h-10 shrink-0 grid-cols-2 items-center rounded-full bg-[#E8E3DB] dark:bg-slate-700 px-2 shadow-sm"
                      >
                        <span
                          className={`flex w-[1.375rem] items-center justify-center rounded-full py-[2px] transition ${
                            documentEditorViewMode === "rich-text"
                              ? "bg-[#FFFDFC] dark:bg-slate-500 text-stone-700 dark:text-white shadow-[0_1px_2px_rgba(41,37,36,0.12)]"
                              : "text-stone-500 dark:text-slate-400"
                          }`}
                        >
                          <Eye className="size-[0.75rem]" />
                        </span>
                        <span
                          className={`flex w-[1.375rem] items-center justify-center rounded-full py-[2px] transition ${
                            documentEditorViewMode === "code"
                              ? "bg-[#FFFDFC] dark:bg-slate-500 text-stone-700 dark:text-white shadow-[0_1px_2px_rgba(41,37,36,0.12)]"
                              : "text-stone-500 dark:text-slate-400"
                          }`}
                        >
                          <CodeXml className="size-[0.75rem]" />
                        </span>
                      </button>
                    }
                    aria-label={editorViewModeToggleLabel}
                    onClick={() =>
                      onDocumentEditorViewModeChange(
                        documentEditorViewMode === "rich-text"
                          ? "code"
                          : "rich-text",
                      )
                    }
                  />
                  <TooltipContent>{editorViewModeToggleLabel}</TooltipContent>
                </Tooltip>
                <Popover
                  open={fileCopyMenuOpen}
                  onOpenChange={setFileCopyMenuOpen}
                >
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        data-testid="document-file-menu-trigger"
                        className="inline-flex h-10 min-w-0 max-w-full items-center gap-1 rounded-full px-2 font-mono text-sm text-slate-700 outline-none transition hover:bg-[#EEE9E1] focus-visible:ring-2 focus-visible:ring-stone-300/70 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-slate-600/70"
                        title={documentFilenameLabel}
                        aria-label="Document file actions"
                      >
                        <span className="min-w-0 truncate">
                          {documentFilenameLabel}
                        </span>
                        <ChevronDown
                          className="size-[0.62rem] shrink-0"
                          aria-hidden="true"
                        />
                      </button>
                    }
                  />
                  <PopoverContent
                    aria-label="Document file actions"
                    data-testid="document-file-menu"
                    className="w-72 max-w-[calc(100vw-2rem)] p-2"
                    align="start"
                  >
                    <div className="flex flex-col">
                      {fileCopyMenuOptions.map(({ action, label }) => (
                        <Button
                          key={action}
                          type="button"
                          data-testid={`document-file-menu-${action}`}
                          variant="ghost"
                          className="min-h-10 justify-between px-3 text-left text-base"
                          onClick={() => void handleCopyFileMenuAction(action)}
                        >
                          <span>{label}</span>
                          {copiedFileAction === action ? (
                            <span
                              role="status"
                              className="text-sm text-primary"
                            >
                              Copied
                            </span>
                          ) : null}
                        </Button>
                      ))}
                      <Button
                        variant="ghost"
                        data-testid="document-file-menu-download"
                        className="min-h-10 justify-start px-3 text-base"
                        onClick={handleDownloadCopy}
                      >
                        <Download aria-hidden="true" className="size-4" />
                        Download a copy
                      </Button>
                      <p className="px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                        Copy and download include your latest edits, even if
                        saving is paused.
                      </p>
                      {fileActionError ? (
                        <p
                          role="alert"
                          data-testid="document-file-action-error"
                          className="px-3 py-2 text-sm leading-relaxed text-red-700 dark:text-red-300"
                        >
                          {fileActionError}
                        </p>
                      ) : null}
                      {downloadMessage ? (
                        <p
                          role="status"
                          data-testid="document-download-status"
                          className="px-3 py-2 text-sm leading-relaxed text-muted-foreground"
                        >
                          {downloadMessage}
                        </p>
                      ) : null}
                    </div>
                  </PopoverContent>
                </Popover>
                {isPractice ? (
                  <span
                    className="text-sm text-amber-800"
                    role="status"
                    aria-label="Practice note, not saved"
                    data-testid="practice-save-status"
                  >
                    Not saved — practice
                  </span>
                ) : (
                  <DocumentSaveStatusIndicator
                    saveState={saveState}
                    diskChangeState={documentDiskChangeState}
                  />
                )}
                <Select
                  value={readingSize}
                  onValueChange={(value) => {
                    if (
                      value !== "standard" &&
                      value !== "large" &&
                      value !== "largest"
                    )
                      return;
                    setReadingSize(value);
                    try {
                      localStorage.setItem(
                        "iq-quick-notes-reading-size",
                        value,
                      );
                    } catch {
                      /* Reading remains available if preferences cannot be stored. */
                    }
                  }}
                >
                  <SelectTrigger
                    aria-label="Reading text size"
                    data-testid="document-reading-size"
                    className="h-10 min-w-32 px-2 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <span>
                      Text:{" "}
                      {readingSize === "largest"
                        ? "Largest"
                        : readingSize === "large"
                          ? "Large"
                          : "Standard"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      className="min-h-10 text-base"
                      value="standard"
                      data-testid="document-reading-size-standard"
                    >
                      Standard
                    </SelectItem>
                    <SelectItem
                      className="min-h-10 text-base"
                      value="large"
                      data-testid="document-reading-size-large"
                    >
                      Large
                    </SelectItem>
                    <SelectItem
                      className="min-h-10 text-base"
                      value="largest"
                      data-testid="document-reading-size-largest"
                    >
                      Largest
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="ml-auto inline-flex min-h-10 shrink-0 items-center">
                  <Select<DocumentInteractionMode>
                    value={documentInteractionMode}
                    onValueChange={(value) => {
                      if (value) setDocumentInteractionMode(value);
                    }}
                  >
                    <SelectTrigger
                      data-testid="document-mode-trigger"
                      aria-label="Document mode"
                      className="h-10 px-2 font-mono text-sm font-normal text-slate-700 dark:text-slate-200"
                    >
                      <ActiveDocumentInteractionModeIcon className="size-[0.68rem]" />
                      <span className="truncate">
                        {activeDocumentInteractionMode?.label}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {documentInteractionModeOptions.map(
                        ({ value, label, Icon }) => (
                          <SelectItem key={value} value={value} label={label}>
                            <Icon className="size-3 text-stone-500 dark:text-stone-400" />
                            <SelectItemText>{label}</SelectItemText>
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {documentHasComments ? (
              <div
                className="document-comment-rail pointer-events-none invisible hidden min-[1100px]:block"
                aria-hidden="true"
              />
            ) : null}
          </div>
        ) : null}
        {documentPage ? (
          backend ? (
            <PageCard
              key={`${documentPage.id}:${activeDocumentPath ?? ""}`}
              page={documentPage}
              activeDocumentPath={activeDocumentPath}
              selected
              onSave={onSaveDocument}
              onSaveStateChange={handleSaveStateChange}
              editorViewMode={documentEditorViewMode}
              interactionMode={documentInteractionMode}
              backend={backend}
              onCommentRailPresenceChange={setDocumentHasComments}
              onDirtyStateChange={onDocumentDirtyStateChange}
              onLocalContentChange={handleLocalContentChange}
              onSaveControllerChange={(controller) => {
                saveControllerRef.current = controller;
              }}
              saveBlocked={documentDiskChangeState !== "clean"}
              forceResetKey={documentForceResetKey}
            />
          ) : null
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            Open a markdown file to begin.
          </div>
        )}
      </div>
    </div>
  );
}
