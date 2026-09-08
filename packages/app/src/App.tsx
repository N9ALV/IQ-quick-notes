import {
  ArrowLeft,
  Braces,
  ExternalLink,
  FileText,
  MessageSquare,
  PencilLine,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  buildLocationForDocumentEditorViewMode,
  type DocumentEditorViewMode,
  formatWorkspacePathForDisplay,
  getDocumentEditorViewModeFromLocation,
  getPathLeaf,
  getRequestedPathState,
  joinPath,
  PREVIEW_PATH,
  ROUGHDRAFT_FLAVORED_MARKDOWN_PATH,
  syncRequestedPathInUrl,
} from "./app-navigation";
import { Button } from "./components/ui/button";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { detectBackend } from "./detect-backend";
import type { DocumentSaveState } from "./PageCard";
import { PreviewBackend } from "./preview-backend";
import {
  type CompleteReviewOptions,
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
} from "./storage";
import { UpdateNotice } from "./UpdateNotice";
import { fetchUpdateStatus, type UpdateStatus } from "./update-status";

export type DocumentDiskChangeState =
  | "clean"
  | "changed"
  | "conflict"
  | "paused";

export function shouldWarnBeforeUnload({
  activeDocumentPath,
  isDirty,
  saveState,
  diskChangeState,
}: {
  activeDocumentPath: string | null;
  isDirty: boolean;
  saveState: DocumentSaveState;
  diskChangeState: DocumentDiskChangeState;
}) {
  return (
    !!activeDocumentPath &&
    (isDirty ||
      saveState === "saving" ||
      saveState === "unsaved" ||
      saveState === "error" ||
      diskChangeState !== "clean")
  );
}

