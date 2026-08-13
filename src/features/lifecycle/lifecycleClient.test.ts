import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import {
  getAutostartStatus,
  getCloseBehavior,
  setAutostartEnabled,
  setCloseBehavior,
} from "./lifecycleClient";

describe("desktop lifecycle client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.isTauri.mockReturnValue(true);
  });

  it("uses harmless browser fallbacks outside Tauri", async () => {
    tauri.isTauri.mockReturnValue(false);

    await expect(getCloseBehavior()).resolves.toBeNull();
    await expect(setCloseBehavior("quit")).resolves.toBe("quit");
    await expect(getAutostartStatus()).resolves.toEqual({ enabled: false, error: null });
    await expect(setAutostartEnabled(true)).resolves.toEqual({ enabled: false, error: null });
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("normalizes native close behavior and autostart responses", async () => {
    tauri.invoke
      .mockResolvedValueOnce({ behavior: "exit" })
      .mockResolvedValueOnce({ behavior: "quit" })
      .mockResolvedValueOnce({ enabled: true, error: null })
      .mockResolvedValueOnce({ enabled: false, error: null });

    await expect(getCloseBehavior()).resolves.toBe("quit");
    await expect(setCloseBehavior("quit")).resolves.toBe("quit");
    await expect(getAutostartStatus()).resolves.toEqual({ enabled: true, error: null });
    await expect(setAutostartEnabled(false)).resolves.toEqual({ enabled: false, error: null });
    expect(tauri.invoke).toHaveBeenNthCalledWith(2, "set_close_behavior", { behavior: "quit" });
    expect(tauri.invoke).toHaveBeenNthCalledWith(4, "set_autostart_enabled", { enabled: false });
  });

  it("preserves structured errors without guessing the Windows state", async () => {
    tauri.invoke
      .mockRejectedValueOnce({ code: "autostart_failed", message: "registry denied" })
      .mockRejectedValueOnce({ code: "autostart_failed", message: "registry denied" });

    await expect(getAutostartStatus()).resolves.toEqual({
      enabled: false,
      error: { code: "autostart_status_failed", message: "registry denied" },
    });
    await expect(setAutostartEnabled(true)).rejects.toThrow("registry denied");
  });
});
