import type { SpaceNode } from "./types";
import { displayPath } from "../explorer/pathDisplay";

export const SPACE_HISTORY_LIMIT = 64;
export const SPACE_HISTORY_NODE_BUDGET = 5_000;
const nodeCosts = new WeakMap<SpaceNode, number>();

function mutationPathKey(path: string): string {
  return displayPath(path).replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase("en-US");
}

/** Conservatively invalidate Windows aliases, with directory separator boundaries. */
export function spacePathAffected(path: string, changedPaths: readonly string[]): boolean {
  const key = mutationPathKey(path);
  if (!key) return false;
  return changedPaths.some((changedPath) => {
    const changed = mutationPathKey(changedPath);
    return changed !== "" && (key === changed || key.startsWith(`${changed}\\`) || changed.startsWith(`${key}\\`));
  });
}

/** A file operation invalidates totals as well as the child list; never walk old trees. */
export function invalidateSpaceHistory(history: readonly SpaceNode[], changedPaths: readonly string[]): readonly SpaceNode[] {
  return history.map((node) => spacePathAffected(node.path, changedPaths)
    ? { id: node.id, path: node.path, name: node.name, kind: node.kind, scanning: true }
    : node);
}

/** Count only as far as the retention budget, without copying a wide child list. */
export function spaceHistoryNodeCost(root: SpaceNode): number {
  const known = nodeCosts.get(root);
  if (known !== undefined) return known;
  let count = 0;
  const stack = [{ nodes: [root] as readonly SpaceNode[], index: 0 }];
  while (stack.length && count <= SPACE_HISTORY_NODE_BUDGET) {
    const frame = stack[stack.length - 1]!;
    const node = frame.nodes[frame.index++];
    if (!node) { stack.pop(); continue; }
    count += 1;
    if (node.children?.length) stack.push({ nodes: node.children, index: 0 });
  }
  nodeCosts.set(root, count);
  return count;
}

/** A history location can be revisited by scanning; it need not own an old tree. */
export function spaceHistoryLocation(root: SpaceNode): SpaceNode {
  return {
    id: root.id, path: root.path, name: root.name, kind: root.kind,
    bytes: root.bytes, size: root.size, modifiedAt: root.modifiedAt,
    childCount: root.childCount, scanning: true,
  };
}

export function retainSpaceHistory(history: readonly SpaceNode[], direction: "back" | "forward"): readonly SpaceNode[] {
  const retained = direction === "back" ? history.slice(-SPACE_HISTORY_LIMIT) : history.slice(0, SPACE_HISTORY_LIMIT);
  let remaining = SPACE_HISTORY_NODE_BUDGET;
  for (let offset = 0; offset < retained.length; offset += 1) {
    const index = direction === "back" ? retained.length - offset - 1 : offset;
    const node = retained[index]!;
    const cost = spaceHistoryNodeCost(node);
    const available = remaining - (retained.length - offset - 1);
    if (cost > available) retained[index] = spaceHistoryLocation(node);
    remaining -= cost > available ? 1 : cost;
  }
  return retained;
}
