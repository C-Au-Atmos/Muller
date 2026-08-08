import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type {
  DirectoryEntry,
  DirectoryEvent,
  DirectoryPageResponse,
  DirectoryQueryFilter,
  DirectorySearchMode,
  DirectorySearchPageResponse,
} from "./types";

export interface DirectorySessionStart {
  taskId: number;
  channel: Channel<DirectoryEvent>;
}

export function isDesktopExplorerRuntime(): boolean {
  return isTauri();
}

export async function startDirectoryQuery(
  path: string,
  onEvent: (event: DirectoryEvent) => void,
  filter?: DirectoryQueryFilter,
): Promise<DirectorySessionStart> {
  if (!isDesktopExplorerRuntime()) {
    throw new Error("Directory browsing requires the Muller desktop runtime");
  }
  const channel = new Channel<DirectoryEvent>(onEvent);
  const response = await invoke<{ taskId: number }>("start_directory_query", {
    request: { path, filter },
    onEvent: channel,
  });
  return { taskId: response.taskId, channel };
}

export async function startDirectorySearch(
  roots: readonly string[],
  query: string,
  mode: Exclude<DirectorySearchMode, "current">,
  onEvent: (event: DirectoryEvent) => void,
  filter?: DirectoryQueryFilter,
): Promise<DirectorySessionStart> {
  if (!isDesktopExplorerRuntime()) {
    throw new Error("Directory search requires the Muller desktop runtime");
  }
  const channel = new Channel<DirectoryEvent>(onEvent);
  const response = await invoke<{ taskId: number }>("start_directory_search", {
    request: {
      roots,
      query,
      recursive: mode === "recursive" || mode === "global",
      indexed: mode === "global",
      filter,
    },
    onEvent: channel,
  });
  return { taskId: response.taskId, channel };
}

export async function warmGlobalSearchIndex(roots: readonly string[]): Promise<void> {
  if (!isDesktopExplorerRuntime() || roots.length === 0) return;
  await invoke("warm_global_search_index", { roots });
}

export async function cancelDirectoryQuery(taskId: number): Promise<void> {
  if (!isDesktopExplorerRuntime()) return;
  await invoke("cancel_directory_query", { taskId });
}

export async function readDirectoryPage(
  sessionId: number,
  offset: number,
  limit: number,
): Promise<DirectoryPageResponse> {
  return invoke<DirectoryPageResponse>("read_directory_page", {
    sessionId,
    offset,
    limit,
  });
}

export async function closeDirectorySession(sessionId: number): Promise<void> {
  if (!isDesktopExplorerRuntime()) return;
  await invoke("close_directory_session", { sessionId });
}

export async function searchDirectoryPage(
  sessionId: number,
  query: string,
  offset: number,
  limit: number,
): Promise<DirectorySearchPageResponse> {
  return invoke<DirectorySearchPageResponse>("search_directory_page", {
    sessionId,
    query,
    offset,
    limit,
  });
}

export async function resolveDirectoryEntries(
  sessionId: number,
  query: string,
  positions: readonly number[],
): Promise<DirectoryEntry[]> {
  return invoke<DirectoryEntry[]>("resolve_directory_entries", {
    request: { sessionId, query, positions },
  });
}

export interface LocatedDirectoryEntry {
  position: number;
  path: string;
}

export async function locateDirectoryEntry(
  sessionId: number,
  prefix: string,
  startAfter: number | null,
  query = "",
): Promise<LocatedDirectoryEntry | null> {
  return invoke<LocatedDirectoryEntry | null>("locate_directory_entry", {
    sessionId,
    prefix,
    startAfter,
    query,
  });
}

export interface DirectoryExtensionCount {
  extension: string;
  count: number;
}

export async function listDirectoryExtensions(path: string): Promise<DirectoryExtensionCount[]> {
  if (!isDesktopExplorerRuntime()) return [];
  const response = await invoke<unknown>("list_directory_extensions", { path });
  return Array.isArray(response) ? response as DirectoryExtensionCount[] : [];
}
