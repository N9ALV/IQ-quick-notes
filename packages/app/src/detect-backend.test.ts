import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiBackend } from "./api-backend";
import { detectBackend } from "./detect-backend";
import { LocalStorageBackend } from "./local-storage-backend";
import { RemoteBackend } from "./remote-backend";

describe("detectBackend", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps the static preview local unless an explicit remote session was requested", async () => {
    vi.stubEnv("VITE_PREVIEW_WEB", "1");
    expect(await detectBackend()).toBeInstanceOf(LocalStorageBackend);
    window.history.replaceState(null, "", "/?session=session-1");
    await expect(detectBackend()).rejects.toThrow(/remote/i);
  });

  it("creates a remote backend when the URL has a session and the server supports remote documents", async () => {
    window.history.replaceState(null, "", "/?session=session-1&token=secret");
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            backend: "local-files",
            capabilities: { remoteDocuments: true },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const remoteBackend = new RemoteBackend(
      {
        kind: "remote",
        label: "Remote document",
        detail: "draft.md",
        sessionId: "session-1",
        originPath: "/work/draft.md",
      },
      {
        id: "session-1",
        originPath: "/work/draft.md",
        content: "content",
        version: "version-1",
      },
    );
    const createRemoteBackend = vi
      .spyOn(RemoteBackend, "create")
      .mockResolvedValue(remoteBackend);

    await expect(detectBackend()).resolves.toBe(remoteBackend);
    expect(createRemoteBackend).toHaveBeenCalledWith("session-1", "secret");
  });

  it("rejects a session URL when the server cannot serve remote documents", async () => {
    window.history.replaceState(null, "", "/?session=session-1");
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            backend: "local-files",
            projectDir: "/work",
            capabilities: {},
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const createRemoteBackend = vi.spyOn(RemoteBackend, "create");

    await expect(detectBackend()).rejects.toThrow(/remote/i);
    expect(createRemoteBackend).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])(
    "does not replace a remote session with browser storage after HTTP %s",
    async (status) => {
      window.history.replaceState(null, "", "/?session=session-1");
      global.fetch = vi.fn(async () => new Response("Unavailable", { status }));
      await expect(detectBackend()).rejects.toThrow(/remote/i);
    },
  );

  it("does not replace a remote session with browser storage when discovery is offline", async () => {
    window.history.replaceState(null, "", "/?session=session-1");
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(detectBackend()).rejects.toThrow(/remote/i);
  });

  it("still selects local files for a normal local server URL", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ backend: "local-files", projectDir: "/work" }),
        ),
    );
    expect(await detectBackend()).toBeInstanceOf(ApiBackend);
  });

  it("does not hide a broken remote session by falling back to local storage", async () => {
    window.history.replaceState(null, "", "/?session=missing&token=bad");
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            backend: "local-files",
            capabilities: { remoteDocuments: true },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    vi.spyOn(RemoteBackend, "create").mockRejectedValue(
      new Error("Could not load remote document session missing: 404"),
    );

    await expect(detectBackend()).rejects.toThrow(
      /Could not load remote document session/,
    );
  });

  it("uses local storage when no server is available", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const backend = await detectBackend();

    expect(backend).toBeInstanceOf(LocalStorageBackend);
  });

  it("authenticates remote server discovery with the existing session token", async () => {
    window.history.replaceState(
      null,
      "",
      "/?session=session-1&token=test-only-token",
    );
    global.fetch = vi.fn(async (_url, options) => {
      const authorised =
        new Headers(options?.headers).get("Authorization") ===
        "Bearer test-only-token";
      return new Response(
        JSON.stringify({
          backend: "local-files",
          capabilities: { remoteDocuments: true },
        }),
        { status: authorised ? 200 : 401 },
      );
    }) as typeof fetch;
    const remoteBackend = new RemoteBackend(
      {
        kind: "remote",
        label: "Remote document",
        detail: "draft.md",
        sessionId: "session-1",
        originPath: "/work/draft.md",
      },
      {
        id: "session-1",
        originPath: "/work/draft.md",
        content: "content",
        version: "version-1",
      },
    );
    vi.spyOn(RemoteBackend, "create").mockResolvedValue(remoteBackend);

    await expect(detectBackend()).resolves.toBe(remoteBackend);
  });
});
