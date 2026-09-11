import type os from "node:os";
import { describe, expect, it } from "vitest";
import { discoverLanOrigins } from "../src/runtime/lanDiscovery.js";

describe("discoverLanOrigins", () => {
  it("prioritizes 192.168.x.x, then 10.x.x.x, then 172.16-31.x.x", () => {
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
      wlan0: [
        {
          address: "172.20.0.5",
          netmask: "255.240.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:03",
          internal: false,
          cidr: "172.20.0.5/12",
        },
        {
          address: "198.51.100.1",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:04",
          internal: false,
          cidr: "198.51.100.1/24",
        },
      ],
    };

    const origins = discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
    });

    expect(origins).toEqual([
      "http://192.168.1.42:3000",
      "http://10.0.1.25:3000",
      "http://172.20.0.5:3000",
      "http://198.51.100.1:3000",
    ]);
  });

  it("filters out loopback, internal, and IPv6 addresses", () => {
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

    const origins = discoverLanOrigins(8080, {
      networkInterfacesProvider: () => mockInterfaces,
    });

    expect(origins).toEqual(["http://192.168.1.10:8080"]);
  });

  it("deduplicates identical IP addresses across multiple adapters", () => {
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

    const origins = discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
    });

    expect(origins).toEqual(["http://192.168.0.50:3000"]);
  });

  it("returns empty array if no external IPv4 addresses found", () => {
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

    const origins = discoverLanOrigins(3000, {
      networkInterfacesProvider: () => mockInterfaces,
    });

    expect(origins).toEqual([]);
  });
});
