import { invoke, isTauri } from "@tauri-apps/api/core";

import type {
  ConflictStrategy,
  DirectoryEntry,
  TransferMode,
  TransferReport,
} from "./types";

function requireDesktop(): void {
  if (!isTauri()) throw new Error("File operations require the Muller desktop runtime");
}

let nextTaskId = Date.now();

export async function transferEntry(
  source: string,
  destinationDirectory: string,
  mode: TransferMode,
  conflict: ConflictStrategy,
  onTaskId?: (taskId: number | null) => void,
): Promise<TransferReport> {
  requireDesktop();
  nextTaskId = (nextTaskId + 1) % Number.MAX_SAFE_INTEGER;
  const taskId = nextTaskId || 1;
  onTaskId?.(taskId);
  try {
    return await invoke("transfer_entry", {
      request: { taskId, source, destinationDirectory, mode, conflict },
    });
  } finally {
    onTaskId?.(null);
  }
}

export interface BatchTransferFailure {
  source: string;
  message: string;
}

export interface BatchTransferReport {
  reports: TransferReport[];
  failures: BatchTransferFailure[];
}

export async function transferDirectoryEntries(
  sourceSessionId: number,
  query: string,
  positions: readonly number[],
  destinationDirectory: string,
  mode: TransferMode,
  conflict: ConflictStrategy,
  onTaskId?: (taskId: number | null) => void,
): Promise<BatchTransferReport> {
  requireDesktop();
  nextTaskId = (nextTaskId + 1) % Number.MAX_SAFE_INTEGER;
  const taskId = nextTaskId || 1;
  onTaskId?.(taskId);
  try {
    return await invoke<BatchTransferReport>("transfer_directory_entries", {
      request: {
        taskId,
        sourceSessionId,
        query,
        positions,
        destinationDirectory,
        mode,
        conflict,
      },
    });
  } finally {
    onTaskId?.(null);
  }
}

export async function cancelFileOperation(taskId: number): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke("cancel_file_operation", { taskId });
}

export async function renameEntry(
  source: string,
  newName: string,
  conflict: ConflictStrategy,
): Promise<TransferReport> {
  requireDesktop();
  return invoke("rename_entry", {
    request: { source, newName, conflict },
  });
}

export async function recycleEntry(entry: DirectoryEntry): Promise<string> {
  requireDesktop();
  if (entry.kind !== "file" && entry.kind !== "directory") {
    throw new Error("Symbolic links and special entries cannot be recycled here");
  }
  return invoke("recycle_entry", {
    expectation: {
      path: entry.path,
      kind: entry.kind,
      size: entry.size,
      modifiedUnixMs: entry.modifiedUnixMs,
      expectedBlake3: null,
    },
  });
}

export type OpenPathOutcome = "opened" | "chooser_completed" | "chooser_cancelled";

export async function openNativePath(
  path: string,
  chooseApplication = false,
): Promise<OpenPathOutcome> {
  requireDesktop();
  return invoke<OpenPathOutcome>("open_native_path", { path, chooseApplication });
}

export type CreateEntryKind = "directory" | "text_file" | "empty_file";

export async function createEntry(directory: string, kind: CreateEntryKind): Promise<string> {
  requireDesktop();
  return invoke<string>("create_entry", { directory, kind });
}

export interface DirectoryStatistics {
  recursiveSize: number;
  childFileCount: number;
  childDirectoryCount: number;
}

export async function loadDirectoryStatistics(path: string): Promise<DirectoryStatistics> {
  requireDesktop();
  return invoke<DirectoryStatistics>("directory_statistics", { path });
}

export async function openTerminal(path: string): Promise<void> {
  requireDesktop();
  await invoke("open_terminal", { path });
}

async function runArchiveCommand(
  command: "create_zip" | "extract_zip",
  payload: Record<string, unknown>,
  onTaskId?: (taskId: number | null) => void,
): Promise<string> {
  requireDesktop();
  nextTaskId = (nextTaskId + 1) % Number.MAX_SAFE_INTEGER;
  const taskId = nextTaskId || 1;
  onTaskId?.(taskId);
  try {
    return await invoke<string>(command, { request: { taskId, ...payload } });
  } finally {
    onTaskId?.(null);
  }
}

export function createZip(
  sources: readonly string[],
  destinationDirectory: string,
  onTaskId?: (taskId: number | null) => void,
): Promise<string> {
  return runArchiveCommand("create_zip", { sources, destinationDirectory }, onTaskId);
}

export function extractZip(
  archive: string,
  destinationDirectory: string,
  mode: "current" | "named",
  onTaskId?: (taskId: number | null) => void,
): Promise<string> {
  return runArchiveCommand("extract_zip", { archive, destinationDirectory, mode }, onTaskId);
}
