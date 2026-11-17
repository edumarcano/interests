import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, WORKSPACE_COMPATIBILITY } from "./index";

describe("workspace foundation", () => {
  it("resolves workspace package imports", () => {
    expect(ENGINE_VERSION).toBe("0.0.8");
    expect(WORKSPACE_COMPATIBILITY).toEqual({
      engine: "0.0.8",
      rules: "0.0.6",
      shared: "0.0.10",
      rulesShared: "0.0.10",
    });
  });
});
