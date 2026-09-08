import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewBackend } from "./preview-backend";

describe("practice attachment safety", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "text/html",
    "image/svg+xml",
    "application/xhtml+xml",
    "application/xml",
    "",
    "application/octet-stream",
  ])("rejects %s without changing the practice note", async (type) => {
    const note = {
      id: "practice",
      title: "My practice note",
      content: "Keep this draft",
    };
    const backend = new PreviewBackend(note);
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => "blob:test";
      },
    );
    await expect(
      backend.saveAsset(
        new File(["<script>example</script>"], "example.svg", { type }),
      ),
    ).rejects.toThrow(/not added/i);
    expect(await backend.getMarkdownFile("practice.md")).toEqual(note);
    expect(
      backend.resolveFileUrl("./.roughdraft-preview-assets/example.svg"),
    ).toBeNull();
  });

  it.each([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
    "application/pdf",
  ])("retains %s attachments", async (type) => {
    const backend = new PreviewBackend({
      id: "practice",
      title: "Practice",
      content: "Keep this draft",
    });
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => "blob:safe-attachment";
      },
    );
    const asset = await backend.saveAsset(
      new File(["fixture"], "example", { type }),
    );
    expect(asset.mimeType).toBe(type);
    expect(backend.resolveFileUrl(asset.markdownPath)).toBe(
      "blob:safe-attachment",
    );
  });
});
