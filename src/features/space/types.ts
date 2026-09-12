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
  extension?: string;
  modifiedAt?: number;
}

export interface SpaceScanProgress {
  scanned: number;
  total: number | null;
  phase: "idle" | "scanning" | "complete" | "error";
}

export interface SpaceSnifferClient {
  scan: (path: string, signal?: AbortSignal) => Promise<SpaceNode>;
  openFolder?: (node: SpaceNode, signal?: AbortSignal) => Promise<SpaceNode>;
}

export interface SpaceSnifferProps {
  root: SpaceNode;
  client?: SpaceSnifferClient;
  onOpenFolder?: (node: SpaceNode) => void;
  onSelectionChange?: (nodes: readonly SpaceNode[]) => void;
  onSoundEvent?: (event: "hover" | "select" | "open") => void;
  className?: string;
}
