import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, WORKSPACE_COMPATIBILITY } from "./index";

describe("workspace foundation", () => {
  it("resolves workspace package imports", () => {
    expect(ENGINE_VERSION).toBe("0.0.1");
    expect(WORKSPACE_COMPATIBILITY).toEqual({
      engine: "0.0.1",
      rules: "0.0.1",
      shared: "0.0.1",
      rulesShared: "0.0.1",
    });
  });
});
