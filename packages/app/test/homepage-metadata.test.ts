import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Quick Notes document shell", () => {
  it("identifies the installed app before JavaScript loads without advertising the upstream website", () => {
    const document = new DOMParser().parseFromString(
      readFileSync(resolve("index.html"), "utf8"),
      "text/html",
    );
    expect(document.title).toBe("IQ Wealth Quick Notes");
    expect(document.documentElement.lang).toBe("en-AU");
    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute("content"),
    ).toContain("noindex");
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:image"]')).toBeNull();
  });
});
