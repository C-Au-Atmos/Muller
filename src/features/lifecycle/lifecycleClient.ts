import { invoke, isTauri } from "@tauri-apps/api/core";

import type { CloseBehavior } from "../../preferences/preferencesModel";

export interface LifecycleError {
  code: string;
  message: string;
}

export interface AutostartStatus {
  enabled: boolean;
  error: LifecycleError | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readCloseBehavior(value: unknown): CloseBehavior {
  const record = asRecord(value);
  const behavior = record?.behavior ?? value;
  return behavior === "quit" || behavior === "exit" ? "quit" : "hide";
}

function readLifecycleError(value: unknown): LifecycleError | null {
  const record = asRecord(value);
  if (!record || typeof record.code !== "string" || typeof record.message !== "string") return null;
  return { code: record.code, message: record.message };
}

function readAutostartStatus(value: unknown): AutostartStatus {
  const record = asRecord(value);
  return {
    enabled: record?.enabled === true,
    error: readLifecycleError(record?.error),
  };
}

function commandError(error: unknown, fallback: string): Error {
  const lifecycleError = readLifecycleError(error);
  if (lifecycleError) {
    return Object.assign(new Error(lifecycleError.message), lifecycleError);
  }
  if (typeof error === "string" && error.trim()) return new Error(error);
  if (error instanceof Error && error.message) return error;
  return new Error(fallback);
}

export async function getCloseBehavior(): Promise<CloseBehavior | null> {
  if (!isTauri()) return null;
  try {
    return readCloseBehavior(await invoke("get_close_behavior"));
  } catch (error) {
    throw commandError(error, "Unable to read the close behavior");
  }
}

export async function setCloseBehavior(behavior: CloseBehavior): Promise<CloseBehavior> {
  if (!isTauri()) return behavior;
  try {
    return readCloseBehavior(await invoke("set_close_behavior", { behavior }));
  } catch (error) {
    throw commandError(error, "Unable to save the close behavior");
  }
}

export async function getAutostartStatus(): Promise<AutostartStatus> {
  if (!isTauri()) return { enabled: false, error: null };
  try {
    return readAutostartStatus(await invoke("get_autostart_status"));
  } catch (error) {
    return {
      enabled: false,
      error: {
        code: "autostart_status_failed",
        message: commandError(error, "Unable to read Windows startup registration").message,
      },
    };
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<AutostartStatus> {
  if (!isTauri()) return { enabled: false, error: null };
  try {
    return readAutostartStatus(await invoke("set_autostart_enabled", { enabled }));
  } catch (error) {
    throw commandError(error, "Unable to update Windows startup registration");
  }
}
