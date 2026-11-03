import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => tauri);

import { recycleEntry, RecycleEntryChangedError } from "./fileOperationsClient";
import type { DirectoryEntry } from "./types";

const file: DirectoryEntry = {
  path: "D:\\Music\\Old\\響喜乱舞.zip",
  name: "響喜乱舞.zip",
  kind: "file",
  extension: "zip",
  size: 4096,
  modifiedUnixMs: 1_758_345_600_123,
  hidden: false,
};

describe("guarded recycle client", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue(file.path);
  });

  it("retains the observed file timestamp and size instead of re-reading a replacement file", async () => {
    await expect(recycleEntry(file)).resolves.toBe(file.path);
    expect(tauri.invoke).toHaveBeenCalledExactlyOnceWith("recycle_entry", {
      expectation: {
        path: file.path, kind: "file", size: 4096,
        modifiedUnixMs: 1_758_345_600_123, expectedBlake3: null,
      },
    });
  });

  it("sends directory timestamps with no recursive byte total", async () => {
    await recycleEntry({ ...file, kind: "directory", size: 987654321 });
    expect(tauri.invoke).toHaveBeenCalledExactlyOnceWith("recycle_entry", {
      expectation: {
        path: file.path, kind: "directory", size: 0,
        modifiedUnixMs: file.modifiedUnixMs, expectedBlake3: null,
      },
    });
  });

  it("preserves unavailable timestamps for strict native validation and never retries a changed file", async () => {
    tauri.invoke.mockRejectedValueOnce("entry changed since it was displayed; refresh and try again: \\\\?\\D:\\Music\\Old\\響喜乱舞.zip");
    await expect(recycleEntry({ ...file, modifiedUnixMs: null })).rejects.toMatchObject({
      name: "RecycleEntryChangedError", path: file.path,
    });
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith("recycle_entry", {
      expectation: { path: file.path, kind: "file", size: file.size, modifiedUnixMs: null, expectedBlake3: null },
    });
    expect(new RecycleEntryChangedError(file.path).message).not.toContain("edit session");
  });

  it("preserves unrelated native failures and refuses links before invoking the recycler", async () => {
    const failure = new Error("Access denied");
    tauri.invoke.mockRejectedValueOnce(failure);
    await expect(recycleEntry(file)).rejects.toBe(failure);
    await expect(recycleEntry({ ...file, kind: "symlink" })).rejects.toThrow("Symbolic links");
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
  });
});
