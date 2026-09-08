import { isIP } from "node:net";

export { ROUGHDRAFT_DEFAULT_PORT } from "../defaults.mjs";
export const ROUGHDRAFT_BIND_HOST = "127.0.0.1";
export const ROUGHDRAFT_LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;
export const ROUGHDRAFT_PUBLIC_HOST = "localhost";

export const ROUGHDRAFT_BIND_HOST_ENV = "ROUGHDRAFT_BIND_HOST";

const LOOPBACK_HOST_NAMES = new Set<string>([
  ...ROUGHDRAFT_LOOPBACK_HOSTS,
  "localhost",
]);

export function resolveBindHosts(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const raw = env[ROUGHDRAFT_BIND_HOST_ENV];

  if (raw === undefined) {
    return ROUGHDRAFT_LOOPBACK_HOSTS;
  }

  const hosts = raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);

  if (hosts.length === 0) {
    return ROUGHDRAFT_LOOPBACK_HOSTS;
  }

  return hosts;
}

export function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOST_NAMES.has(host)) return true;
  // Any address in 127.0.0.0/8 is loopback (RFC 5735).
  if (isIP(host) === 4) return host.startsWith("127.");
  // Node reports IPv4 peers this way on dual-stack IPv6 listeners.
  if (isIP(host) === 6 && host.startsWith("::ffff:")) {
    const mapped = host.slice("::ffff:".length);
    return isIP(mapped) === 4 && mapped.startsWith("127.");
  }
  return false;
}

export function hasNonLoopbackHost(hosts: readonly string[]): boolean {
  return hosts.some((host) => !isLoopbackHost(host));
}
