export interface SpaceNode {
  id: string;
  name: string;
  path: string;
  /** `bytes` matches the Rust scanner payload; `size` is kept for local fixtures. */
  bytes?: number;
  size?: number;
  kind: "folder" | "file";
  children?: readonly SpaceNode[];
  parent?: string;
  depth?: number;
  childCount?: number;
  /** A directory is still being scanned; separate from incomplete/error results. */
  scanning?: boolean;
  partial?: boolean;
  extension?: string;
  modifiedAt?: number;
}

export interface SpaceScanProgress {
  scanned: number;
  total: number | null;
  phase: "idle" | "scanning" | "complete" | "error";
  totalBytes?: number;
  files?: number;
  directories?: number;
  skipped?: number;
  message?: string;
}

export type SpaceScanProgressCallback = (root: SpaceNode, progress: SpaceScanProgress) => void;

export interface SpaceSnifferClient {
  scan: (path: string, signal?: AbortSignal, onProgress?: SpaceScanProgressCallback) => Promise<SpaceNode>;
  openFolder?: (node: SpaceNode, signal?: AbortSignal, onProgress?: SpaceScanProgressCallback) => Promise<SpaceNode>;
}

export interface SpaceSnifferProps {
  root: SpaceNode;
  progress?: SpaceScanProgress;
  client?: SpaceSnifferClient;
  onCancelScan?: () => void;
  onOpenFolder?: (node: SpaceNode) => void;
  onSelectionChange?: (nodes: readonly SpaceNode[]) => void;
  onSoundEvent?: (event: "hover" | "select" | "open") => void;
  className?: string;
}
