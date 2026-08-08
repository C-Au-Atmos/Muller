import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type { ThumbnailEvent } from "./types";

export async function startImageThumbnail(
  path: string,
  maxEdge: number,
  onEvent: (event: ThumbnailEvent) => void,
): Promise<number> {
  if (!isTauri()) throw new Error("Image thumbnails require the Muller desktop runtime");
  const channel = new Channel<ThumbnailEvent>(onEvent);
  const response = await invoke<{ taskId: number }>("start_image_thumbnail", {
    request: { path, maxEdge },
    onEvent: channel,
  });
  return response.taskId;
}

export async function cancelImageThumbnail(taskId: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_image_thumbnail", { taskId });
}
