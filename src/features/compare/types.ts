export type FolderDiffPhase = "discovering" | "comparing" | "complete";
export type FolderDiffStatus =
  | "left_only"
  | "right_only"
  | "different"
  | "equal"
  | "metadata_only"
  | "error";
export type FolderEntryKind = "file" | "directory" | "other";

export interface FolderSide {
  path: string;
  size: number;
  modified_unix_ms: number | null;
}

export interface FolderDiffEntry {
  relative_path: string;
  kind: FolderEntryKind;
  left: FolderSide | null;
  right: FolderSide | null;
  status: FolderDiffStatus;
  error: string | null;
}

export interface FolderDiffStats {
  total_entries: number;
  equal: number;
  metadata_only: number;
  different: number;
  left_only: number;
  right_only: number;
  errors: number;
  hashed_files: number;
  bytes_hashed: number;
}

export interface FolderDiffProgress {
  phase: FolderDiffPhase;
  processed: number;
  total: number | null;
  bytes_hashed: number;
}

export type FolderDiffEvent =
  | { type: "started"; taskId: number }
  | { type: "progress"; taskId: number; progress: FolderDiffProgress }
  | {
      type: "ready";
      taskId: number;
      sessionId: number;
      totalEntries: number;
      issueCount: number;
      stats: FolderDiffStats;
    }
  | { type: "cancelled"; taskId: number }
  | { type: "error"; taskId: number; message: string };

export interface FolderDiffPageResponse {
  sessionId: number;
  offset: number;
  totalEntries: number;
  entries: FolderDiffEntry[];
}

export type FileDiffKind = "text" | "binary";
export type TextEncoding =
  | "utf8"
  | "utf8_bom"
  | "utf16_le"
  | "utf16_be"
  | "gbk"
  | "windows1252";
export type LineEnding = "none" | "lf" | "crlf" | "cr" | "mixed";

export interface FilePairInspection {
  left_path: string;
  right_path: string;
  kind: FileDiffKind;
  left_size: number;
  right_size: number;
  left_encoding: TextEncoding | null;
  right_encoding: TextEncoding | null;
  left_line_ending: LineEnding | null;
  right_line_ending: LineEnding | null;
}

export type FileDiffEvent =
  | { type: "started"; taskId: number }
  | {
      type: "ready";
      taskId: number;
      sessionId: number;
      inspection: FilePairInspection;
      totalRows: number | null;
    }
  | { type: "cancelled"; taskId: number }
  | { type: "error"; taskId: number; message: string };

export type TextDiffTag = "equal" | "insert" | "delete" | "replace";

export interface HighlightRange {
  start: number;
  end: number;
}

export interface TextDiffRow {
  tag: TextDiffTag;
  left_line_number: number | null;
  right_line_number: number | null;
  left_text: string | null;
  right_text: string | null;
  left_highlights: HighlightRange[];
  right_highlights: HighlightRange[];
}

export interface TextDiffPageResponse {
  sessionId: number;
  offset: number;
  totalRows: number;
  rows: TextDiffRow[];
}

export interface BinaryDiffRange {
  offset: number;
  left_size: number;
  right_size: number;
  left: number[];
  right: number[];
  different_indices: number[];
}

export type CompareStatus = "idle" | "loading" | "ready" | "cancelled" | "error";

export interface FileFingerprint {
  size: number;
  modified_unix_ms: number | null;
  blake3: string;
}

export interface EditableDocumentInfo {
  path: string;
  text: string;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  byteLen: number;
  fingerprint: FileFingerprint;
}

export interface OpenEditSessionResponse {
  sessionId: number;
  left: EditableDocumentInfo;
  right: EditableDocumentInfo;
}

export type EditSide = "left" | "right";

export interface SaveReport {
  path: string;
  backupPath: string;
  fingerprint: FileFingerprint;
}

export interface RollbackReport extends SaveReport {
  restoredFrom: string;
  text: string;
}
