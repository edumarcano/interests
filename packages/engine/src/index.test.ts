import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, WORKSPACE_COMPATIBILITY } from "./index";

describe("workspace foundation", () => {
  it("resolves workspace package imports", () => {
    expect(ENGINE_VERSION).toBe("0.0.7");
    expect(WORKSPACE_COMPATIBILITY).toEqual({
      engine: "0.0.7",
      rules: "0.0.5",
      shared: "0.0.9",
      rulesShared: "0.0.9",
    });
  });
});
