import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type { SpaceNode, SpaceScanProgress, SpaceScanProgressCallback, SpaceSnifferClient } from "./types";

interface SpaceScanItem {
  path: string;
  parent: string | null;
  name: string;
  kind: "file" | "directory";
  bytes: number;
  depth: number;
  childCount: number;
  partial: boolean;
  scanning?: boolean;
}

export interface SpaceScanEvent {
  type: "started" | "batch" | "done" | "cancelled" | "error";
  taskId: number;
  root?: string | SpaceScanItem;
  items?: SpaceScanItem[];
  totalBytes?: number;
  fileCount?: number;
  directoryCount?: number;
  skippedCount?: number;
  message?: string;
}

function nodeName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function mockRoot(path: string): SpaceNode {
  const fixtures: readonly [string, number][] = [
    ["Projects", 812 * 1024 ** 3],
    ["Media", 412 * 1024 ** 3],
    ["Archive", 304 * 1024 ** 3],
    ["Build cache", 218 * 1024 ** 3],
    ["Downloads", 140 * 1024 ** 3],
    ["Documents", 82 * 1024 ** 3],
    ["Other", 76 * 1024 ** 3],
  ];
  const children: SpaceNode[] = fixtures.map(([name, size]) => ({
    id: `${path}\\${name}`,
    name,
    path: `${path}\\${name}`,
    size,
    kind: "folder",
    children: [],
  }));
  return { id: path, name: nodeName(path), path, kind: "folder", size: children.reduce((sum, item) => sum + (item.size ?? 0), 0), children };
}

interface TreeEntry {
  node: SpaceNode;
  parent: TreeEntry | null;
  children: Map<string, TreeEntry>;
  snapshot: SpaceNode | null;
  dirty: boolean;
}

function pathKey(path: string): string {
  // All paths in a scan come from the same native root. Preserve filename case:
  // NTFS directories can opt into distinct names such as Report.txt/report.txt.
  return path.replaceAll("/", "\\").replace(/\\+$/, "") || "\\";
}

/** Parent indexes make upserts O(1); only dirty branches are copied on publication. */
class SpaceTree {
  private readonly entries = new Map<string, TreeEntry>();
  private readonly root: TreeEntry;
  private readonly rootKey: string;

  constructor(path: string) {
    this.rootKey = pathKey(path);
    this.root = this.create(path);
  }

  private create(path: string): TreeEntry {
    const entry: TreeEntry = {
      node: { id: path, path, name: nodeName(path), kind: "folder", bytes: 0, scanning: true },
      parent: null,
      children: new Map(),
      snapshot: null,
      dirty: true,
    };
    this.entries.set(pathKey(path), entry);
    return entry;
  }

  private invalidate(entry: TreeEntry) {
    entry.dirty = true;
    let ancestor = entry.parent;
    while (ancestor && !ancestor.dirty) {
      ancestor.dirty = true;
      ancestor = ancestor.parent;
    }
  }

  private ensure(path: string): TreeEntry {
    const key = pathKey(path);
    const previous = this.entries.get(key);
    if (previous) return previous;
    const entry = this.create(path);
    const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    const parentPath = separator > 0 ? path.slice(0, separator) : this.root.node.path;
    const parent = pathKey(parentPath) === key ? this.root : this.ensure(parentPath);
    entry.parent = parent;
    parent.children.set(key, entry);
    this.invalidate(parent);
    return entry;
  }

  upsert(item: SpaceScanItem) {
    const key = pathKey(item.path);
    // Reject malformed/out-of-root records rather than attaching them to the wrong tree.
    if (key !== this.rootKey && !key.startsWith(`${this.rootKey === "\\" ? "" : this.rootKey}\\`)) return;
    const entry = this.ensure(item.path);
    if (key !== this.rootKey && item.parent !== null) {
      const parentKey = pathKey(item.parent);
      if (parentKey !== key && (parentKey === this.rootKey || parentKey.startsWith(`${this.rootKey}\\`))) {
        const parent = this.ensure(item.parent);
        if (entry.parent !== parent) {
          if (entry.parent) {
            entry.parent.children.delete(key);
            this.invalidate(entry.parent);
          }
          parent.children.set(key, entry);
          entry.parent = parent;
          this.invalidate(parent);
        }
      }
    }
    entry.node = {
      id: item.path,
      name: item.name,
      path: item.path,
      kind: item.kind === "directory" ? "folder" : "file",
      bytes: item.bytes,
      size: item.bytes,
      parent: item.parent ?? undefined,
      depth: item.depth,
      childCount: item.childCount,
      partial: item.partial,
      scanning: item.scanning ?? false,
    };
    this.invalidate(entry);
  }

