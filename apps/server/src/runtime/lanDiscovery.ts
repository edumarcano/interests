import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Returns a priority score for IPv4 addresses to sort typical home LANs first.
 * Lower score = higher priority. Used as a deterministic fallback sort.
 */
function getIpPriority(ip: string): number {
  if (ip.startsWith("192.168.")) return 1;
  if (ip.startsWith("10.")) return 2;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 3;
  if (ip.startsWith("169.254.")) return 5; // Link-local / autoconfigured
  return 4; // Other external IPv4
}

function getIpv4ForInterface(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
  ifaceName: string,
): string | null {
  const addresses = interfaces[ifaceName];
  if (!addresses) return null;

  for (const info of addresses) {
    const isIpv4 = info.family === "IPv4" || (info.family as unknown) === 4;
    if (!isIpv4) continue;
    if (info.internal) continue;
    if (info.address.startsWith("127.")) continue;
    if (info.address === "0.0.0.0") continue;
    return info.address;
  }
  return null;
}

/**
 * Parses Windows `route print 0.0.0.0` output to find the IPv4 address
 * belonging to the default route with the lowest metric.
 */
export function parseWindowsRoutePrint(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/);
  const candidates: Array<{ interfaceIp: string; metric: number }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("0.0.0.0")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const dest = parts[0];
    const netmask = parts[1];
    const interfaceIp = parts[3];
    const metricStr = parts[4];
    if (
      dest !== "0.0.0.0" ||
      netmask !== "0.0.0.0" ||
      !interfaceIp ||
      !metricStr
    )
      continue;
    if (!net.isIPv4(interfaceIp)) continue;
    const metric = Number.parseInt(metricStr, 10);
    if (Number.isNaN(metric)) continue;
    candidates.push({ interfaceIp, metric });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => a.metric - b.metric);
  return candidates[0]?.interfaceIp ?? null;
}

/**
 * Parses macOS `route -n get default` output to find the interface name,
 * then resolves it to an IPv4 address using the provided network interfaces.
 */
export function parseDarwinRoute(
  stdout: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): string | null {
  const match = stdout.match(/^\s*interface:\s*(\S+)/m);
  if (!match || !match[1]) return null;
  return getIpv4ForInterface(interfaces, match[1]);
}

/**
 * Parses macOS/BSD `netstat -rn -f inet` output as a fallback.
 */
export function parseDarwinNetstat(
  stdout: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): string | null {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("default")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 4 && parts[3]) {
      const iface = parts[3];
      const ip = getIpv4ForInterface(interfaces, iface);
      if (ip) return ip;
    }
  }
  return null;
}

/**
 * Parses Linux `/proc/net/route` content to find the default route interface
 * with the lowest metric, then resolves it to an IPv4 address.
 */
export function parseLinuxProcNetRoute(
  content: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): string | null {
  const lines = content.split(/\r?\n/);
  const candidates: Array<{ iface: string; metric: number }> = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 8) continue;
    const iface = parts[0];
    const destination = parts[1];
    const flagsStr = parts[3];
    const metricStr = parts[6];
    const mask = parts[7];
    if (!iface || !destination || !flagsStr || !metricStr || !mask) continue;
    if (destination !== "00000000" || mask !== "00000000") continue;
    const flags = Number.parseInt(flagsStr, 16);
    if ((flags & 0x2) === 0) continue; // RTF_GATEWAY required
    const metric = Number.parseInt(metricStr, 10) || 0;
    candidates.push({ iface, metric });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.metric - b.metric);

  for (const cand of candidates) {
    const ip = getIpv4ForInterface(interfaces, cand.iface);
    if (ip) return ip;
  }
  return null;
}

/**
 * Parses Linux `ip route show default` output as a fallback.
 */
export function parseLinuxIpRoute(
  stdout: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): string | null {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("default")) continue;
    const srcMatch = trimmed.match(/\bsrc\s+(\S+)/);
    if (srcMatch?.[1] && net.isIPv4(srcMatch[1])) {
      return srcMatch[1];
    }
    const devMatch = trimmed.match(/\bdev\s+(\S+)/);
    if (devMatch?.[1]) {
      const ip = getIpv4ForInterface(interfaces, devMatch[1]);
      if (ip) return ip;
    }
  }
  return null;
}

