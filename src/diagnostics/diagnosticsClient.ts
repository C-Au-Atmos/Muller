import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  debug as pluginDebug,
  error as pluginError,
  info as pluginInfo,
  warn as pluginWarn,
} from "@tauri-apps/plugin-log";

export interface DiagnosticsError {
  code: string;
}

export interface DiagnosticsStatus {
  debugEnabled: boolean;
  effectiveLevel: "info" | "debug" | "trace";
  logDirectory: string | null;
  error: DiagnosticsError | null;
}

type DiagnosticField =
  | "action"
  | "active"
  | "count"
  | "durationMs"
  | "enabled"
  | "errorKind"
  | "generation"
  | "inputLength"
  | "mode"
  | "phase"
  | "recursive"
  | "resultCount"
  | "source"
  | "split"
  | "status";

export type DiagnosticFields = Partial<Record<DiagnosticField, string | number | boolean>>;
type DiagnosticLevel = "debug" | "info" | "warn" | "error";

const DIAGNOSTIC_EVENTS = new Set([
  "frontend.bootstrap_failed",
  "frontend.initialized",
  "frontend.rendered",
  "frontend.root_missing",
  "frontend.unhandled_error",
  "frontend.unhandled_rejection",
  "ime.candidate_key_ignored",
  "ime.composition_blur",
  "ime.composition_end",
  "ime.composition_start",
  "search.debounce_finished",
  "search.input_committed",
  "search.input_event",
  "search.page_failed",
  "search.page_ready",
  "search.roots_unavailable",
  "search.scheduled",
  "search.session_cancelled",
  "search.session_failed",
  "search.session_ready",
  "search.start_failed",
]);
const DIAGNOSTIC_FIELDS = new Set<DiagnosticField>([
  "action",
  "active",
  "count",
  "durationMs",
  "enabled",
  "errorKind",
  "generation",
  "inputLength",
  "mode",
  "phase",
  "recursive",
  "resultCount",
  "source",
  "split",
  "status",
]);
const STRING_FIELD_VALUES: Partial<Record<DiagnosticField, ReadonlySet<string>>> = {
  action: new Set(["Enter", "Escape", "other"]),
  errorKind: new Set([
    "AbortError",
    "AggregateError",
    "DOMException",
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "bigint",
    "boolean",
    "function",
    "null",
    "number",
    "object",
    "string",
    "symbol",
    "undefined",
    "unknown",
  ]),
  mode: new Set(["current", "global", "recursive"]),
  phase: new Set(["committed", "composition"]),
  source: new Set(["address", "directory", "promise", "shared", "window"]),
  status: new Set([
    "diagnostics_config_invalid",
    "diagnostics_file_unavailable",
    "diagnostics_logger_conflict",
    "diagnostics_logger_unavailable",
    "diagnostics_persistence_failed",
    "diagnostics_status_failed",
    "diagnostics_unavailable",
    "new",
    "ready",
    "replaced",
    "unknown",
  ]),
};
let debugActive = false;
let globalHandlersInstalled = false;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readError(value: unknown): DiagnosticsError | null {
  const record = asRecord(value);
  return record && typeof record.code === "string" ? { code: record.code } : null;
}

function readStatus(value: unknown): DiagnosticsStatus {
  const record = asRecord(value);
  const effectiveLevel = record?.effectiveLevel === "trace"
    ? "trace"
    : record?.effectiveLevel === "debug"
      ? "debug"
      : "info";
  return {
    debugEnabled: record?.debugEnabled === true,
    effectiveLevel,
    logDirectory: typeof record?.logDirectory === "string" ? record.logDirectory : null,
    error: readError(record?.error),
  };
}

function applyStatus(status: DiagnosticsStatus): DiagnosticsStatus {
  debugActive = status.effectiveLevel === "debug" || status.effectiveLevel === "trace";
  return status;
}

function browserStatus(): DiagnosticsStatus {
  return {
    debugEnabled: false,
    effectiveLevel: "info",
    logDirectory: null,
    error: null,
  };
}

function isDiagnosticField(value: string): value is DiagnosticField {
  return DIAGNOSTIC_FIELDS.has(value as DiagnosticField);
}

function safeStringField(field: DiagnosticField, value: string): string {
  const allowed = STRING_FIELD_VALUES[field];
  return allowed?.has(value) ? value : "unknown";
}

export function formatDiagnosticEvent(event: string, fields: DiagnosticFields = {}): string {
  const safeEvent = DIAGNOSTIC_EVENTS.has(event) ? event : "diagnostics.invalid_event";
  const entries = Object.entries(fields)
    .filter((entry): entry is [DiagnosticField, string | number | boolean] => {
      const [key, value] = entry;
      return isDiagnosticField(key) && (typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value)));
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const formatted = typeof value === "string"
        ? safeStringField(key, value)
        : typeof value === "number"
          ? String(Math.round(value))
          : String(value);
      return `${key}=${formatted}`;
    });
  return [`event=${safeEvent}`, ...entries].join(" ");
}

function write(level: DiagnosticLevel, event: string, fields?: DiagnosticFields): void {
  if (level === "debug" && !debugActive) return;
  const message = formatDiagnosticEvent(event, fields);
  const logger = level === "debug"
    ? pluginDebug
    : level === "info"
      ? pluginInfo
      : level === "warn"
        ? pluginWarn
        : pluginError;
  void logger(message).catch(() => undefined);
}

export function diagnosticDebug(event: string, fields?: DiagnosticFields): void {
  write("debug", event, fields);
}

export function diagnosticInfo(event: string, fields?: DiagnosticFields): void {
  write("info", event, fields);
}

export function diagnosticWarn(event: string, fields?: DiagnosticFields): void {
  write("warn", event, fields);
}

export function reportDiagnosticError(
  event: string,
  error: unknown,
  fields: DiagnosticFields = {},
): void {
  const errorKind = error instanceof Error
    ? error.name
    : error === null
      ? "null"
      : typeof error;
  write("error", event, { ...fields, errorKind });
}

export async function getDiagnosticsStatus(): Promise<DiagnosticsStatus> {
  if (!isTauri()) return applyStatus(browserStatus());
  try {
    return applyStatus(readStatus(await invoke("get_diagnostics_status")));
  } catch {
    return applyStatus({
      ...browserStatus(),
      error: { code: "diagnostics_status_failed" },
    });
  }
}

export async function setDebugLogging(enabled: boolean): Promise<DiagnosticsStatus> {
  if (!isTauri()) return applyStatus(browserStatus());
  try {
    return applyStatus(readStatus(await invoke("set_debug_logging", { enabled })));
  } catch {
    throw new Error("Unable to update diagnostic logging");
  }
}

export async function getDiagnosticsLogDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const directory = await invoke<unknown>("get_diagnostics_log_directory");
    return typeof directory === "string" ? directory : null;
  } catch {
    return null;
  }
}

export function installGlobalDiagnosticsHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;
  window.addEventListener("error", (event) => {
    reportDiagnosticError("frontend.unhandled_error", event.error, { source: "window" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportDiagnosticError("frontend.unhandled_rejection", event.reason, { source: "promise" });
  });
}

export async function initializeDiagnostics(): Promise<DiagnosticsStatus> {
  const status = await getDiagnosticsStatus();
  diagnosticInfo("frontend.initialized", {
    enabled: status.debugEnabled,
    status: status.error?.code ?? "ready",
  });
  return status;
}
