import type { Ref } from "react";

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

/** Operations shared with the browse context menu.
 *
 * Space view deliberately omits compare and split-pane actions, while the
 * remaining operations are surfaced through the host so they use the same
 * native file-operation pipeline as BrowseWorkspace.
 */
export type SpaceContextAction =
  | "open"
  | "open-with"
  | "locate"
  | "copy"
  | "cut"
  | "paste"
  | "copy-name"
  | "copy-path"
  | "open-terminal"
  | "extract-current"
  | "extract-named"
  | "extract-choose"
  | "compress-zip"
  | "rename"
  | "recycle"
  | "properties"
  | "refresh"
  | "new-folder"
  | "new-text-document"
  | "new-empty-file"
  | "custom-organize";

export interface SpaceSnifferHandle {
  up: () => void;
  back: () => void;
  forward: () => void;
  navigateActive: (path: string) => void;
  togglePreview: () => void;
}

export interface SpaceNavigationState {
  path: string;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
}

export interface SpaceSnifferProps {
  ref?: Ref<SpaceSnifferHandle>;
  onNavigationChange?: (navigation: SpaceNavigationState) => void;
  showBreadcrumbs?: boolean;
  mediaAutoplay?: boolean;
  onMediaAutoplayChange?: (enabled: boolean) => void;
  root: SpaceNode;
  /** Distinguishes a new host navigation/refresh from streamed updates at the same path. */
  rootRequestId?: number;
  progress?: SpaceScanProgress;
  client?: SpaceSnifferClient;
  onCancelScan?: () => void;
  onOpenFolder?: (node: SpaceNode) => void;
  onSelectionChange?: (nodes: readonly SpaceNode[]) => void;
  onSoundEvent?: (event: "hover" | "select" | "open") => void;
  onContextAction?: (action: SpaceContextAction, node: SpaceNode | null, selection?: readonly SpaceNode[]) => void;
  className?: string;
}
