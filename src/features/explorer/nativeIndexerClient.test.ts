import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => tauri);

import { enableNativeIndexer, getNativeIndexerStatus, isNativeIndexerCancelled, stopNativeIndexer } from "./nativeIndexerClient";

describe("native indexer client", () => {
  beforeEach(() => { vi.clearAllMocks(); tauri.isTauri.mockReturnValue(true); });

  it("reads status without starting an elevated process", async () => {
    const status = { state: "building", entries: 12000, volumes: 1, message: null, provider: "ntfs-mft-usn" };
    tauri.invoke.mockResolvedValueOnce(status);
    await expect(getNativeIndexerStatus()).resolves.toEqual(status);
    expect(tauri.invoke).toHaveBeenCalledExactlyOnceWith("get_native_indexer_status");
  });

  it("only enables when explicitly called with local roots", async () => {
    await expect(enableNativeIndexer([])).rejects.toThrow("No local drives");
    expect(tauri.invoke).not.toHaveBeenCalled();
    tauri.invoke.mockResolvedValueOnce(undefined);
    await enableNativeIndexer(["C:\\", "D:\\"]);
    expect(tauri.invoke).toHaveBeenCalledExactlyOnceWith("enable_native_indexer", { roots: ["C:\\", "D:\\"] });
  });

  it("never invokes the index service from the browser preview", async () => {
    tauri.isTauri.mockReturnValue(false);
    await expect(getNativeIndexerStatus()).resolves.toMatchObject({ state: "disabled", entries: 0 });
    await expect(enableNativeIndexer(["D:\\"])).rejects.toThrow("Windows app");
    await stopNativeIndexer();
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("stops an active native build without a new elevation request", async () => {
    tauri.invoke.mockResolvedValueOnce(undefined);
    await stopNativeIndexer();
    expect(tauri.invoke).toHaveBeenCalledExactlyOnceWith("stop_native_indexer");
  });

  it("preserves UAC cancellation and distinguishes service failure", async () => {
    tauri.invoke.mockRejectedValueOnce({ code: 1223, message: "The operation was canceled by the user" });
    const error = await enableNativeIndexer(["D:\\"]).catch((value: Error) => value);
    expect(error).toBeInstanceOf(Error);
    expect(isNativeIndexerCancelled(error as Error)).toBe(true);
    expect(isNativeIndexerCancelled(new Error("Pipe connection timed out"))).toBe(false);
  });

  it("rejects malformed status instead of displaying a false ready state", async () => {
    tauri.invoke.mockResolvedValueOnce(null).mockResolvedValueOnce({ state: "ready", entries: -1, volumes: 1, message: null, provider: "ntfs-mft-usn" });
    await expect(getNativeIndexerStatus()).rejects.toThrow("invalid status");
    await expect(getNativeIndexerStatus()).rejects.toThrow("invalid status");
  });
});
