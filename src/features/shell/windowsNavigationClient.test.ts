import { describe, expect, it } from "vitest";

import {
  selectInitialDirectory,
  shouldCompleteDirectoryPath,
  type LogicalDrive,
  type ShellLocation,
} from "./windowsNavigationClient";

const drives: LogicalDrive[] = [{
  path: "E:\\",
  label: "Data",
  fileSystem: "NTFS",
  driveType: "fixed",
  totalBytes: null,
  freeBytes: null,
}];

describe("Windows initial directory", () => {
  it("prefers the user profile over other shell locations and drives", () => {
    const locations: ShellLocation[] = [
      { id: "desktop", label: "Desktop", path: "C:\\Users\\Ada\\Desktop" },
      { id: "profile", label: "Profile", path: "C:\\Users\\Ada" },
    ];
    expect(selectInitialDirectory(locations, drives)).toBe("C:\\Users\\Ada");
  });

  it("falls back to a usable drive and then the This PC sentinel", () => {
    expect(selectInitialDirectory([], drives)).toBe("E:\\");
    expect(selectInitialDirectory([], [])).toBe("");
  });
});

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
