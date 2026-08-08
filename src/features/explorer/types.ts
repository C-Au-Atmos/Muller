export type DirectoryEntryKind = "directory" | "file" | "symlink" | "other";

export interface DirectoryEntry {
  path: string;
  name: string;
  kind: DirectoryEntryKind;
  extension: string | null;
  size: number;
  modifiedUnixMs: number | null;
  hidden: boolean;
}

export type DirectorySortField = "name" | "type" | "size" | "modified";
export type DirectorySortDirection = "ascending" | "descending";
export type DirectorySearchMode = "current" | "recursive" | "global";

export interface DirectoryQueryFilter {
  extensions: string[];
  modifiedBeforeUnixMs: number | null;
  modifiedAfterUnixMs: number | null;
  filesOnly: boolean;
  sortBy: DirectorySortField;
  sortDirection: DirectorySortDirection;
}

export type DirectoryEvent =
  | { type: "started"; taskId: number }
  | {
      type: "ready";
      taskId: number;
      sessionId: number;
      path: string;
      parent: string | null;
      totalEntries: number;
    }
  | { type: "cancelled"; taskId: number }
  | { type: "error"; taskId: number; message: string };

export interface DirectoryPageResponse {
  sessionId: number;
  offset: number;
  totalEntries: number;
  entries: DirectoryEntry[];
}

export interface DirectorySearchPageResponse extends DirectoryPageResponse {
  query: string;
}

export type DirectoryStatus = "idle" | "loading" | "ready" | "cancelled" | "error";

export interface DirectoryPaneState {
  status: DirectoryStatus;
  taskId: number | null;
  sessionId: number | null;
  requestedPath: string;
  path: string;
  parent: string | null;
  totalEntries: number;
  entries: ReadonlyMap<number, DirectoryEntry>;
  error: string | null;
}

export type TransferMode = "copy" | "move";
export interface FileClipboardState {
  mode: TransferMode;
  entries: DirectoryEntry[];
}
export type ConflictStrategy = "fail" | "skip" | "keep_both" | "replace";
export type TransferOutcome = "copied" | "moved" | "skipped";

export interface TransferReport {
  source: string;
  destination: string;
  outcome: TransferOutcome;
  replaced: boolean;
  warning: string | null;
  sourceRetained: boolean;
}