const PREVIEW_DOCUMENT_PATH = "preview.md";
const PREVIEW_INITIAL_MARKDOWN = [
  "# My practice note",
  "",
  "Try writing something here. This practice note is not saved to your computer. Choose Download a copy from the file actions if you would like to keep it.",
  "",
  "- Write a reminder or a question for your next conversation.",
  "- Select some words to add a comment or suggest a change.",
  "",
  "{==Select this sentence==}{>>Try replying to this comment or suggesting a replacement.<<}{#preview-comment}",
  "",
  "---",
  "comments:",
  "  preview-comment:",
  "    by: IQ Wealth",
  '    at: "2026-04-28T12:00:00.000Z"',
  "",
].join("\n");
const ROUGHDRAFT_MARKDOWN_SYNTAX = [
  {
    label: "Comment",
    syntax: "{==selected text==}{>>Comment text<<}{#c1}",
    description:
      "Highlights the reviewed text and attaches a margin comment to it.",
  },
  {
    label: "Reply",
    syntax:
      'comments:\n  c2:\n    body: I can make that edit.\n    by: AI\n    at: "2026-04-28T12:01:00.000Z"\n    re: c1',
    description:
      "Adds a threaded reply in YAML endmatter by pointing `re` at the parent id.",
  },
  {
    label: "Insertion",
    syntax: "{++new text++}{#s1}",
    description: "Suggests text to add without applying it silently.",
  },
  {
    label: "Deletion",
    syntax: "{--old text--}{#s2}",
    description: "Suggests removing text while keeping the original visible.",
  },
  {
    label: "Substitution",
    syntax: "{~~old text~>new text~~}{#s3}",
    description: "Suggests replacing one span with another.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_REFERENCES = [
  {
    title: "Official RFM spec",
    href: "/spec/roughdraft-flavored-markdown.md",
    description:
      "The normative syntax, metadata, round-trip, and JSON review-index contract for Roughdraft Flavored Markdown.",
  },
  {
    title: "CriticMarkup",
    href: "https://criticmarkup.com/",
    description:
      "The plain-text review syntax Roughdraft builds on for comments, highlights, insertions, deletions, and substitutions.",
  },
  {
    title: "Notion-flavored Markdown",
    href: "https://developers.notion.com/guides/data-apis/enhanced-markdown",
    description:
      "The product precedent for rich document affordances that still serialize to inspectable Markdown-like text.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_CONTRACT = [
  {
    title: "Metadata",
    description:
      "Compact inline references keep review anchors portable, while YAML endmatter stores authors, timestamps, statuses, and reply links.",
  },
  {
    title: "Anchors",
    description:
      "Comments attach to highlighted text when a highlight precedes the comment. A bare comment is allowed when the feedback applies to the surrounding paragraph or document.",
  },
  {
    title: "Pending changes",
    description:
      "Insertions, deletions, and substitutions stay visible until accepted or rejected. Roughdraft should not silently collapse suggested edits into normal prose.",
  },
  {
    title: "Round trips",
    description:
      "Normal Markdown should remain normal Markdown. Frontmatter, tables, task lists, links, image paths, code spans, and fenced code blocks should survive review edits with minimal serialization churn.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_EXTENSION_DETAILS = [
  {
    title: "YAML metadata",
    body: "Roughdraft stores ids inline as compact references such as {>>Looks right.<<}{#c1}, while authors, timestamps, and reply links live in final YAML endmatter.",
  },
  {
    title: "Threaded comments",
    body: "A comment can stand alone, attach to a highlighted span, or reply to another comment by setting `re` to the parent comment id.",
  },
  {
    title: "Reviewable suggestions",
    body: "Insertions, deletions, and substitutions can carry their own ids, then comments can reply to those ids to discuss a proposed edit before accepting it.",
  },
  {
    title: "Literal examples stay literal",
    body: "CriticMarkup inside inline code and fenced code blocks is preserved as example text instead of becoming live review feedback.",
  },
] as const;
export const QUICK_NOTES_HELP_URL =
  "https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/";

export function HomepageSubtitle() {
  return <>A quiet place to write, read and review your notes.</>;
}

export function Homepage({
  message,
  updateStatus,
  onRetry,
}: {
  message: ReactNode;
  updateStatus: UpdateStatus | null;
  onRetry?: () => void;
}) {
  return (
    <main
      className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-10 sm:py-16"
      data-testid="homepage"
    >
      <div className="mx-auto max-w-3xl">
        <p
          className="text-lg font-semibold text-primary"
          data-testid="homepage-logo"
        >
          IQ Wealth
        </p>
        <h1
          className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          data-testid="homepage-heading"
        >
          Quick Notes
        </h1>
        <p className="mt-5 text-xl leading-relaxed text-muted-foreground">
          <HomepageSubtitle />
        </p>
        {onRetry ? (
          <section
            role="alert"
            className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950"
          >
            <h2 className="text-xl font-semibold">
              We could not open your note
            </h2>
            <p className="mt-2 leading-relaxed">{message}</p>
            <p className="mt-2 leading-relaxed">
              Check that Quick Notes is running and the file has not been moved
              or renamed.
            </p>
            <Button
              data-testid="homepage-retry"
              className="mt-4"
              onClick={onRetry}
            >
              Try again
            </Button>
          </section>
        ) : null}
        <section
          className="mt-8 rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
          aria-labelledby="quick-notes-start"
        >
          <h2 id="quick-notes-start" className="text-2xl font-semibold">
            Start with a little practice
          </h2>
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
            Try writing a note, adding a comment or suggesting a change. This
            practice note is not saved to your computer. You can download a copy
            to keep it.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              nativeButton={false}
              role="link"
              className="h-auto min-h-11 whitespace-normal px-5 py-3 text-base"
              size="lg"
              render={<a href="/preview">Try Quick Notes</a>}
              data-testid="homepage-practice"
            />
            <Button
              nativeButton={false}
              role="link"
              className="h-auto min-h-11 whitespace-normal px-5 py-3 text-base"
              size="lg"
              variant="outline"
              data-testid="homepage-help"
              render={
                <a href={QUICK_NOTES_HELP_URL} target="_blank" rel="noreferrer">
                  Help and getting started
                </a>
              }
            />
          </div>
        </section>
        <section className="mt-9" aria-labelledby="quick-notes-own-notes">
          <h2 id="quick-notes-own-notes" className="text-2xl font-semibold">
            Working with your own notes
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-lg leading-relaxed text-muted-foreground">
            <li>
              On Windows, use your IQ Wealth Quick Notes shortcut to open the
              app.
            </li>
            <li>
              Open a Markdown (.md) note with Quick Notes, or use the new-note
              shortcut supplied with your installation.
            </li>
            <li>
              Your changes are saved to that one file. If a save fails, keep the
              window open and choose{" "}
              <strong className="font-semibold text-foreground">
                Download a copy
              </strong>{" "}
              from the note’s file actions.
            </li>
          </ol>
          <p className="mt-5 leading-relaxed text-muted-foreground">
            Your note stays a normal file on your computer. Quick Notes does not
            create a separate note library.
          </p>
        </section>
        {updateStatus ? (
          <div className="mt-8">
            <UpdateNotice updateStatus={updateStatus} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function RoughdraftFlavoredMarkdownPage() {
  return (
    <main className="min-h-screen bg-[#FCFCFC] dark:bg-background px-6 py-8 text-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-5xl">
        <Button
          className="h-9 gap-2 px-3 text-sm"
          nativeButton={false}
          variant="ghost"
          render={
            <a href="/">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to Quick Notes
            </a>
          }
        />

        <section className="mt-12 max-w-3xl">
          <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
            Roughdraft flavored Markdown
          </p>
          <h1 className="mt-3 text-4xl leading-tight font-semibold text-balance text-slate-950 dark:text-slate-50 sm:text-5xl">
            Markdown with review comments and suggested changes
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600 dark:text-stone-400">
            Roughdraft Flavored Markdown is regular Markdown plus portable
            review markup. It builds on{" "}
            <a
              className="font-medium text-slate-950 dark:text-slate-50 underline decoration-slate-300 dark:decoration-slate-600 underline-offset-4 hover:decoration-slate-950 dark:hover:decoration-slate-50"
              href="https://criticmarkup.com/"
              target="_blank"
              rel="noreferrer"
            >
              CriticMarkup
            </a>{" "}
            syntax and the text-first model behind{" "}
            <a
              className="font-medium text-slate-950 dark:text-slate-50 underline decoration-slate-300 dark:decoration-slate-600 underline-offset-4 hover:decoration-slate-950 dark:hover:decoration-slate-50"
              href="https://developers.notion.com/guides/data-apis/enhanced-markdown"
              target="_blank"
              rel="noreferrer"
            >
              Notion-flavored Markdown
            </a>
            {", "}
            so a person and a coding agent can review the same file without a
            sidecar database or hosted document format.
          </p>
        </section>

        <section className="mt-10 grid gap-3 md:grid-cols-2">
          {ROUGHDRAFT_MARKDOWN_REFERENCES.map(
            ({ description, href, title }) => (
              <a
                className="group rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)] transition hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:hover:shadow-[0_14px_34px_rgba(0,0,0,0.4)]"
                href={href}
                key={title}
                target="_blank"
                rel="noreferrer"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                    {title}
                  </h2>
                  <ExternalLink
                    className="size-4 text-stone-400 dark:text-stone-500 transition group-hover:text-stone-700 dark:group-hover:text-stone-300"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {description}
                </p>
              </a>
            ),
          )}
        </section>

        <section className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Plain text first",
              description:
                "The saved file remains readable in editors, terminals, git diffs, and agent context windows.",
              icon: FileText,
            },
            {
              title: "Threaded review",
              description:
                "Comments carry document-local ids, authors, timestamps, and reply links for back-and-forth discussion.",
              icon: MessageSquare,
            },
            {
              title: "Explicit edits",
              description:
                "Suggestions are represented as insertions, deletions, and substitutions until someone accepts them.",
              icon: PencilLine,
            },
          ].map(({ description, icon: Icon, title }) => (
            <div
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
              key={title}
            >
              <div className="flex size-10 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-stone-700 dark:text-stone-300">
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-950 dark:text-slate-50">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                {description}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-14 grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Format contract
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              Review data lives where agents can inspect it
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Roughdraft treats the Markdown file as the durable source of
              truth. The rich editor can add affordances around the text, but
              the saved representation needs to be readable in a terminal,
              reviewable in git, and understandable to another agent without
              loading Roughdraft.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {ROUGHDRAFT_MARKDOWN_CONTRACT.map(({ description, title }) => (
              <div
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                key={title}
              >
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Syntax
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              The review layer is small on purpose
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Roughdraft uses CriticMarkup-compatible markers for comments,
              highlights, insertions, deletions, and substitutions. Roughdraft
              extends those markers with document-local metadata so review
              threads, authorship, timestamps, and suggested-change discussions
              can survive in the Markdown file itself.
            </p>
          </div>

          <div className="grid gap-3">
            {ROUGHDRAFT_MARKDOWN_SYNTAX.map(
              ({ description, label, syntax }) => (
                <div
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                  key={label}
                >
                  <div className="flex items-center gap-2">
                    <Braces
                      className="size-4 text-stone-500 dark:text-stone-400"
                      aria-hidden="true"
                    />
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                      {label}
                    </h3>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                    {description}
                  </p>
                  <code className="mt-3 block overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700 bg-[#FAFAF8] dark:bg-slate-800 px-3 py-2 text-xs text-stone-700 dark:text-stone-300">
                    {syntax}
                  </code>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="mt-14 grid gap-8 border-t border-slate-200 dark:border-slate-700 pt-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Roughdraft extensions
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              The extra fields make review state portable
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Standard CriticMarkup captures the visible annotation. Roughdraft
              keeps the same readable markers, adds compact inline references,
              and stores review metadata in final YAML endmatter.
            </p>
          </div>

          <div className="grid gap-3">
            {ROUGHDRAFT_MARKDOWN_EXTENSION_DETAILS.map(({ body, title }) => (
              <div
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                key={title}
              >
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 max-w-3xl border-t border-slate-200 dark:border-slate-700 pt-10">
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">
            What this is not
          </h2>
          <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
            It is not a new replacement for Markdown, and it is not a hidden app
            state format. If Roughdraft adds review information, that
            information should stay visible, portable, and understandable in the
            Markdown file itself.
          </p>
        </section>
      </div>
    </main>
  );
}

function createPreviewPage(): Page {
  return {
    id: "preview",
    title: "My practice note",
    content: PREVIEW_INITIAL_MARKDOWN,
    version: "memory:initial",
  };
}

export function PreviewPage() {
  const [backend] = useState(() => new PreviewBackend(createPreviewPage()));
  const [previewPage, setPreviewPage] = useState<Page>(() =>
    backend.getCurrentPage(),
  );
  const [previewForceResetKey, setPreviewForceResetKey] = useState<
    string | null
  >(null);
  const [editorViewMode, setEditorViewMode] = useState<DocumentEditorViewMode>(
    () => getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const [, setSaveState] = useState<DocumentSaveState>("saved");

  useEffect(() => () => backend.dispose(), [backend]);

  useEffect(() => {
    document.title = "Practice — IQ Wealth Quick Notes";
  }, []);

  const handleSaveDocument = useCallback(
    async (_id: string, content: string) => {
      const savedPage = await backend.saveMarkdownFile(
        PREVIEW_DOCUMENT_PATH,
        content,
      );
      setPreviewPage(savedPage);
    },
    [backend],
  );

  const handleResetPreview = useCallback(async () => {
    const freshBackendPage = createPreviewPage();
    const savedPage = await backend.saveMarkdownFile(
      PREVIEW_DOCUMENT_PATH,
      freshBackendPage.content,
    );
    setPreviewPage(savedPage);
    setPreviewForceResetKey(`preview-reset:${Date.now()}`);
  }, [backend]);

  const handleCompletePreviewReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      return backend.completeReview
        ? backend.completeReview(PREVIEW_DOCUMENT_PATH, options)
        : { delivered: false };
    },
    [backend],
  );

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      <div
        role="status"
        data-testid="practice-banner"
        className="shrink-0 border-b border-amber-300 bg-amber-50 px-5 py-3 text-base leading-relaxed text-amber-950"
      >
        <strong>Practice note — not saved to your computer.</strong> Keep a copy
        using the note’s file actions before closing this window.{" "}
        <a className="underline underline-offset-2" href="/">
          Back to Quick Notes
        </a>
      </div>
      <DocumentWorkspace
        isPractice
        documentPage={previewPage}
        activeDocumentPath={PREVIEW_DOCUMENT_PATH}
        documentFilenameLabel={PREVIEW_DOCUMENT_PATH}
        documentEditorViewMode={editorViewMode}
        onDocumentEditorViewModeChange={(mode) => {
          setEditorViewMode(mode);
          window.history.replaceState(
            null,
            "",
            buildLocationForDocumentEditorViewMode(mode),
          );
        }}
        onSaveDocument={handleSaveDocument}
        onDocumentSaveStateChange={setSaveState}
        onDocumentDirtyStateChange={() => {}}
        onDocumentLocalContentChange={() => {}}
        documentDiskChangeState="clean"
        documentForceResetKey={previewForceResetKey}
        onReloadDocumentFromDisk={handleResetPreview}
        onKeepEditingWithoutAutosave={() => {}}
        onOverwriteDocumentOnDisk={() => {}}
        onCompleteReview={handleCompletePreviewReview}
        backend={backend}
      />
    </main>
  );
}

export function App() {
  const initialRequestedPathState = getRequestedPathState();
  const [requestedPathState] = useState(initialRequestedPathState);
  const isRoughdraftFlavoredMarkdownRoute =
    window.location.pathname === ROUGHDRAFT_FLAVORED_MARKDOWN_PATH;
  const isPreviewRoute = window.location.pathname === PREVIEW_PATH;
  const isRemoteSession = !!new URLSearchParams(window.location.search)
    .get("session")
    ?.trim();
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [documentPage, setDocumentPage] = useState<Page | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    initialRequestedPathState.documentPath,
  );
  const [documentSaveState, setDocumentSaveState] =
    useState<DocumentSaveState>("saved");
  const [documentDiskChangeState, setDocumentDiskChangeState] =
    useState<DocumentDiskChangeState>("clean");
  const [documentForceResetKey, setDocumentForceResetKey] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [documentEditorViewMode, setDocumentEditorViewMode] = useState(() =>
    getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const backendRef = useRef<StorageBackend | null>(null);
  const documentPageRef = useRef<Page | null>(null);
  const activeDocumentPathRef = useRef<string | null>(activeDocumentPath);
  const documentDirtyRef = useRef(false);
  const documentSaveStateRef = useRef<DocumentSaveState>("saved");
  const documentDraftContentRef = useRef<string | null>(null);

  backendRef.current = backend;
  documentPageRef.current = documentPage;
  activeDocumentPathRef.current = activeDocumentPath;
  documentSaveStateRef.current = documentSaveState;

  const applyDocumentPage = useCallback((nextDocument: Page) => {
    setDocumentPage(nextDocument);
    documentDraftContentRef.current = nextDocument.content;
  }, []);

  const loadDocument = useCallback(
    async (nextBackend: StorageBackend, relativePath: string) => {
      const nextDocument = await nextBackend.getMarkdownFile(relativePath);
      applyDocumentPage(nextDocument);
      setActiveDocumentPath(relativePath);
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");
      return nextDocument;
    },
    [applyDocumentPage],
  );

  useEffect(() => {
    if (isRemoteSession || isPreviewRoute) return;
    let cancelled = false;

    const loadUpdateStatus = async () => {
      const nextUpdateStatus = await fetchUpdateStatus();
      if (!cancelled) {
        setUpdateStatus(nextUpdateStatus);
      }
    };

    void loadUpdateStatus();

    return () => {
      cancelled = true;
    };
  }, [isRemoteSession, isPreviewRoute]);

  useEffect(() => {
    if (isRemoteSession || isPreviewRoute) return;
    const sourceUrl = new URL("/api/open-requests", window.location.origin);
    if (requestedPathState.rawPath) {
      sourceUrl.searchParams.set("path", requestedPathState.rawPath);
    }

    const source = new EventSource(`${sourceUrl.pathname}${sourceUrl.search}`);
    const handleOpenRequest = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          url?: unknown;
        };
        if (typeof payload.url !== "string" || !payload.url.trim()) return;

        const nextUrl = new URL(payload.url, window.location.origin);
        window.focus();
        if (nextUrl.href !== window.location.href) {
          window.location.assign(nextUrl.href);
        }
      } catch (error) {
        console.error("Failed to handle Roughdraft open request:", error);
      }
    };

    source.addEventListener("open-request", handleOpenRequest);

    return () => {
      source.removeEventListener("open-request", handleOpenRequest);
      source.close();
    };
  }, [requestedPathState.rawPath, isRemoteSession, isPreviewRoute]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a retry deliberately repeats the same read operation.
  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      if (isPreviewRoute || isRoughdraftFlavoredMarkdownRoute) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      setDocumentPage(null);

      try {
        const detectedBackend = await detectBackend();
        if (cancelled) return;

        setBackend(detectedBackend);

        if (detectedBackend.info.kind === "remote") {
          const documentPath = detectedBackend.info.detail || "remote.md";
          await loadDocument(detectedBackend, documentPath);
          if (cancelled) return;
          setLoading(false);
          return;
        }

        if (!requestedPathState.rawPath) {
          setActiveDocumentPath(null);
          setLoading(false);
          return;
        }

        syncRequestedPathInUrl(requestedPathState.rawPath);

        if (
          !requestedPathState.projectPath ||
          !requestedPathState.documentPath
        ) {
          setActiveDocumentPath(null);
          setLoadError(
            "Choose a Markdown (.md) file. Quick Notes opens one note at a time.",
          );
          setLoading(false);
          return;
        }

        if (detectedBackend.canManageProjects) {
          await detectedBackend.openProject(requestedPathState.projectPath);
        }

        if (cancelled) return;

        await loadDocument(detectedBackend, requestedPathState.documentPath);
        if (cancelled) return;

        setLoading(false);
      } catch (error) {
        if (cancelled) return;

        console.error("Failed to open markdown file:", error);
        setActiveDocumentPath(null);
        setLoadError(
          isRemoteSession
            ? "The remote note could not be opened. Your note has not been changed."
            : "The note could not be read. Your file has not been changed.",
        );
        setLoading(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [
    loadAttempt,
    isPreviewRoute,
    isRoughdraftFlavoredMarkdownRoute,
    loadDocument,
    requestedPathState.documentPath,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

  useEffect(() => {
    const workspaceTitlePath = activeDocumentPath
      ? formatWorkspacePathForDisplay(
          backend?.info.projectPath
            ? joinPath(backend.info.projectPath, activeDocumentPath)
            : requestedPathState.rawPath,
        )
      : null;

    document.title = isPreviewRoute
      ? "Practice — IQ Wealth Quick Notes"
      : isRoughdraftFlavoredMarkdownRoute
        ? "Markdown format — IQ Wealth Quick Notes"
        : workspaceTitlePath
          ? `${workspaceTitlePath} — IQ Wealth Quick Notes`
          : "IQ Wealth Quick Notes";
  }, [
    activeDocumentPath,
    backend,
    isRoughdraftFlavoredMarkdownRoute,
    isPreviewRoute,
    requestedPathState.rawPath,
  ]);

  const handleSaveDocument = useCallback(
    async (id: string, content: string) => {
      if (!activeDocumentPath) return;
      const expectedVersion =
        documentPageRef.current?.id === id
          ? documentPageRef.current.version
          : undefined;

      let savedDocument: Page | undefined;
      try {
        savedDocument = await backendRef.current?.saveMarkdownFile(
          activeDocumentPath,
          content,
          expectedVersion,
        );
      } catch (error) {
        if (error instanceof MarkdownFileConflictError) {
          setDocumentDiskChangeState("conflict");
        }
        throw error;
      }

      const firstLine = content.split("\n")[0] || "";
      const fallbackTitle = id.split("/").at(-1) || id;
      const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;
      const nextDocument = savedDocument ?? {
        id,
        content,
        title,
        version: expectedVersion,
      };

      applyDocumentPage(nextDocument);
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");
    },
    [activeDocumentPath, applyDocumentPage],
  );

  const handleDocumentDirtyStateChange = useCallback((isDirty: boolean) => {
    documentDirtyRef.current = isDirty;
  }, []);

  const handleDocumentSaveStateChange = useCallback(
    (state: DocumentSaveState) => {
      documentSaveStateRef.current = state;
      setDocumentSaveState(state);
    },
    [],
  );

  const handleDocumentLocalContentChange = useCallback((markdown: string) => {
    documentDraftContentRef.current = markdown;
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !shouldWarnBeforeUnload({
          activeDocumentPath: activeDocumentPathRef.current,
          isDirty: documentDirtyRef.current,
          saveState: documentSaveStateRef.current,
          diskChangeState: documentDiskChangeState,
        })
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [documentDiskChangeState]);

  const handleReloadDocumentFromDisk = useCallback(async () => {
    const currentBackend = backendRef.current;
    const currentPath = activeDocumentPathRef.current;
    if (!currentBackend || !currentPath) return;

    const nextDocument = await currentBackend.getMarkdownFile(currentPath);
    applyDocumentPage(nextDocument);
    documentDirtyRef.current = false;
    setDocumentDiskChangeState("clean");
    setDocumentForceResetKey(
      `${currentPath}:${nextDocument.version ?? Date.now()}`,
    );
  }, [applyDocumentPage]);

  const handleKeepEditingWithoutAutosave = useCallback(() => {
    setDocumentDiskChangeState("paused");
  }, []);

  const handleOverwriteDocumentOnDisk = useCallback(async () => {
    const currentBackend = backendRef.current;
    const currentPath = activeDocumentPathRef.current;
    const currentDocument = documentPageRef.current;
    if (!currentBackend || !currentPath || !currentDocument) return;

    const content = documentDraftContentRef.current ?? currentDocument.content;
    const firstLine = content.split("\n")[0] || "";
    const fallbackTitle =
      currentDocument.id.split("/").at(-1) || currentDocument.id;
    const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;
    const savedDocument = (await currentBackend.saveMarkdownFile(
      currentPath,
      content,
    )) ?? {
      ...currentDocument,
      content,
      title,
    };

    applyDocumentPage(savedDocument);
    documentDirtyRef.current = false;
    handleDocumentSaveStateChange("saved");
    setDocumentDiskChangeState("clean");
    setDocumentForceResetKey(
      `${currentPath}:${savedDocument.version ?? Date.now()}:overwrite`,
    );
  }, [applyDocumentPage, handleDocumentSaveStateChange]);

  const handleCompleteReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      const currentBackend = backendRef.current;
      const currentPath = activeDocumentPathRef.current;
      const currentDocument = documentPageRef.current;
      if (!currentBackend || !currentPath || !currentDocument) {
        return { delivered: false };
      }

      const content =
        documentDraftContentRef.current ?? currentDocument.content;
      const expectedVersion = currentDocument.version;
      const firstLine = content.split("\n")[0] || "";
      const fallbackTitle =
        currentDocument.id.split("/").at(-1) || currentDocument.id;
      const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;

      const savedDocument = (await currentBackend.saveMarkdownFile(
        currentPath,
        content,
        expectedVersion,
      )) ?? {
        ...currentDocument,
        content,
        title,
      };

      applyDocumentPage(savedDocument);
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");

      return currentBackend.completeReview
        ? currentBackend.completeReview(currentPath, options)
        : { delivered: false };
    },
    [applyDocumentPage],
  );

  useEffect(() => {
    if (!backend?.watchMarkdownFile || !activeDocumentPath) return;

    let disposed = false;
    const stopWatching = backend.watchMarkdownFile(
      activeDocumentPath,
      (event) => {
        if (disposed || event.path !== activeDocumentPath) return;

        const currentDocument = documentPageRef.current;
        if (event.version && currentDocument?.version === event.version) {
          return;
        }

        if (!event.exists) {
          setDocumentDiskChangeState("changed");
          return;
        }

        if (documentDiskChangeState === "paused") {
          return;
        }

        if (documentDirtyRef.current) {
          setDocumentDiskChangeState("changed");
          return;
        }

        void (async () => {
          const currentBackend = backendRef.current;
          const currentPath = activeDocumentPathRef.current;
          if (!currentBackend || !currentPath || disposed) return;

          try {
            const nextDocument =
              await currentBackend.getMarkdownFile(currentPath);
            if (disposed) return;
            applyDocumentPage(nextDocument);
            setDocumentDiskChangeState("clean");
          } catch (error) {
            console.error("Failed to reload changed markdown file:", error);
          }
        })();
      },
    );

    return () => {
      disposed = true;
      stopWatching();
    };
  }, [activeDocumentPath, applyDocumentPage, backend, documentDiskChangeState]);

  const handleDocumentEditorViewModeChange = useCallback(
    (nextMode: DocumentEditorViewMode) => {
      setDocumentEditorViewMode((current) => {
        if (nextMode === current) return current;
        window.history.replaceState(
          null,
          "",
          buildLocationForDocumentEditorViewMode(nextMode),
        );
        return nextMode;
      });
    },
    [],
  );

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
        <p className="text-xl font-semibold">IQ Wealth Quick Notes</p>
        <p
          data-testid="app-loading-status"
          role="status"
          className="text-lg text-muted-foreground"
        >
          Opening Quick Notes…
        </p>
        <a
          href={QUICK_NOTES_HELP_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          Help if this takes longer than expected
        </a>
      </main>
    );
  }

  if (isRoughdraftFlavoredMarkdownRoute) {
    return <RoughdraftFlavoredMarkdownPage />;
  }

  if (isPreviewRoute) {
    return <PreviewPage />;
  }

  if (isRemoteSession && loadError) {
    return (
      <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-10 sm:py-16">
        <section
          role="alert"
          data-testid="remote-session-error"
          className="mx-auto max-w-xl rounded-xl border p-6"
        >
          <h1 className="text-2xl font-semibold">
            We could not open your remote note
          </h1>
          <p className="mt-4 leading-relaxed">{loadError}</p>
          <p className="mt-2 leading-relaxed">
            Check your connection and that the shared session is still open. If
            this continues, ask IQ Wealth to open a new review session.
          </p>
          <Button
            className="mt-4"
            data-testid="remote-session-retry"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            Try again
          </Button>
        </section>
      </main>
    );
  }

  if ((!requestedPathState.rawPath && !isRemoteSession) || loadError) {
    return (
      <Homepage
        message={loadError ?? <HomepageSubtitle />}
        updateStatus={updateStatus}
        onRetry={
          loadError ? () => setLoadAttempt((attempt) => attempt + 1) : undefined
        }
      />
    );
  }

  const documentAbsolutePath =
    activeDocumentPath && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, activeDocumentPath)
      : requestedPathState.rawPath;
  const documentFilenameLabel =
    getPathLeaf(documentAbsolutePath ?? activeDocumentPath) ?? "Untitled.md";

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      {updateStatus ? (
        <div className="pointer-events-none absolute top-4 right-4 z-40 max-w-sm">
          <div className="pointer-events-auto">
            <UpdateNotice updateStatus={updateStatus} />
          </div>
        </div>
      ) : null}
      <DocumentWorkspace
        documentPage={documentPage}
        activeDocumentPath={activeDocumentPath}
        documentFilenameLabel={documentFilenameLabel}
        documentEditorViewMode={documentEditorViewMode}
        onDocumentEditorViewModeChange={handleDocumentEditorViewModeChange}
        onSaveDocument={handleSaveDocument}
        onDocumentSaveStateChange={handleDocumentSaveStateChange}
        onDocumentDirtyStateChange={handleDocumentDirtyStateChange}
        onDocumentLocalContentChange={handleDocumentLocalContentChange}
        documentDiskChangeState={documentDiskChangeState}
        documentForceResetKey={documentForceResetKey}
        onReloadDocumentFromDisk={handleReloadDocumentFromDisk}
        onKeepEditingWithoutAutosave={handleKeepEditingWithoutAutosave}
        onOverwriteDocumentOnDisk={handleOverwriteDocumentOnDisk}
        onCompleteReview={handleCompleteReview}
        backend={backend}
      />
    </main>
  );
}
