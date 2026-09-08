import { timingSafeEqual } from "node:crypto";
import { TLSSocket } from "node:tls";
import type { Request, RequestHandler } from "express";
import { isLoopbackHost } from "./network.js";

function requestAuthority(
  req: Request,
): { hostname: string; origin: string } | null {
  const host = req.headers.host;
  // Accept an HTTP authority only, not credentials, a path or a list of hosts.
  if (!host || /[\s/\\?#@,]/.test(host)) return null;
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host);
  if (!match) return null;
  const protocol =
    req.socket instanceof TLSSocket && req.socket.encrypted ? "https" : "http";
  try {
    const url = new URL(`${protocol}://${host}`);
    return {
      hostname: match[1].replace(/^\[|\]$/g, "").toLowerCase(),
      origin: url.origin,
    };
  } catch {
    return null;
  }
}

function tokensMatch(supplied: string, expected: string): boolean {
  const actual = Buffer.from(supplied);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function hasValidApiToken(req: Request, token: string): boolean {
  const header = req.headers.authorization;
  if (
    header?.startsWith("Bearer ") &&
    tokensMatch(header.slice(7).trim(), token)
  ) {
    return true;
  }

  // EventSource cannot set an Authorization header. Keep the existing remote
  // document exception narrow; URL tokens never authorise other API routes.
  const pathname = req.originalUrl.split("?")[0];
  return (
    req.method === "GET" &&
    /^\/api\/remote-document\/[^/]+\/events\/?$/i.test(pathname) &&
    typeof req.query.token === "string" &&
    tokensMatch(req.query.token, token)
  );
}

/** Mount on /api before body parsing or any handler with side effects. */
export function requestSecurity(token: string | null): RequestHandler {
  return (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");

    const authority = requestAuthority(req);
    if (!authority) {
      res.status(403).json({ error: "Invalid request Host." });
      return;
    }

    const origin = req.headers.origin;
    if (origin !== undefined) {
      let sameOrigin = false;
      try {
        // Browsers send a serialised origin, never a path, credentials or null.
        const parsed = new URL(origin);
        sameOrigin = parsed.origin === origin && origin === authority.origin;
      } catch {
        // Malformed and opaque (null) origins fail closed.
      }
      if (!sameOrigin) {
        res
          .status(403)
          .json({ error: "Cross-origin API requests are not allowed." });
        return;
      }
    }

    // Check the actual peer separately: a remote caller can forge localhost
    // Host and X-Forwarded-* headers. Neither makes its socket a local one.
    const localPeer = isLoopbackHost(req.socket.remoteAddress ?? "");
    if (!localPeer || !isLoopbackHost(authority.hostname)) {
      if (!token) {
        res.status(403).json({
          error: "Remote API access requires a configured server token.",
        });
        return;
      }
      if (!hasValidApiToken(req, token)) {
        res.set("WWW-Authenticate", 'Bearer realm="Roughdraft"');
        res
          .status(401)
          .json({ error: "Remote API access requires a valid bearer token." });
        return;
      }
    }

    next();
  };
}
