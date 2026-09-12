import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type { SpaceNode, SpaceSnifferClient } from "./types";

interface SpaceScanEvent {
  type: "started" | "batch" | "done" | "cancelled" | "error";
  taskId: number;
  root?: string;
  items?: Array<{
    path: string;
    parent: string | null;
    name: string;
    kind: "file" | "directory";
    bytes: number;
    depth: number;
    childCount: number;
    partial: boolean;
  }>;
  totalBytes?: number;
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

async function scanNative(path: string, signal?: AbortSignal): Promise<SpaceNode> {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
  const nodes = new Map<string, SpaceNode>();
  let taskId: number | null = null;
  let resolveDone: ((node: SpaceNode) => void) | null = null;
  let rejectDone: ((error: Error) => void) | null = null;
  const promise = new Promise<SpaceNode>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const channel = new Channel<SpaceScanEvent>((event) => {
    if (event.type === "started") taskId = event.taskId;
    if (event.type === "batch") {
      for (const item of event.items ?? []) {
        nodes.set(item.path, {
          id: item.path,
          name: item.name,
          path: item.path,
          kind: item.kind === "directory" ? "folder" : "file",
          size: item.bytes,
          children: item.kind === "directory" ? [] : undefined,
        });
      }
    } else if (event.type === "done") {
      const root: SpaceNode = {
        id: path,
        name: nodeName(path),
        path,
        kind: "folder",
        size: event.totalBytes ?? 0,
        children: [],
      };
      nodes.set(path, root);
      for (const node of nodes.values()) {
        if (node.id === path) continue;
        const separator = Math.max(node.path.lastIndexOf("\\"), node.path.lastIndexOf("/"));
        const parentPath = separator > 0 ? node.path.slice(0, separator) : path;
        const parentNode = nodes.get(parentPath) ?? root;
        if (parentNode.children && !parentNode.children.some((child) => child.id === node.id)) {
          parentNode.children = [...parentNode.children, node];
        }
      }
      resolveDone?.(root);
    } else if (event.type === "cancelled") {
      rejectDone?.(new DOMException("Scan cancelled", "AbortError"));
    } else if (event.type === "error") {
      rejectDone?.(new Error(event.message ?? "Space scan failed"));
    }
  });
  const abort = () => {
    if (taskId !== null) void invoke("cancel_space_scan", { taskId });
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await invoke<{ taskId: number }>("start_space_scan", {
      request: { root: path, batchSize: 256, maxDepth: 64 },
      onEvent: channel,
    });
    taskId = response.taskId;
    return await promise;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export const spaceSnifferClient: SpaceSnifferClient = {
  scan(path, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Scan cancelled", "AbortError"));
    return isTauri() ? scanNative(path, signal) : Promise.resolve(mockRoot(path));
  },
  openFolder(node: SpaceNode, signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Scan cancelled", "AbortError"));
    return isTauri() ? scanNative(node.path, signal) : Promise.resolve(mockRoot(node.path));
  },
};

export function formatSpaceBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount >= 100 || exponent === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[exponent]}`;
}
