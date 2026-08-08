import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type {
  CancelScanResponse,
  DesktopScanEvent,
  StartScanRequest,
  StartScanResponse,
} from "./types";

export interface DesktopScanSession {
  taskId: number;
  channel: Channel<DesktopScanEvent>;
}

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export async function startDesktopScan(
  request: StartScanRequest,
  onEvent: (event: DesktopScanEvent) => void,
): Promise<DesktopScanSession> {
  if (!isDesktopRuntime()) {
    throw new Error("Filesystem scanning requires the Muller desktop runtime");
  }

  const channel = new Channel<DesktopScanEvent>(onEvent);
  const response = await invoke<StartScanResponse>("start_scan", {
    request,
    onEvent: channel,
  });
  return { taskId: response.taskId, channel };
}

export async function cancelDesktopScan(taskId: number): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  const response = await invoke<CancelScanResponse>("cancel_scan", { taskId });
  return response.cancelled;
}

