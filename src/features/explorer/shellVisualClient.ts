import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export type ShellVisualPreference = "icon" | "thumbnail" | "thumbnail-or-icon";

export interface ShellVisual {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
  sourceBytes: number;
  modifiedUnixMs: number | null;
  visualType: string;
}

export type ShellVisualEvent =
  | { type: "started"; taskId: number; generation: number }
  | { type: "ready"; taskId: number; generation: number; visual: ShellVisual }
  | { type: "cancelled"; taskId: number; generation: number }
  | { type: "error"; taskId: number; generation: number; message: string };

export async function startShellVisual(
  path: string,
  logicalSize: number,
  preference: ShellVisualPreference,
  generation: number,
  theme: string,
  onEvent: (event: ShellVisualEvent) => void,
): Promise<number> {
  if (!isTauri()) throw new Error("Shell visuals require the Muller desktop runtime");
  const onEventChannel = new Channel<ShellVisualEvent>(onEvent);
  const response = await invoke<{ taskId: number }>("start_shell_visual", {
    request: {
      path,
      logicalSize,
      scaleFactor: window.devicePixelRatio || 1,
      preference,
      generation,
      theme,
    },
    onEvent: onEventChannel,
  });
  return response.taskId;
}

export async function cancelShellVisual(taskId: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_shell_visual", { taskId });
}
