import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type {
  BinaryDiffRange,
  FileDiffEvent,
  FolderDiffEvent,
  FolderDiffPageResponse,
  TextDiffPageResponse,
} from "./types";

export interface DiffTaskStart<T> {
  taskId: number;
  channel: Channel<T>;
}

function requireDesktop(): void {
  if (!isTauri()) throw new Error("File comparison requires the Muller desktop runtime");
}

export async function startFolderDiff(
  leftRoot: string,
  rightRoot: string,
  treatMtimeAsDiff: boolean,
  onEvent: (event: FolderDiffEvent) => void,
): Promise<DiffTaskStart<FolderDiffEvent>> {
  requireDesktop();
  const channel = new Channel<FolderDiffEvent>(onEvent);
  const response = await invoke<{ taskId: number }>("start_folder_diff", {
    request: { leftRoot, rightRoot, treatMtimeAsDiff },
    onEvent: channel,
  });
  return { taskId: response.taskId, channel };
}

export async function startFileDiff(
  leftPath: string,
  rightPath: string,
  onEvent: (event: FileDiffEvent) => void,
): Promise<DiffTaskStart<FileDiffEvent>> {
  requireDesktop();
  const channel = new Channel<FileDiffEvent>(onEvent);
  const response = await invoke<{ taskId: number }>("start_file_diff", {
    request: { leftPath, rightPath },
    onEvent: channel,
  });
  return { taskId: response.taskId, channel };
}

export async function cancelDiff(taskId: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_diff", { taskId });
}

export async function closeDiffSession(sessionId: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("close_diff_session", { sessionId });
}

export async function readFolderDiffPage(
  sessionId: number,
  offset: number,
  limit: number,
): Promise<FolderDiffPageResponse> {
  return invoke("read_folder_diff_page", { sessionId, offset, limit });
}

export async function readTextDiffPage(
  sessionId: number,
  offset: number,
  limit: number,
): Promise<TextDiffPageResponse> {
  return invoke("read_text_diff_page", { sessionId, offset, limit });
}

export async function readBinaryRange(
  sessionId: number,
  offset: number,
  length: number,
): Promise<BinaryDiffRange> {
  return invoke("read_binary_range", { sessionId, offset, length });
}

export async function findDiffPosition(
  sessionId: number,
  from: number,
  direction: 1 | -1,
): Promise<number | null> {
  return invoke("find_diff_position", { sessionId, from, direction });
}
