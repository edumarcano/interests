import os from "node:os";

/**
 * Returns a priority score for IPv4 addresses to sort typical home LANs first.
 * Lower score = higher priority.
 */
function getIpPriority(ip: string): number {
  if (ip.startsWith("192.168.")) return 1;
  if (ip.startsWith("10.")) return 2;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 3;
  if (ip.startsWith("169.254.")) return 5; // Link-local / autoconfigured
  return 4; // Other external IPv4
}

export interface LanDiscoveryOptions {
  readonly networkInterfacesProvider?: () => NodeJS.Dict<
    os.NetworkInterfaceInfo[]
  >;
}

/**
 * Discovers and formats candidate LAN origin URLs (e.g. `http://192.168.1.50:3000`)
 * for the host machine.
 *
 * Excludes loopback/internal addresses and non-IPv4 addresses.
 * Returns deterministic ordering with home/office private LAN ranges prioritized.
 */
export function discoverLanOrigins(
  port: number,
  options: LanDiscoveryOptions = {},
): string[] {
  const getInterfaces =
    options.networkInterfacesProvider ?? os.networkInterfaces;
  const interfaces = getInterfaces();
  if (!interfaces) {
    return [];
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

  return uniqueIps.map((ip) => `http://${ip}:${port}`);
}
