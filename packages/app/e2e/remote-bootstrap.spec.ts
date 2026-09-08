import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { codeEditor, logE2eEvent } from "./helpers";

test("failed remote discovery shows a retry and recovers the same remote note @smoke", async ({
  page,
}) => {
  let available = false;
  const localRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(?:open-requests|update-status|projects)/.test(request.url()))
      localRequests.push(request.url());
  });
  await page.route("**/api/status", async (route) => {
    logE2eEvent("remote.discovery", { available });
    await route.fulfill(
      available
        ? {
            status: 200,
            json: {
              backend: "local-files",
              capabilities: { remoteDocuments: true },
            },
          }
        : { status: 401, json: { error: "Unauthorised" } },
    );
  });
  await page.route("**/api/remote-document/retry-session", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer test-only-token",
    );
    await route.fulfill({
      json: {
        id: "retry-session",
        originPath: "/remote/retry.md",
        content: "# Remote retry note",
        version: "v1",
      },
    });
  });
  await page.route("**/api/remote-document/retry-session/events**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "event: connected\ndata: {}\n\n",
    }),
  );
  await page.goto("/?session=retry-session&token=test-only-token&editor=code");
  await expect(page.getByTestId("remote-session-error")).toContainText(
    /remote/i,
  );
  await expect(page.getByTestId("remote-session-error")).toHaveAttribute(
    "role",
    "alert",
  );
  await expect(page.getByTestId("remote-session-retry")).toBeVisible();
  await expect(page.getByTestId("remote-session-retry")).toHaveAccessibleName(
    "Try again",
  );
  await expect(page.getByTestId("homepage-practice")).toHaveCount(0);
  logE2eEvent("remote.failure-visible", { retry: true });
  await page.screenshot({
    path: fileURLToPath(
      new URL(
        "../../../.context/ui-state-screenshots/2026-09-08-quick-notes/05-remote-bootstrap-error.png",
        import.meta.url,
      ),
    ),
    fullPage: true,
  });
  available = true;
  await page.getByTestId("remote-session-retry").click();
  await expect(codeEditor(page)).toContainText("Remote retry note");
  await expect(page.getByTestId("remote-session-error")).toHaveCount(0);
  expect(localRequests).toEqual([]);
  logE2eEvent("remote.retry-loaded", { localRequests: localRequests.length });
});