  updateRoot(bytes: number | undefined, complete = false) {
    this.root.node = { ...this.root.node, ...(bytes === undefined ? {} : { bytes, size: bytes }), ...(complete ? { scanning: false } : {}) };
    this.invalidate(this.root);
  }

  snapshot(): SpaceNode {
    const visit = (entry: TreeEntry): SpaceNode => {
      if (!entry.dirty && entry.snapshot) return entry.snapshot;
      entry.snapshot = {
        ...entry.node,
        children: entry.node.kind === "folder" ? Array.from(entry.children.values(), visit) : undefined,
      };
      entry.dirty = false;
      return entry.snapshot;
    };
    return visit(this.root);
  }
}

function scanNative(path: string, signal?: AbortSignal, onProgress?: SpaceScanProgressCallback): Promise<SpaceNode> {
  return new Promise<SpaceNode>((resolve, reject) => {
    const tree = new SpaceTree(path);
    let taskId: number | null = null;
    let cancelledTaskId: number | null = null;
    let settled = false;
    let aborted = false;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    let progress: SpaceScanProgress = { scanned: 0, total: null, phase: "scanning", totalBytes: 0, files: 0, directories: 0, skipped: 0 };

    const cancelTask = () => {
      if (taskId !== null && cancelledTaskId !== taskId) {
        cancelledTaskId = taskId;
        void invoke("cancel_space_scan", { taskId }).catch(() => undefined);
      }
    };
    const cleanup = () => {
      if (publishTimer !== undefined) clearTimeout(publishTimer);
      publishTimer = undefined;
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      aborted = true;
      cancelTask();
      fail(new DOMException("Scan cancelled", "AbortError"));
    };
    const publish = () => {
      publishTimer = undefined;
      if (!settled && !aborted) onProgress?.(tree.snapshot(), progress);
    };
    const updateProgress = (event: SpaceScanEvent, phase: SpaceScanProgress["phase"]) => {
      const files = event.fileCount ?? progress.files ?? 0;
      const directories = event.directoryCount ?? progress.directories ?? 0;
      progress = {
        scanned: files + directories,
        total: phase === "complete" ? files + directories : null,
        phase,
        totalBytes: event.totalBytes ?? progress.totalBytes,
        files,
        directories,
        skipped: event.skippedCount ?? progress.skipped,
      };
    };
    const channel = new Channel<SpaceScanEvent>((event) => {
      if (taskId === null) taskId = event.taskId;
      if (taskId !== event.taskId) return;
      if (aborted) { cancelTask(); return; }
      if (settled) return;
      if (event.type === "batch") {
        for (const item of event.items ?? []) tree.upsert(item);
        tree.updateRoot(event.totalBytes);
        updateProgress(event, "scanning");
        if (onProgress && publishTimer === undefined) publishTimer = setTimeout(publish, 100);
      } else if (event.type === "done") {
        if (event.root && typeof event.root !== "string") tree.upsert(event.root);
        tree.updateRoot(event.totalBytes, true);
        updateProgress(event, "complete");
        cleanup();
        const root = tree.snapshot();
        onProgress?.(root, progress);
        settled = true;
        resolve(root);
      } else if (event.type === "cancelled") {
        fail(new DOMException("Scan cancelled", "AbortError"));
      } else if (event.type === "error") {
        fail(new Error(event.message ?? "Space scan failed"));
      }
    });

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    publish();
    if (settled) return;
    // Do not await the start response before observing cancellation. It can arrive
    // after the user has left this view; then cancel the newly learned task ID.
    void invoke<{ taskId: number }>("start_space_scan", {
      request: { root: path, batchSize: 256, maxDepth: 64 },
      onEvent: channel,
    }).then((response) => {
      if (taskId === null) taskId = response.taskId;
      if (aborted) cancelTask();
    }).catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
  });
}

export const spaceSnifferClient: SpaceSnifferClient = {
  scan(path, signal, onProgress) {
    if (signal?.aborted) return Promise.reject(new DOMException("Scan cancelled", "AbortError"));
    if (isTauri()) return scanNative(path, signal, onProgress);
    const root = mockRoot(path);
    const count = root.children?.length ?? 0;
    onProgress?.(root, { scanned: count, total: count, phase: "complete", totalBytes: root.size, files: 0, directories: count, skipped: 0 });
    return Promise.resolve(root);
  },
  openFolder(node, signal, onProgress) {
    return spaceSnifferClient.scan(node.path, signal, onProgress);
  },
};

export function formatSpaceBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount >= 100 || exponent === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[exponent]}`;
}
