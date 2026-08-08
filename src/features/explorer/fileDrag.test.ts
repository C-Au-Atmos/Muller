import { describe, expect, it } from "vitest";

import {
  parseInternalFileDrag,
  pathVolume,
  pathsMatch,
  transferModeForDrop,
} from "./fileDrag";

describe("Explorer file drag contract", () => {
  it("chooses move on one volume and copy across volumes unless modified", () => {
    expect(transferModeForDrop("D:\\source\\a.txt", "D:\\target", { ctrlKey: false, shiftKey: false })).toBe("move");
    expect(transferModeForDrop("D:\\source\\a.txt", "E:\\target", { ctrlKey: false, shiftKey: false })).toBe("copy");
    expect(transferModeForDrop("D:\\source\\a.txt", "D:\\target", { ctrlKey: true, shiftKey: false })).toBe("copy");
    expect(transferModeForDrop("D:\\source\\a.txt", "E:\\target", { ctrlKey: false, shiftKey: true })).toBe("move");
  });

  it("normalizes drive, UNC, and verbatim path identities", () => {
    expect(pathVolume("\\\\server\\share\\folder")).toBe("unc:server\\share");
    expect(pathVolume("\\\\?\\D:\\folder")).toBe("drive:d");
    expect(pathsMatch("D:\\Folder\\", "d:/folder")).toBe(true);
  });

  it("accepts only bounded session-based internal payloads", () => {
    const payload = parseInternalFileDrag(JSON.stringify({
      version: 1,
      sourceSessionId: 4,
      sourcePane: "left",
      query: "notes",
      positions: [2, 2, 9],
    }));
    expect(payload?.positions).toEqual([2, 9]);
    expect(parseInternalFileDrag('{"version":1,"sourceSessionId":0,"sourcePane":"left","query":"","positions":[0]}')).toBeNull();
    expect(parseInternalFileDrag("not-json")).toBeNull();
  });
});
