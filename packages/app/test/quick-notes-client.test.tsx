import { appendFileSync } from "node:fs";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Homepage, HomepageSubtitle, PreviewPage } from "../src/App";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { DocumentWorkspace } from "../src/DocumentWorkspace";
import { PreviewBackend } from "../src/preview-backend";

const { detectBackend, fetchUpdateStatus } = vi.hoisted(() => ({
  detectBackend: vi.fn(),
  fetchUpdateStatus: vi.fn(),
}));
vi.mock("../src/detect-backend", () => ({ detectBackend }));
vi.mock("../src/update-status", () => ({ fetchUpdateStatus }));

function logEvidence(event: string, data: Record<string, unknown>) {
  const file = process.env.THOUGHTFUL_SLOG_FILE;
  if (file)
    appendFileSync(
      file,
      `${JSON.stringify({ ts: new Date().toISOString(), source: "quick-notes-client.test.tsx", event, data })}\n`,
    );
}

async function click(element: Element | null | undefined) {
  expect(element, "The requested action must be available").toBeTruthy();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function action(label: string) {
  const ids: Record<string, string> = {
    "Try again": "homepage-retry",
    "Document file actions": "document-file-menu-trigger",
    "Copy markdown": "document-file-menu-markdown",
    "Download a copy": "document-file-menu-download",
    "Reading text size": "document-reading-size",
  };
  return document.querySelector(`[data-testid="${ids[label]}"]`);
}

describe("Quick Notes client clarity and draft recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  const page = { id: "note", title: "My note", content: "Saved version" };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", "/");
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    detectBackend.mockReset().mockResolvedValue(new PreviewBackend(page));
    fetchUpdateStatus.mockReset().mockResolvedValue(null);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const rect = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 640,
      height: 480,
      right: 640,
      bottom: 480,
      toJSON() {},
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rect,
    );
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => rect,
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [rect],
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(element: React.ReactNode) {
    await act(async () =>
      root.render(<TooltipProvider>{element}</TooltipProvider>),
    );
  }

  async function renderWorkspace({
    paused = true,
    onSave = vi.fn().mockResolvedValue(undefined),
    savedContent = page.content,
  } = {}) {
    await render(
      <DocumentWorkspace
        documentPage={{ ...page, content: savedContent }}
        activeDocumentPath="note.md"
        documentFilenameLabel="note.md"
        documentEditorViewMode="code"
        onDocumentEditorViewModeChange={() => {}}
        onSaveDocument={onSave}
        onDocumentSaveStateChange={() => {}}
        onDocumentDirtyStateChange={() => {}}
        onDocumentLocalContentChange={() => {}}
        documentDiskChangeState={paused ? "paused" : "clean"}
        documentForceResetKey={null}
        onReloadDocumentFromDisk={() => {}}
        onKeepEditingWithoutAutosave={() => {}}
        onOverwriteDocumentOnDisk={() => {}}
        onCompleteReview={async () => ({ delivered: false })}
        backend={new PreviewBackend(page)}
      />,
    );
    return onSave;
  }

  async function editDraft() {
    const element = container.querySelector(".cm-editor");
    expect(element).toBeTruthy();
    const view = EditorView.findFromDOM(element as HTMLElement);
    expect(view).toBeTruthy();
    await act(async () =>
      view?.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "Latest unsaved draft",
        },
      }),
    );
  }

  it("offers a trial and canonical help when no note is open", async () => {
    await render(
      <Homepage message={<HomepageSubtitle />} updateStatus={null} />,
    );
    expect(container.querySelector('a[href="/preview"]')).toBeTruthy();
    expect(
      container.querySelector(
        'a[href="https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/"]',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain(
      "Give this to your coding agent",
    );
  });

  it("announces progress while opening a note", async () => {
    detectBackend.mockReturnValue(new Promise(() => {}));
    await render(<App />);
    logEvidence("loading-render", {
      text: container.textContent,
      statusCount: container.querySelectorAll(
        '[data-testid="app-loading-status"]',
      ).length,
    });
    expect(
      container.querySelector('[data-testid="app-loading-status"]')
        ?.textContent ?? "",
    ).toMatch(/opening|loading/i);
  });

  it("offers a retry after opening a note fails", async () => {
    window.history.replaceState({}, "", "/?path=C%3A%2FNotes%2Fmissing.md");
    detectBackend.mockRejectedValueOnce(new Error("Local service unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render(<App />);
    await click(action("Try again"));
    expect(detectBackend).toHaveBeenCalledTimes(2);
  });

  it("identifies the trial as not saved even after its sample text is replaced", async () => {
    window.history.replaceState({}, "", "/preview?editor=code");
    await render(<PreviewPage />);
    await editDraft();
    logEvidence("preview-render", {
      title: document.title,
      statuses: [
        ...container.querySelectorAll(
          '[data-testid="practice-banner"], [data-testid="practice-save-status"]',
        ),
      ].map((node) => node.getAttribute("aria-label") ?? node.textContent),
    });
    expect(
      container.querySelector('[data-testid="document-save-status"]'),
    ).toBeNull();
    expect(container.textContent).toMatch(/not saved to (your computer|disk)/i);
  });

  it("copies the latest draft while autosave is paused", async () => {
    const onSave = await renderWorkspace();
    await editDraft();
    await click(action("Document file actions"));
    await click(action("Copy markdown"));
    logEvidence("paused-copy", {
      copied: vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0],
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "Latest unsaved draft",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows a useful error when the browser refuses to copy", async () => {
    await renderWorkspace();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
      new Error("Clipboard blocked"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    await click(action("Document file actions"));
    await click(action("Copy markdown"));
    expect(
      document.querySelector('[data-testid="document-file-action-error"]')
        ?.textContent ?? "",
    ).toMatch(/copy/i);
    expect(document.body.textContent).toMatch(/download a copy/i);
  });

  it("copies the current draft after an actual save failure", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Disk unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderWorkspace({ paused: false, onSave });
    await editDraft();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      container
        .querySelector('[data-testid="document-save-status"]')
        ?.getAttribute("aria-label"),
    ).toBe("Save failed");
    await click(action("Document file actions"));
    await click(action("Copy markdown"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "Latest unsaved draft",
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not replace the recovery draft with an older saved snapshot", async () => {
    await renderWorkspace();
    await editDraft();
    await renderWorkspace({ savedContent: "Earlier saved snapshot" });
    await click(action("Document file actions"));
    await click(action("Copy markdown"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "Latest unsaved draft",
    );
  });

  it("does not open local control channels for a remote session viewer", async () => {
    window.history.replaceState(
      {},
      "",
      "/?session=shared-note&token=test-token",
    );
    const sources: string[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string) {
          sources.push(url);
        }
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
    await render(<App />);
    expect(sources).toEqual([]);
    expect(fetchUpdateStatus).not.toHaveBeenCalled();
  });

  it("downloads the current draft without overwriting the original note", async () => {
    const onSave = await renderWorkspace();
    const blobs: Blob[] = [];
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn((blob: Blob) => {
          blobs.push(blob);
          return "blob:draft-copy";
        });
        static revokeObjectURL = vi.fn();
      },
    );
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function () {
        downloadName = this.download;
      },
    );
    await editDraft();
    await click(action("Document file actions"));
    await click(action("Download a copy"));
    expect(blobs).toHaveLength(1);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blobs[0]);
    });
    expect(text).toBe("Latest unsaved draft");
    expect(downloadName).toMatch(/\.md$/);
    expect(onSave).not.toHaveBeenCalled();
    expect(
      container
        .querySelector('[data-testid="document-save-status"]')
        ?.getAttribute("aria-label"),
    ).toBe("Autosave paused");
  });

  it("keeps a larger reading size after reopening without changing the note", async () => {
    const onSave = await renderWorkspace();
    await click(action("Reading text size"));
    const largest = document.querySelector(
      '[data-testid="document-reading-size-largest"]',
    );
    expect(largest).toBeTruthy();
    await act(async () => {
      largest?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      largest?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 }),
      );
    });
    expect(localStorage.getItem("iq-quick-notes-reading-size")).toBe("largest");
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderWorkspace();
    const editor = container.querySelector(".cm-editor");
    expect(editor?.textContent).toContain("Saved version");
    expect(
      (
        container.querySelector(
          '[data-testid="document-workspace"]',
        ) as HTMLElement
      ).style.getPropertyValue("--reading-text-size"),
    ).toBe("24px");
  });
});
