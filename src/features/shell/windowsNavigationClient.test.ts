import { describe, expect, it } from "vitest";

import { shouldCompleteDirectoryPath } from "./windowsNavigationClient";

describe("directory path completion", () => {
  it("does not enumerate shares for a bare UNC host", () => {
    expect(shouldCompleteDirectoryPath(String.raw`\\10.1.10.8`)).toBe(false);
    expect(shouldCompleteDirectoryPath(String.raw`\\server`)).toBe(false);
  });

  it("allows share completion only after the host separator", () => {
    expect(shouldCompleteDirectoryPath("\\\\10.1.10.8\\")).toBe(true);
    expect(shouldCompleteDirectoryPath(String.raw`\\server\pub`)).toBe(true);
    expect(shouldCompleteDirectoryPath("D:\\Pictures\\ca")).toBe(true);
  });
});
