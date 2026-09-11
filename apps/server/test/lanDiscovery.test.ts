import type os from "node:os";
import { describe, expect, it } from "vitest";
import {
  discoverLanOrigins,
  parseDarwinNetstat,
  parseDarwinRoute,
  parseLinuxIpRoute,
  parseLinuxProcNetRoute,
  parseWindowsRoutePrint,
} from "../src/runtime/lanDiscovery.js";

describe("discoverLanOrigins", () => {
  it("prioritizes default-route adapter over virtual adapters (Mandatory Physical Regression)", async () => {
    // Exact representation of the physical Windows host that exposed the bug:
    // - VirtualBox Host-Only Ethernet Adapter on 192.168.56.1 (no default route)
    // - Wi-Fi on 10.0.0.129 (owns the default route)
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      "Ethernet 2": [
        {
          address: "fe80::60bf:8e74:5ffb:8a4",
          netmask: "ffff:ffff:ffff:ffff::",
          family: "IPv6",
          mac: "0a:00:27:00:00:0c",
          internal: false,
          cidr: "fe80::60bf:8e74:5ffb:8a4/64",
          scopeid: 12,
        },
        {
          address: "192.168.56.1",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "0a:00:27:00:00:0c",
          internal: false,
          cidr: "192.168.56.1/24",
        },
      ],
      "Wi-Fi": [
        {
          address: "10.0.0.129",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "d0:57:7e:e0:6d:cf",
          internal: false,
          cidr: "10.0.0.129/24",
        },
      ],
    };

    const origins = await discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => "10.0.0.129",
    });

    // Primary join origin must be the active Wi-Fi default-route address,
    // and the virtual adapter address remains available as an alternate.
    expect(origins[0]).toBe("http://10.0.0.129:3000");
    expect(origins).toEqual([
      "http://10.0.0.129:3000",
      "http://192.168.56.1:3000",
    ]);
  });

  it("selects a single ordinary Wi-Fi/Ethernet candidate as primary", async () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: "192.168.1.100",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.1.100/24",
        },
      ],
    };

    const origins = await discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => "192.168.1.100",
    });

    expect(origins).toEqual(["http://192.168.1.100:3000"]);
  });

  it("selects default-route address first regardless of RFC1918 range preference", async () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: "192.168.1.42",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.1.42/24",
        },
      ],
      wlan0: [
        {
          address: "172.20.0.5",
          netmask: "255.240.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:02",
          internal: false,
          cidr: "172.20.0.5/12",
        },
      ],
      vpn0: [
        {
          address: "10.0.1.25",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:03",
          internal: false,
          cidr: "10.0.1.25/8",
        },
      ],
    };

    // 172.20.0.5 is the default-route interface
    const origins = await discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => "172.20.0.5",
    });

    expect(origins[0]).toBe("http://172.20.0.5:3000");
    // Remaining candidates follow deterministic fallback sort
    expect(origins.slice(1)).toEqual([
      "http://192.168.1.42:3000",
      "http://10.0.1.25:3000",
    ]);
  });

  it("falls back gracefully to deterministic sorting when default-route provider returns null", async () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: "10.0.1.25",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "10.0.1.25/8",
        },
        {
          address: "192.168.1.42",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:02",
          internal: false,
          cidr: "192.168.1.42/24",
        },
      ],
    };

    const origins = await discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => null,
    });

    expect(origins).toEqual([
      "http://192.168.1.42:3000",
      "http://10.0.1.25:3000",
    ]);
  });

  it("falls back gracefully when default-route provider throws without throwing to caller", async () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: "10.0.1.25",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "10.0.1.25/8",
        },
        {
          address: "192.168.1.42",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:02",
          internal: false,
          cidr: "192.168.1.42/24",
        },
      ],
    };

    const origins = await discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => {
        throw new Error("Command failed: route not found");
      },
    });

    expect(origins).toEqual([
      "http://192.168.1.42:3000",
      "http://10.0.1.25:3000",
    ]);
  });

  it("falls back to deterministic candidate ordering when default-route IP is absent from candidates", async () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: "192.168.1.42",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.1.42/24",
        },
        {
          address: "10.0.1.25",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:02",
          internal: false,
          cidr: "10.0.1.25/8",
        },
      ],
    };

    // Returns an external address that is not in the discovered interface candidates
    const origins = await discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => "203.0.113.99",
    });

    expect(origins).toEqual([
      "http://192.168.1.42:3000",
      "http://10.0.1.25:3000",
    ]);
  });

  it("filters out loopback, internal, and IPv6 addresses", async () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo: [
        {
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "127.0.0.1/8",
        },
        {
          address: "::1",
          netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
          family: "IPv6",
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "::1/128",
          scopeid: 0,
        },
      ],
      eth0: [
        {
          address: "fe80::1",
          netmask: "ffff:ffff:ffff:ffff::",
          family: "IPv6",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "fe80::1/64",
          scopeid: 1,
        },
        {
          address: "192.168.1.10",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.1.10/24",
        },
      ],
    };

    const origins = await discoverLanOrigins(8080, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => null,
    });

    expect(origins).toEqual(["http://192.168.1.10:8080"]);
  });

  it("deduplicates identical IP addresses across multiple adapters", async () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      vEthernet1: [
        {
          address: "192.168.0.50",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.0.50/24",
        },
      ],
      vEthernet2: [
        {
          address: "192.168.0.50",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:02",
          internal: false,
          cidr: "192.168.0.50/24",
        },
      ],
    };

    const origins = await discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => null,
    });

    expect(origins).toEqual(["http://192.168.0.50:3000"]);
  });

  it("returns empty array if no external IPv4 addresses found", async () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo: [
        {
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "127.0.0.1/8",
        },
      ],
    };

    const origins = await discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
      defaultRouteIpProvider: () => null,
    });

    expect(origins).toEqual([]);
  });
});

