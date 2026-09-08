import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewPage, RoughdraftFlavoredMarkdownPage } from "../src/App";

describe("Supporting pages", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("renders the Roughdraft flavored Markdown spec page", async () => {
    await act(async () => {
      root.render(<RoughdraftFlavoredMarkdownPage />);
    });

    expect(container.textContent).toContain(
      "Markdown with review comments and suggested changes",
    );
    expect(container.textContent).toContain(
      "regular Markdown plus portable review markup",
    );
    expect(container.textContent).toContain("CriticMarkup");
    expect(container.textContent).toContain("Notion-flavored Markdown");
    expect(container.textContent).toContain("Official RFM spec");
    expect(container.textContent).toContain("Format contract");
    expect(container.textContent).toContain(
      "Review data lives where agents can inspect it",
    );
    expect(container.textContent).toContain("document-local");
    expect(
      container.querySelector('a[href="/spec/roughdraft-flavored-markdown.md"]')
        ?.textContent,
    ).toContain("Official RFM spec");
    expect(
      container.querySelector('a[href="https://criticmarkup.com/"]')
        ?.textContent,
    ).toContain("CriticMarkup");
    expect(
      container.querySelector(
        'a[href="https://developers.notion.com/guides/data-apis/enhanced-markdown"]',
      )?.textContent,
    ).toContain("Notion-flavored Markdown");
    expect(container.textContent).toContain("Threaded review");
    expect(container.textContent).toContain("Roughdraft extensions");
    expect(container.textContent).toContain("YAML metadata");
    expect(container.textContent).toContain("Substitution");
    expect(container.textContent).toContain("{~~old text~>new text~~}");
    expect(container.querySelector('a[href="/"]')?.textContent).toContain(
      "Back to Quick Notes",
    );
  });

  it("renders an in-memory live preview page", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewPage />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("preview.md");
    expect(container.textContent).toContain("My practice note");
    expect(container.textContent).toContain("not saved to your computer");
    expect(container.textContent).toContain("Select this sentence");
    expect(container.textContent).not.toContain("I'm done");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
    expect(setItem).not.toHaveBeenCalled();
  });
});
