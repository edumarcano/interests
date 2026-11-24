import { describe, expect, it } from "vitest";

import { ENGINE_VERSION, WORKSPACE_COMPATIBILITY } from "./index";

describe("workspace foundation", () => {
  it("resolves workspace package imports", () => {
    expect(ENGINE_VERSION).toBe("0.0.16");
    expect(WORKSPACE_COMPATIBILITY).toEqual({
      engine: "0.0.16",
      rules: "0.0.12",
      shared: "0.0.17",
      rulesShared: "0.0.17",
    });
  });
});