describe("OS Route Table Parsers", () => {
  describe("parseWindowsRoutePrint", () => {
    it("parses single active default route and extracts interface IPv4", () => {
      const sample = `
===========================================================================
IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0         10.0.0.1       10.0.0.129     30
===========================================================================
`;
      expect(parseWindowsRoutePrint(sample)).toBe("10.0.0.129");
    });

    it("selects default route with lowest metric among multiple routes", () => {
      const sample = `
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0     192.168.56.1     192.168.56.1     50
          0.0.0.0          0.0.0.0         10.0.0.1       10.0.0.129     25
        10.0.0.0    255.255.255.0         On-link       10.0.0.129    281
`;
      expect(parseWindowsRoutePrint(sample)).toBe("10.0.0.129");
    });

    it("returns null when no default route exists", () => {
      const sample = `
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
`;
      expect(parseWindowsRoutePrint(sample)).toBeNull();
    });

    it("returns null for malformed output", () => {
      expect(parseWindowsRoutePrint("Not a valid route table")).toBeNull();
    });
  });

  describe("parseDarwinRoute", () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      en0: [
        {
          address: "192.168.1.150",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.1.150/24",
        },
      ],
    };

    it("extracts interface name and resolves IPv4", () => {
      const sample = `
   route to: default
destination: default
       mask: default
    gateway: 192.168.1.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING>
`;
      expect(parseDarwinRoute(sample, mockInterfaces)).toBe("192.168.1.150");
    });

    it("returns null when interface is not in interfaces dict", () => {
      const sample = `
   route to: default
  interface: en99
`;
      expect(parseDarwinRoute(sample, mockInterfaces)).toBeNull();
    });
  });

  describe("parseDarwinNetstat", () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      en0: [
        {
          address: "192.168.1.150",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.1.150/24",
        },
      ],
    };

    it("parses netstat default line and resolves interface IPv4", () => {
      const sample = `
Routing tables
Destination        Gateway            Flags        Netif Expire
default            192.168.1.1        UGSc           en0
127.0.0.1          127.0.0.1          UH             lo0
`;
      expect(parseDarwinNetstat(sample, mockInterfaces)).toBe("192.168.1.150");
    });
  });

  describe("parseLinuxProcNetRoute", () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: "192.168.1.75",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.1.75/24",
        },
      ],
      wlan0: [
        {
          address: "10.10.0.50",
          netmask: "255.255.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:02",
          internal: false,
          cidr: "10.10.0.50/16",
        },
      ],
    };

    it("parses /proc/net/route and selects lowest metric route", () => {
      const sample = `Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT
wlan0\t00000000\t01000AA0\t0003\t0\t0\t600\t00000000\t0\t0\t0
eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
`;
      expect(parseLinuxProcNetRoute(sample, mockInterfaces)).toBe(
        "192.168.1.75",
      );
    });

    it("returns null when no default route entry exists", () => {
      const sample = `Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT
eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
`;
      expect(parseLinuxProcNetRoute(sample, mockInterfaces)).toBeNull();
    });
  });

  describe("parseLinuxIpRoute", () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: "192.168.1.75",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:01",
          internal: false,
          cidr: "192.168.1.75/24",
        },
      ],
    };

    it("parses output with src IP", () => {
      const sample =
        "default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.75 metric 100\n";
      expect(parseLinuxIpRoute(sample, mockInterfaces)).toBe("192.168.1.75");
    });

    it("parses output with dev only and resolves interface", () => {
      const sample = "default via 192.168.1.1 dev eth0 proto dhcp metric 100\n";
      expect(parseLinuxIpRoute(sample, mockInterfaces)).toBe("192.168.1.75");
    });
  });
});
