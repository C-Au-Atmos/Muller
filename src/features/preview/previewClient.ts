import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type { PreviewEvent } from "./types";

export async function startFilePreview(
  path: string,
  onEvent: (event: PreviewEvent) => void,
): Promise<number> {
  if (!isTauri()) {
    throw new Error("File previews require the Muller desktop runtime");
  }
  const channel = new Channel<PreviewEvent>(onEvent);
  const response = await invoke<{ taskId: number }>("start_file_preview", {
    request: { path },
    onEvent: channel,
  });
  return response.taskId;
}

export async function cancelFilePreview(taskId: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_file_preview", { taskId });
}
