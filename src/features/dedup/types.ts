export type ScanPhase =
  | "discovering"
  | "fingerprinting"
  | "full_hashing"
  | "complete";

export interface ScanProgress {
  phase: ScanPhase;
  processed: number;
  total: number | null;
  candidate_files: number;
  bytes_read: number;
}

export interface DuplicateFileEntry {
  path: string;
  size: number;
  created_unix_ms: number | null;
  modified_unix_ms: number | null;
  head_tail: string | null;
  full_hash: string | null;
  hard_link_count: number;
  locked: boolean;
}

export interface DuplicateGroup {
  full_hash: string;
  size: number;
  files: DuplicateFileEntry[];
  suggested_keep: number;
}

export interface SkippedFile {
  path: string;
  stage: "walk" | "metadata" | "identity" | "head_tail" | "full_hash";
  error: string;
  locked: boolean;
}

export interface ScanStats {
  files_seen: number;
  files_below_min_size: number;
  unique_size_files: number;
  size_candidate_files: number;
  head_tail_candidate_files: number;
  fully_hashed_files: number;
  physical_duplicates_skipped: number;
  blacklisted_entries_skipped: number;
  symlinks_skipped: number;
  bytes_read: number;
}

export type DesktopScanEvent =
  | { type: "started"; taskId: number }
  | { type: "progress"; taskId: number; progress: ScanProgress }
  | {
      type: "groupFound";
      taskId: number;
      groupIndex: number;
      group: DuplicateGroup;
    }
  | {
      type: "done";
      taskId: number;
      groupCount: number;
      groupOrder: string[];
      reclaimableBytes: number;
      skipped: SkippedFile[];
      stats: ScanStats;
    }
  | { type: "cancelled"; taskId: number }
  | { type: "error"; taskId: number; message: string };

export interface StartScanRequest {
  roots: string[];
  minSize: number;
  hashThreads?: number;
  blacklist?: string[];
}

export interface StartScanResponse {
  taskId: number;
}

export interface CancelScanResponse {
  taskId: number;
  cancelled: boolean;
}
