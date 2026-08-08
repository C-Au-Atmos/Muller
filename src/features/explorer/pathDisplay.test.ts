import { describe, expect, it } from "vitest";

import { displayPath, sameWindowsPath } from "./pathDisplay";

describe("Windows path display", () => {
  it("hides verbatim prefixes without changing the location", () => {
    expect(displayPath("\\\\?\\D:\\Muller")).toBe("D:\\Muller");
    expect(displayPath("\\\\?\\UNC\\server\\share\\folder")).toBe(
      "\\\\server\\share\\folder",
    );
    expect(displayPath("\\??\\D:\\Muller")).toBe("D:\\Muller");
    expect(displayPath("  D:\\Muller  ")).toBe("D:\\Muller");
  });

  it("compares drive paths case-insensitively with normalized separators", () => {
    expect(sameWindowsPath("D:\\Muller", "\\\\?\\d:\\muller\\")).toBe(true);
    expect(sameWindowsPath("D:/Muller", "d:\\Muller")).toBe(true);
    expect(sameWindowsPath("D:\\Muller", "D:\\Muller\\src")).toBe(false);
  });
});
