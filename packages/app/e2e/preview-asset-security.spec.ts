import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { logE2eEvent, richTextEditor } from "./helpers";

test("practice SVG attachments cannot execute when opened as a document", async ({
  page,
}) => {
  await page.goto("/preview");
  await expect(richTextEditor(page)).toBeVisible();
  const apiProbes: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/status?preview-attachment-probe=1"))
      apiProbes.push(response.status());
  });
  await richTextEditor(page).evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="1" y="20">Attachment example</text><script>parent.document.documentElement.dataset.attachmentExecuted="yes";parent.attachmentProbe=fetch(location.origin+"/api/status?preview-attachment-probe=1").then(async r=>({status:r.status,readable:!!(await r.json()).backend}))</script></svg>',
        ],
        "example.svg",
        { type: "image/svg+xml" },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const attachment = richTextEditor(page).locator('img[alt="example.svg"]');
  await expect(
    page.getByTestId("attachment-error").or(attachment),
  ).toBeVisible();
  const href = (await attachment.count())
    ? await attachment.getAttribute("src")
    : null;
  // Navigating the emitted link in a child frame keeps the practice page and
  // its in-memory object URL alive while exercising the browser document boundary.
  const outcome = href
    ? await page.evaluate(async (url) => {
        const frame = document.createElement("iframe");
        frame.id = "attachment-security-frame";
        const loaded = new Promise<void>(
          (resolve) => (frame.onload = () => resolve()),
        );
        frame.src = url;
        document.body.append(frame);
        await loaded;
        const probe = await (
          window as unknown as {
            attachmentProbe?: Promise<{ status: number; readable: boolean }>;
          }
        ).attachmentProbe;
        return {
          execution:
            document.documentElement.dataset.attachmentExecuted ?? null,
          probe,
        };
      }, href)
    : { execution: null, probe: undefined };
  logE2eEvent("preview.attachment-navigation", { ...outcome, apiProbes });
  expect(
    outcome.execution,
    "An attachment must not execute with Quick Notes origin access",
  ).toBeNull();
  await expect(page.getByTestId("attachment-error")).toContainText(
    /not added/i,
  );
  await expect(page.getByTestId("attachment-error")).toHaveAttribute(
    "role",
    "alert",
  );
  await expect(richTextEditor(page)).toContainText("My practice note");
  await expect(attachment).toHaveCount(0);
  expect(apiProbes).toEqual([]);
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../../.context/ui-state-screenshots/2026-09-08-quick-notes/06-practice-attachment-error.png",
        import.meta.url,
      ),
    ),
    fullPage: true,
  });
});

test("practice still accepts a raster image and PDF without changing existing text", async ({
  page,
}) => {
  await page.goto("/preview");
  await expect(richTextEditor(page)).toBeVisible();
  await richTextEditor(page).evaluate((element) => {
    const transfer = new DataTransfer();
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+1sAAAAASUVORK5CYII=",
      ),
      (character) => character.charCodeAt(0),
    );
    transfer.items.add(new File([png], "example.png", { type: "image/png" }));
    transfer.items.add(
      new File(["%PDF-1.4\n%%EOF"], "example.pdf", { type: "application/pdf" }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const image = richTextEditor(page).locator('img[alt="example.png"]');
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await expect(richTextEditor(page)).toContainText("example.pdf");
  await expect(richTextEditor(page)).toContainText("My practice note");
  await expect(page.getByTestId("attachment-error")).toHaveCount(0);
});
