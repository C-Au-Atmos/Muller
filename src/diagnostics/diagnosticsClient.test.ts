import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
const pluginLog = vi.hoisted(() => ({
  debug: vi.fn<(message: string) => Promise<void>>(() => Promise.resolve()),
  error: vi.fn<(message: string) => Promise<void>>(() => Promise.resolve()),
  info: vi.fn<(message: string) => Promise<void>>(() => Promise.resolve()),
  warn: vi.fn<(message: string) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => tauri);
vi.mock("@tauri-apps/plugin-log", () => pluginLog);

import {
  diagnosticDebug,
  formatDiagnosticEvent,
  getDiagnosticsLogDirectory,
  getDiagnosticsStatus,
  initializeDiagnostics,
  reportDiagnosticError,
  setDebugLogging,
  type DiagnosticFields,
} from "./diagnosticsClient";

describe("diagnostics client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.isTauri.mockReturnValue(true);
  });

  it("formats only bounded event names and allowlisted scalar fields", () => {
    expect(formatDiagnosticEvent("ime.composition_end", {
      inputLength: 12,
      mode: "current",
      enabled: true,
    })).toBe("event=ime.composition_end enabled=true inputLength=12 mode=current");
    expect(formatDiagnosticEvent("C:\\Users\\secret\\query.txt", {
      errorKind: "Type Error",
    })).toBe("event=diagnostics.invalid_event errorKind=unknown");
    expect(formatDiagnosticEvent("search.input_event", {
      mode: "C:\\Users\\private",
      path: "C:\\Users\\private\\secret.txt",
      source: "address",
    } as DiagnosticFields & { path: string })).toBe(
      "event=search.input_event mode=unknown source=address",
    );
  });

  it("never serializes Error messages or unknown object contents", () => {
    reportDiagnosticError(
      "frontend.unhandled_error",
      new TypeError("C:\\Users\\private\\secret.txt"),
      { source: "window" },
    );

    expect(pluginLog.error).toHaveBeenCalledWith(
      "event=frontend.unhandled_error errorKind=TypeError source=window",
    );
    expect(pluginLog.error.mock.calls[0]?.[0]).not.toContain("secret");
  });

  it("normalizes native status and gates debug output by the effective level", async () => {
    tauri.invoke
      .mockResolvedValueOnce({
        debugEnabled: false,
        effectiveLevel: "info",
        logDirectory: "C:\\logs",
        error: null,
      })
      .mockResolvedValueOnce({
        debugEnabled: true,
        effectiveLevel: "debug",
        logDirectory: "C:\\logs",
        error: null,
      });

    await getDiagnosticsStatus();
    diagnosticDebug("ime.composition_start", { inputLength: 3 });
    expect(pluginLog.debug).not.toHaveBeenCalled();

    await setDebugLogging(true);
    diagnosticDebug("ime.composition_start", { inputLength: 3 });
    expect(pluginLog.debug).toHaveBeenCalledWith(
      "event=ime.composition_start inputLength=3",
    );
  });

  it("uses harmless browser fallbacks and does not invoke native commands", async () => {
    tauri.isTauri.mockReturnValue(false);

    await expect(getDiagnosticsStatus()).resolves.toMatchObject({
      debugEnabled: false,
      effectiveLevel: "info",
      logDirectory: null,
    });
    await expect(setDebugLogging(true)).resolves.toMatchObject({ debugEnabled: false });
    await expect(getDiagnosticsLogDirectory()).resolves.toBeNull();
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("reports initialized state without exposing native error messages", async () => {
    tauri.invoke.mockResolvedValue({
      debugEnabled: false,
      effectiveLevel: "info",
      logDirectory: null,
      error: {
        code: "diagnostics_file_unavailable",
        message: "C:\\Users\\private\\logs",
      },
    });

    await initializeDiagnostics();

    expect(pluginLog.info).toHaveBeenCalledWith(
      "event=frontend.initialized enabled=false status=diagnostics_file_unavailable",
    );
    expect(pluginLog.info.mock.calls[0]?.[0]).not.toContain("private");
  });
});
