import { describe, expect, it } from "vitest";
import { spaceParentPath } from "./spaceNavigation";

describe("space parent directory navigation", () => {
  it.each([
    ["D:\\Muller\\src", "D:\\Muller"],
    ["D:\\Muller\\", "D:\\"],
    ["D:/Muller/src/", "D:\\Muller"],
    ["D:\\", null],
    ["D:", null],
    ["\\\\server\\share\\folder", "\\\\server\\share"],
    ["\\\\server\\share\\", null],
    ["\\\\server", null],
    ["\\\\?\\D:\\Muller", "D:\\"],
    ["\\\\?\\UNC\\server\\share\\folder", "\\\\server\\share"],
    ["relative", null],
  ])("%s returns %s", (path, parent) => {
    expect(spaceParentPath(path)).toBe(parent);
  });
});
