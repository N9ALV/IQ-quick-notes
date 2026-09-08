import type { BackendInfo, Page, StorageBackend, StoredAsset } from "./storage";

const SAFE_PRACTICE_ASSET_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "application/pdf",
]);

function titleFromContent(content: string, fallback: string) {
  const firstLine = content.split("\n")[0] || "";
  return firstLine.replace(/^#*\s*/, "").trim() || fallback;
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function nextAssetPath(assets: Map<string, string>, filename: string): string {
  const safeName = sanitizeFilename(filename);
  const dotIndex = safeName.lastIndexOf(".");
  const basename = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  let counter = 0;

  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const path = `./.roughdraft-preview-assets/${basename}${suffix}${extension}`;
    if (!assets.has(path)) return path;
    counter += 1;
  }
}

export class PreviewBackend implements StorageBackend {
  info: BackendInfo = {
    kind: "local-storage",
    label: "Live preview",
    detail: "In memory only",
  };
  canManageProjects = false;

  private page: Page;
  private assets = new Map<string, string>();

  constructor(page: Page) {
    this.page = page;
  }

  getCurrentPage(): Page {
    return this.page;
  }

  async getMarkdownFile(_relativePath: string): Promise<Page> {
    return this.page;
  }

  async saveMarkdownFile(
    _relativePath: string,
    content: string,
  ): Promise<Page> {
    this.page = {
      ...this.page,
      title: titleFromContent(content, this.page.id),
      content,
      version: `memory:${Date.now()}`,
    };

    return this.page;
  }

  async completeReview(
    _relativePath: string,
    _options?: { overallComment?: string },
  ): Promise<{ delivered: boolean }> {
    return { delivered: false };
  }

  async saveAsset(file: File): Promise<StoredAsset> {
    // Object URLs inherit this app's origin. Active documents (including SVG)
    // must not become executable app-origin pages when opened separately.
    if (!SAFE_PRACTICE_ASSET_TYPES.has(file.type)) {
      throw new Error(
        "This attachment was not added. Practice notes accept PNG, JPEG, GIF, WebP, AVIF or BMP images, and PDF files.",
      );
    }
    const markdownPath = nextAssetPath(this.assets, file.name);
    const previewUrl = URL.createObjectURL(file);
    this.assets.set(markdownPath, previewUrl);

    return {
      markdownPath,
      previewUrl,
      mimeType: file.type || "application/octet-stream",
    };
  }

  resolveFileUrl(path: string): string | null {
    const normalized = path.startsWith("./")
      ? path
      : `./${path.replace(/^\/+/, "")}`;
    return this.assets.get(normalized) ?? null;
  }

  async openProject(_path: string): Promise<void> {
    return;
  }

  dispose(): void {
    for (const previewUrl of this.assets.values()) {
      URL.revokeObjectURL(previewUrl);
    }
    this.assets.clear();
  }
}