/**
 * Discovers the host IPv4 address associated with the active default route.
 * Returns null safely on any discovery failure or unexpected environment.
 */
export async function detectDefaultRouteIp(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
  platform: NodeJS.Platform = os.platform(),
): Promise<string | null> {
  try {
    if (platform === "win32") {
      const { stdout } = await execFileAsync("route", ["print", "0.0.0.0"], {
        timeout: 2000,
        windowsHide: true,
      });
      return parseWindowsRoutePrint(stdout);
    }

    if (platform === "darwin") {
      try {
        const { stdout } = await execFileAsync(
          "route",
          ["-n", "get", "default"],
          {
            timeout: 2000,
          },
        );
        const ip = parseDarwinRoute(stdout, interfaces);
        if (ip) return ip;
      } catch {
        // Fallback to netstat
      }
      try {
        const { stdout } = await execFileAsync(
          "netstat",
          ["-rn", "-f", "inet"],
          {
            timeout: 2000,
          },
        );
        return parseDarwinNetstat(stdout, interfaces);
      } catch {
        return null;
      }
    }

    if (platform === "linux") {
      try {
        const content = await fs.promises.readFile("/proc/net/route", "utf8");
        const ip = parseLinuxProcNetRoute(content, interfaces);
        if (ip) return ip;
      } catch {
        // Fallback to ip route command
      }
      try {
        const { stdout } = await execFileAsync(
          "ip",
          ["route", "show", "default"],
          {
            timeout: 2000,
          },
        );
        return parseLinuxIpRoute(stdout, interfaces);
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface LanDiscoveryOptions {
  readonly networkInterfacesProvider?: () => NodeJS.Dict<
    os.NetworkInterfaceInfo[]
  >;
  readonly defaultRouteIpProvider?: () =>
    | Promise<string | null | undefined>
    | string
    | null
    | undefined;
}

/**
 * Discovers and formats candidate LAN origin URLs (e.g. `http://192.168.1.50:3000`)
 * for the host machine.
 *
 * Excludes loopback/internal addresses and non-IPv4 addresses.
 * Prioritizes the active default-route IPv4 address as the primary origin (index 0)
 * when available. Remaining candidates retain deterministic fallback ordering.
 */
export async function discoverLanOrigins(
  port: number,
  options: LanDiscoveryOptions = {},
): Promise<string[]> {
  const getInterfaces =
    options.networkInterfacesProvider ?? os.networkInterfaces;
  const interfaces = getInterfaces();
  if (!interfaces) {
    return [];
  }

  let defaultRouteIp: string | null = null;
  try {
    if (options.defaultRouteIpProvider) {
      defaultRouteIp = (await options.defaultRouteIpProvider()) ?? null;
    } else {
      defaultRouteIp = await detectDefaultRouteIp(interfaces);
    }
  } catch {
    defaultRouteIp = null;
  }

  const candidateIps: string[] = [];

  for (const interfaceName of Object.keys(interfaces)) {
    const addresses = interfaces[interfaceName];
    if (!addresses) continue;

    for (const info of addresses) {
      // Must be IPv4
      const isIpv4 = info.family === "IPv4" || (info.family as unknown) === 4;
      if (!isIpv4) continue;

      // Exclude internal / loopback
      if (info.internal) continue;
      if (info.address.startsWith("127.")) continue;
      if (info.address === "0.0.0.0") continue;

      candidateIps.push(info.address);
    }
  }

  // Deduplicate
  const uniqueIps = Array.from(new Set(candidateIps));

  // Sort deterministically: by priority rank, then lexicographically / numerically
  uniqueIps.sort((a, b) => {
    const prioA = getIpPriority(a);
    const prioB = getIpPriority(b);
    if (prioA !== prioB) return prioA - prioB;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  // If the default-route address was discovered and is a valid external candidate,
  // promote it to the primary position (index 0).
  if (defaultRouteIp && uniqueIps.includes(defaultRouteIp)) {
    const remaining = uniqueIps.filter((ip) => ip !== defaultRouteIp);
    uniqueIps.length = 0;
    uniqueIps.push(defaultRouteIp, ...remaining);
  }

  return uniqueIps.map((ip) => `http://${ip}:${port}`);
}
