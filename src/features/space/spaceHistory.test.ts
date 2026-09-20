import { describe, expect, it } from "vitest";
import { retainSpaceHistory, SPACE_HISTORY_LIMIT, SPACE_HISTORY_NODE_BUDGET, spaceHistoryNodeCost } from "./spaceHistory";
import type { SpaceNode } from "./types";

function folder(path: string, children?: readonly SpaceNode[]): SpaceNode {
  return { id: path, path, name: path, kind: "folder", bytes: 10, children, scanning: false };
}

describe("bounded space history", () => {
  it("keeps recent small snapshots and path-only older locations within both budgets", () => {
    const sharedChildren = Array.from({ length: 1200 }, (_, index) => folder(`child-${index}`));
    const locations = Array.from({ length: 100 }, (_, index) => folder(`D:\\location-${index}`, sharedChildren));
    const back = retainSpaceHistory(locations, "back");
    expect(back).toHaveLength(SPACE_HISTORY_LIMIT);
    expect(back.at(-1)).toBe(locations.at(-1));
    expect(back[0]).toMatchObject({ path: locations[36]?.path, scanning: true });
    expect(back[0]?.children).toBeUndefined();
    expect(back.reduce((sum, node) => sum + spaceHistoryNodeCost(node), 0)).toBeLessThanOrEqual(SPACE_HISTORY_NODE_BUDGET);
    const forward = retainSpaceHistory(locations, "forward");
    expect(forward).toHaveLength(SPACE_HISTORY_LIMIT);
    expect(forward[0]).toBe(locations[0]);
    expect(forward.at(-1)).toMatchObject({ path: locations[63]?.path, scanning: true });
    expect(forward.reduce((sum, node) => sum + spaceHistoryNodeCost(node), 0)).toBeLessThanOrEqual(SPACE_HISTORY_NODE_BUDGET);
  });

  it("stops inspecting a huge tree at the budget and reuses the cost without traversing again", () => {
    let reads = 0;
    const child = folder("child");
    const children = new Proxy(Array<SpaceNode>(200_000), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) { reads += 1; return child; }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const huge = folder("D:\\huge", children);
    const cost = spaceHistoryNodeCost(huge);
    expect(cost).toBe(SPACE_HISTORY_NODE_BUDGET + 1);
    expect(reads).toBeLessThanOrEqual(SPACE_HISTORY_NODE_BUDGET);
    const previousReads = reads;
    expect(spaceHistoryNodeCost(huge)).toBe(cost);
    const retained = retainSpaceHistory([huge], "back");
    expect(reads).toBe(previousReads);
    expect(retained[0]?.children).toBeUndefined();
    expect(retained[0]?.scanning).toBe(true);
  });
});
