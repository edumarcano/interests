import { createGame } from "@interests/engine";
import { asPlayerId } from "@interests/shared";
import { describe, expect, it } from "vitest";
import { loadAndValidateSnapshot } from "../src/match/snapshotLoader";
import { getCurrentVersionMetadata } from "../src/match/versions";

function openingSnapshot() {
  return createGame({
    gameId: "foundation-snapshot",
    seed: "foundation-snapshot",
    playerIds: ["p1", "p2", "p3", "p4"].map(asPlayerId),
  });
}

describe("foundation snapshot compatibility boundary", () => {
  it("round-trips complete current state without regenerating private facts", () => {
    const state = openingSnapshot();
    const serialized = JSON.stringify(state);
    expect(
      loadAndValidateSnapshot(serialized, getCurrentVersionMetadata()),
    ).toEqual(state);
    expect(JSON.stringify(loadAndValidateSnapshot(serialized))).toBe(
      serialized,
    );
  });

  it("rejects missing progress or result rather than inventing historical state", () => {
    for (const field of ["progress", "result"]) {
      const candidate: Record<string, unknown> = { ...openingSnapshot() };
      delete candidate[field];
      const serialized = JSON.stringify(candidate);
      expect(() => loadAndValidateSnapshot(serialized)).toThrow(
        `missing required structural field '${field}'`,
      );
      expect(JSON.stringify(candidate)).toBe(serialized);
    }
  });

  it("leaves old-format data intact and requires its compatible build", () => {
    const serialized = JSON.stringify(openingSnapshot());
    expect(() =>
      loadAndValidateSnapshot(serialized, {
        engineVersion: "0.0.6",
        rulesVersion: "0.0.4",
        sharedVersion: "0.0.8",
        persistenceFormatVersion: "0.0.5",
      }),
    ).toThrow("Incompatible match version metadata");
    expect(JSON.parse(serialized)).toEqual(openingSnapshot());
  });

  it.each(["missing", "wrong-units", "nonowner"])(
    "rejects %s acquisition evidence before exposing or executing the snapshot",
    (defect) => {
      const state = openingSnapshot();
      const asset = Object.values(state.finance.assetsById)[0];
      if (!asset) throw new Error("Expected an opening asset");
      const owner = state.playerOrder.find(
        (id) => (asset.ownershipByPlayerPpm[id] ?? 0) > 0,
      );
      const other = state.playerOrder.find((id) => id !== owner);
      if (!owner || !other) throw new Error("Missing ownership fixture");
      const candidate = JSON.parse(JSON.stringify(state));
      if (defect === "missing")
        delete candidate.progress.byPlayer[owner].assetsById[asset.id];
      else if (defect === "wrong-units")
        candidate.progress.byPlayer[owner].assetsById[asset.id].ownershipPpm =
          1;
      else
        candidate.progress.byPlayer[other].assetsById[asset.id] =
          candidate.progress.byPlayer[owner].assetsById[asset.id];
      expect(() => loadAndValidateSnapshot(JSON.stringify(candidate))).toThrow(
        /acquisition|Acquisition/,
      );
    },
  );
});
