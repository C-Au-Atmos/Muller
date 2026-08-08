import { describe, expect, it } from "vitest";

import { updateTypeAheadBuffer } from "./typeAhead";

describe("Explorer type-ahead buffer", () => {
  it("builds a rolling prefix and resets after the timeout", () => {
    const first = updateTypeAheadBuffer({ buffer: "", lastInputAt: 0 }, "P", 100);
    const second = updateTypeAheadBuffer(first.state, "h", 300);
    const reset = updateTypeAheadBuffer(second.state, "V", 1401);
    expect(first.query).toBe("p");
    expect(second.query).toBe("ph");
    expect(reset.query).toBe("v");
  });

  it("cycles matches when the same character repeats", () => {
    const first = updateTypeAheadBuffer({ buffer: "", lastInputAt: 0 }, "a", 1);
    const second = updateTypeAheadBuffer(first.state, "a", 2);
    expect(second.state.buffer).toBe("aa");
    expect(second.query).toBe("a");
  });
});
