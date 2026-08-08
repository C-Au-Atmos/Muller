import { invoke, isTauri } from "@tauri-apps/api/core";

import type {
  EditSide,
  OpenEditSessionResponse,
  RollbackReport,
  SaveReport,
} from "./types";

function requireDesktop(): void {
  if (!isTauri()) throw new Error("Editing requires the Muller desktop runtime");
}

export async function openEditSession(
  leftPath: string,
  rightPath: string,
): Promise<OpenEditSessionResponse> {
  requireDesktop();
  return invoke("open_edit_session", {
    request: { leftPath, rightPath },
  });
}

export async function saveEditSide(
  sessionId: number,
  side: EditSide,
  text: string,
): Promise<SaveReport> {
  requireDesktop();
  return invoke("save_edit_side", {
    request: { sessionId, side, text },
  });
}

export async function rollbackEditSide(
  sessionId: number,
  side: EditSide,
): Promise<RollbackReport> {
  requireDesktop();
  return invoke("rollback_edit_side", {
    request: { sessionId, side },
  });
}

export async function closeEditSession(sessionId: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("close_edit_session", { sessionId });
}
