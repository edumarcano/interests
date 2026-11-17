import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, WORKSPACE_COMPATIBILITY } from "./index";

describe("workspace foundation", () => {
  it("resolves workspace package imports", () => {
    expect(ENGINE_VERSION).toBe("0.0.10");
    expect(WORKSPACE_COMPATIBILITY).toEqual({
      engine: "0.0.10",
      rules: "0.0.8",
      shared: "0.0.12",
      rulesShared: "0.0.12",
    });
  });
});
