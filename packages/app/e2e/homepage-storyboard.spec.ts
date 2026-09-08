import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  appendInCodeEditor,
  codeEditor,
  logE2eEvent,
  richTextEditor,
} from "./helpers";

const screenshots = fileURLToPath(
  new URL(
    "../../../.context/ui-state-screenshots/2026-09-08-quick-notes/",
    import.meta.url,
  ),
);

test.describe("Quick Notes welcome and reading", () => {
  test("offers a clear practice route and IU help @smoke", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("IQ Wealth Quick Notes");
    await expect(page.getByTestId("homepage-heading")).toBeVisible();
    await expect(page.getByTestId("homepage-help")).toHaveAttribute(
      "href",
      "https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/",
    );
    await expect(page.getByTestId("homepage-help")).toHaveAttribute(
      "role",
      "link",
    );
    await page.screenshot({
      path: path.join(screenshots, "01-home-desktop.png"),
      fullPage: true,
    });
    await page.getByTestId("homepage-practice").click();
    await expect(page).toHaveURL(/\/preview$/);
    await expect(page.getByTestId("practice-banner")).toBeVisible();
    await expect(richTextEditor(page)).toBeVisible();
    logE2eEvent("quick-notes.welcome-practice", { help: "canonical IU route" });
  });

  test("keeps welcome actions usable on a narrow screen and at 200 percent", async ({
    page,
  }) => {
    for (const scenario of [
      { name: "mobile", width: 390, height: 844, zoom: 1 },
      { name: "zoom-200", width: 1280, height: 900, zoom: 2 },
    ]) {
      await page.setViewportSize({
        width: scenario.width,
        height: scenario.height,
      });
      await page.goto("/");
      await page.evaluate((zoom) => {
        document.body.style.zoom = String(zoom);
      }, scenario.zoom);
      await expect(page.getByTestId("homepage-practice")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: path.join(screenshots, `01-home-${scenario.name}.png`),
        fullPage: true,
      });
    }
  });

  test("changes reading size in rich and code views without changing the note", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/preview");
    await page.getByTestId("document-reading-size").click();
    await page.getByTestId("document-reading-size-largest").click();
    await expect(
      page.getByTestId("document-reading-size-largest"),
    ).not.toBeVisible();
    await expect(richTextEditor(page)).toHaveCSS("font-size", "24px");
    await page.screenshot({
      path: path.join(screenshots, "02-practice-mobile-largest.png"),
      fullPage: true,
    });
    await page.getByTestId("document-editor-view-toggle").click();
    await expect(codeEditor(page)).toBeVisible();
    await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "24px");
    await expect(codeEditor(page)).toContainText("My practice note");
    await page.screenshot({
      path: path.join(screenshots, "03-practice-mobile-code-largest.png"),
      fullPage: true,
    });
    await page.reload();
    await expect(page.getByTestId("practice-banner")).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("iq-quick-notes-reading-size"),
      ),
    ).toBe("largest");
  });

  test("downloads the current practice draft in the real browser", async ({
    page,
  }) => {
    await page.goto("/preview?editor=code");
    await appendInCodeEditor(page, "\n\nKeep this latest text.");
    await page.getByTestId("document-file-menu-trigger").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("document-file-menu-download").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("preview-copy.md");
    const stream = await download.createReadStream();
    if (!stream)
      throw new Error("The browser did not provide the downloaded copy.");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toContain(
      "Keep this latest text.",
    );
    await expect(page.getByTestId("document-download-status")).toBeVisible();
    await expect(page.getByTestId("document-download-status")).toContainText(
      "Your original note has not been changed.",
    );
    await page.screenshot({
      path: path.join(screenshots, "04-practice-download.png"),
      fullPage: true,
    });
  });
});
