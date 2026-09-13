import { invoke, isTauri } from "@tauri-apps/api/core";

export type NativeIndexerState = "disabled" | "starting" | "building" | "ready" | "degraded" | "error";

export interface NativeIndexerStatus {
  state: NativeIndexerState;
  entries: number;
  volumes: number;
  message: string | null;
  provider: string;
}

export const DISABLED_NATIVE_INDEXER: NativeIndexerStatus = {
  state: "disabled", entries: 0, volumes: 0, message: null, provider: "portable-snapshot-walker",
};

const NATIVE_STATES: readonly string[] = ["disabled", "starting", "building", "ready", "degraded", "error"];

export function nativeIndexerError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error);
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return Object.assign(new Error(error.message), error);
  }
  return new Error("Native indexer is unavailable");
}

export function isNativeIndexerCancelled(error: Error): boolean {
  const code = "code" in error ? String(error.code) : "";
  return /cancelled|canceled|取消|\b1223\b/i.test(`${code} ${error.message}`);
}

export async function getNativeIndexerStatus(): Promise<NativeIndexerStatus> {
  if (!isTauri()) return DISABLED_NATIVE_INDEXER;
  const response = await invoke<NativeIndexerStatus | null>("get_native_indexer_status");
  if (!response || !NATIVE_STATES.includes(response.state)
    || !Number.isSafeInteger(response.entries) || response.entries < 0
    || !Number.isSafeInteger(response.volumes) || response.volumes < 0
    || typeof response.provider !== "string"
    || (response.message !== null && typeof response.message !== "string")) {
    throw new Error("Native indexer returned an invalid status");
  }
  return response;
}

export async function enableNativeIndexer(roots: readonly string[]): Promise<void> {
  if (!isTauri()) throw new Error("Native indexing requires the Muller Windows app");
  if (roots.length === 0) throw new Error("No local drives are available for indexing");
  try {
    await invoke("enable_native_indexer", { roots });
  } catch (error) {
    throw nativeIndexerError(error);
  }
}

export async function stopNativeIndexer(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("stop_native_indexer");
  } catch (error) {
    throw nativeIndexerError(error);
  }
}
