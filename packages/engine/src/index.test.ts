import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, WORKSPACE_COMPATIBILITY } from "./index";

describe("workspace foundation", () => {
  it("resolves workspace package imports", () => {
    expect(ENGINE_VERSION).toBe("0.0.6");
    expect(WORKSPACE_COMPATIBILITY).toEqual({
      engine: "0.0.6",
      rules: "0.0.4",
      shared: "0.0.8",
      rulesShared: "0.0.8",
    });
  });
});
