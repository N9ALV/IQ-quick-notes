import fs from "node:fs";
import { get as httpGet, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index";

// Real HTTP requests and isolated files protect the server boundary, not a
// middleware implementation. Listeners stay on loopback, including requests
// with the Host that a rebinding browser or remote deployment would send.
describe("local server request security", () => {
  let projectDir: string;
  let server: Server | undefined;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-security-"));
    fs.writeFileSync(path.join(projectDir, "draft.md"), "# Private draft\n");
  });

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      server = undefined;
    }
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function start(remoteDocumentToken?: string, peerAddress?: string) {
    const { app } = createApp({
      homeDir: projectDir,
      staticDirPath: projectDir,
      remoteDocumentToken,
    });
    const listenerApp = express();
    if (peerAddress) {
      // Keep CI listeners private and deterministic. The genuine non-loopback
      // peer is also exercised by the documented built-server live check.
      listenerApp.use((req, _res, next) => {
        Object.defineProperty(req.socket, "remoteAddress", {
          value: peerAddress,
        });
        next();
      });
    }
    listenerApp.use(app);
    server = await new Promise<Server>((resolve) => {
      const listening = listenerApp.listen(0, "127.0.0.1", () =>
        resolve(listening),
      );
    });
    const port = (server.address() as AddressInfo).port;
    return { client: request(server), port };
  }

  it.each([
    "attacker.example",
    "127.attacker.example",
    "localhost@attacker.example",
    "localhost/ignored",
    "localhost:invalid",
  ])("does not expose file contents to the hostile Host %s", async (host) => {
    const { client, port } = await start();
    const response = await client
      .get("/api/markdown-file")
      .set("Host", `${host}:${port}`)
      .query({ projectPath: projectDir, path: "draft.md" });

    expect(response.status).toBe(403);
    expect(response.body.content).toBeUndefined();
  });

  it("rejects cross-site form POSTs before creating review notifications", async () => {
    const { client, port } = await start();
    const query = { projectPath: projectDir, path: "draft.md" };
    const response = await client
      .post("/api/review-events")
      .set("Host", `localhost:${port}`)
      .set("Origin", "https://attacker.example")
      .type("form")
      .query(query)
      .send("unused=value");
    const events = await client.get("/api/review-events/after").query(query);

    expect(response.status).toBe(403);
    expect(events.body.events).toEqual([]);
  });

  it.each(["https://attacker.example", "null"])(
    "does not return local files to the browser Origin %s",
    async (origin) => {
      const { client, port } = await start();
      const response = await client
        .get("/api/markdown-file")
        .set("Host", `localhost:${port}`)
        .set("Origin", origin)
        .query({ projectPath: projectDir, path: "draft.md" });

      expect(response.status).toBe(403);
      expect(response.body.content).toBeUndefined();
    },
  );

  it("requires the configured bearer token for remote-host file requests", async () => {
    const { client, port } = await start("test-only-token");
    const response = await client
      .get("/api/markdown-file")
      .set("Host", `notes.example:${port}`)
      .query({ projectPath: projectDir, path: "draft.md" });

    expect(response.status).toBe(401);
    expect(response.body.content).toBeUndefined();
  });

  it("keeps ordinary loopback browser reads and no-Origin CLI writes working", async () => {
    const { client, port } = await start();
    const query = { projectPath: projectDir, path: "draft.md" };
    const read = await client
      .get("/api/markdown-file")
      .set("Host", `localhost:${port}`)
      .set("Origin", `http://localhost:${port}`)
      .query(query);
    expect(read.status).toBe(200);
    expect(read.body.content).toBe("# Private draft\n");

    const write = await client
      .put("/api/markdown-file")
      .query(query)
      .send({ content: "# CLI update\n" });
    expect(write.status).toBe(200);
    expect(fs.readFileSync(path.join(projectDir, "draft.md"), "utf8")).toBe(
      "# CLI update\n",
    );
  });

  it.each(["http://localhost:1", "http://localhost:2/path", "not-an-origin"])(
    "rejects the mismatched or malformed Origin %s before writes",
    async (origin) => {
      const { client, port } = await start();
      const response = await client
        .put("/api/markdown-file")
        .set("Host", `localhost:${port}`)
        .set("Origin", origin)
        .query({ projectPath: projectDir, path: "draft.md" })
        .send({ content: "# Unwanted write\n" });
      expect(response.status).toBe(403);
      expect(fs.readFileSync(path.join(projectDir, "draft.md"), "utf8")).toBe(
        "# Private draft\n",
      );
    },
  );

  it("does not accept a query token or forwarded localhost headers for remote file writes", async () => {
    const { client, port } = await start("test-only-token");
    const response = await client
      .put("/api/markdown-file")
      .set("Host", `notes.example:${port}`)
      .set("X-Forwarded-Host", `localhost:${port}`)
      .set("X-Forwarded-For", "127.0.0.1")
      .query({
        projectPath: projectDir,
        path: "draft.md",
        token: "test-only-token",
      })
      .send({ content: "# Unwanted write\n" });
    expect(response.status).toBe(401);
    expect(fs.readFileSync(path.join(projectDir, "draft.md"), "utf8")).toBe(
      "# Private draft\n",
    );
  });

  it("does not let a non-loopback peer forge localhost Host or forwarding headers", async () => {
    const { client, port } = await start("test-only-token", "192.0.2.10");
    const response = await client
      .get("/api/markdown-file")
      .set("Host", `localhost:${port}`)
      .set("X-Forwarded-For", "127.0.0.1")
      .set("X-Forwarded-Host", `localhost:${port}`)
      .query({ projectPath: projectDir, path: "draft.md" });
    expect(response.status).toBe(401);
    expect(response.body.content).toBeUndefined();
  });

  it("allows bearer-authenticated remote file access with same-origin browser requests", async () => {
    const { client, port } = await start("test-only-token");
    const response = await client
      .get("/api/markdown-file")
      .set("Host", `notes.example:${port}`)
      .set("Origin", `http://notes.example:${port}`)
      .set("Authorization", "Bearer test-only-token")
      .query({ projectPath: projectDir, path: "draft.md" });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe("# Private draft\n");
  });

  it("does not let a valid bearer token bypass cross-site Origin protection", async () => {
    const { client, port } = await start("test-only-token");
    const response = await client
      .get("/api/markdown-file")
      .set("Host", `notes.example:${port}`)
      .set("Origin", "https://attacker.example")
      .set("Authorization", "Bearer test-only-token")
      .query({ projectPath: projectDir, path: "draft.md" });
    expect(response.status).toBe(403);
  });

  it("keeps a Host-preserving development proxy on its exact browser origin working", async () => {
    const { client } = await start();
    const response = await client
      .get("/api/markdown-file")
      .set("Host", "localhost:4318")
      .set("Origin", "http://localhost:4318")
      .query({ projectPath: projectDir, path: "draft.md" });
    expect(response.status).toBe(200);
  });

  it("marks file APIs as private, non-cacheable and non-sniffable", async () => {
    const { client } = await start();
    const response = await client
      .get("/api/files")
      .query({ projectPath: projectDir, path: "draft.md" });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("keeps deliberate bearer-authenticated remote document registration working", async () => {
    const { client, port } = await start("test-only-token");
    const response = await client
      .post("/api/remote-document")
      .set("Host", `notes.example:${port}`)
      .set("Authorization", "Bearer test-only-token")
      .send({
        sessionId: "remote-security-check",
        originPath: "/notes/draft.md",
        content: "# Remote draft\n",
      });
    expect(response.status).toBe(201);
    expect(response.body.id).toBe("remote-security-check");
  });

  it("preserves the query token exception for remote document event streams", async () => {
    const { client, port } = await start("test-only-token");
    await client
      .post("/api/remote-document")
      .set("Authorization", "Bearer test-only-token")
      .send({
        sessionId: "remote-sse",
        originPath: "/notes/draft.md",
        content: "# Remote\n",
      })
      .expect(201);

    const result = await new Promise<{
      status: number | undefined;
      event: string;
      cacheControl: string | undefined;
    }>((resolve, reject) => {
      const req = httpGet(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/remote-document/remote-sse/events?role=viewer&token=test-only-token",
          headers: {
            Host: `notes.example:${port}`,
            Origin: `http://notes.example:${port}`,
          },
        },
        (res) => {
          res.once("data", (chunk: Buffer) => {
            resolve({
              status: res.statusCode,
              event: chunk.toString(),
              cacheControl: res.headers["cache-control"],
            });
            req.destroy();
          });
        },
      );
      req.setTimeout(2000, () =>
        req.destroy(new Error("Event stream did not respond")),
      );
      req.on("error", reject);
    });
    expect(result.status).toBe(200);
    expect(result.event).toContain("event: disconnected");
    expect(result.cacheControl).toContain("no-store");
    expect(result.cacheControl).toContain("private");
  });
});
