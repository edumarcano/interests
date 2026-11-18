import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, WORKSPACE_COMPATIBILITY } from "./index";

describe("workspace foundation", () => {
  it("resolves workspace package imports", () => {
    expect(ENGINE_VERSION).toBe("0.0.13");
    expect(WORKSPACE_COMPATIBILITY).toEqual({
      engine: "0.0.13",
      rules: "0.0.11",
      shared: "0.0.15",
      rulesShared: "0.0.15",
    });
  });
});
