import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index";

describe("file attachment isolation", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "roughdraft-assets-security-"),
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it.each([
    [
      "attachment.html",
      "<html><script>window.attachmentRan = true</script></html>",
      "text/html",
    ],
    [
      "attachment.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>window.attachmentRan = true</script></svg>',
      "image/svg+xml",
    ],
  ])(
    "sandboxes %s without changing its bytes or file type",
    async (filename, content, contentType) => {
      fs.writeFileSync(path.join(projectDir, filename), content);
      const { app } = createApp({ homeDir: projectDir });
      const response = await request(app)
        .get("/api/files")
        .query({ projectPath: projectDir, path: filename });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain(contentType);
      const csp = response.headers["content-security-policy"];
      expect(csp).toBeDefined();
      const directives = csp
        .split(";")
        .map((directive: string) => directive.trim());
      expect(directives).toContain("sandbox");
      expect(directives).toContain("default-src 'none'");
      expect(directives).toContain("base-uri 'none'");
      expect(directives).toContain("form-action 'none'");
      expect(csp).not.toContain("allow-scripts");
      expect(csp).not.toContain("allow-same-origin");
      expect(response.text ?? response.body.toString()).toBe(content);
      expect(fs.readFileSync(path.join(projectDir, filename), "utf8")).toBe(
        content,
      );
    },
  );
});
