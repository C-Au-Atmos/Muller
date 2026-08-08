import { describe, expect, it } from "vitest";

import {
  applyMarqueeSelection,
  createSelectionState,
  moveSelectionFocus,
  reconcileSelection,
  selectAllPositions,
  selectPosition,
  toggleFocusedPosition,
} from "./selectionModel";

const plain = { ctrl: false, shift: false };

describe("Explorer selection model", () => {
  it("supports replacement, Ctrl toggling, and Shift ranges", () => {
    let state = selectPosition(createSelectionState(), 2, 10, plain, "two");
    state = selectPosition(state, 5, 10, { ctrl: true, shift: false }, "five");
    expect([...state.positions]).toEqual([2, 5]);

    state = selectPosition(state, 4, 10, { ctrl: false, shift: true }, "four");
    expect([...state.positions].sort((left, right) => left - right)).toEqual([4, 5]);
    expect(state.anchor).toBe(5);
    expect(state.focus).toBe(4);

    state = selectPosition(state, 5, 10, { ctrl: true, shift: false }, "five");
    expect([...state.positions]).toEqual([4]);
  });

  it("supports keyboard extension, Ctrl+Space, and Ctrl+A", () => {
    let state = moveSelectionFocus(createSelectionState(), 3, 8, false, "three");
    state = moveSelectionFocus(state, 6, 8, true, "six");
    expect([...state.positions]).toEqual([3, 4, 5, 6]);

    state = toggleFocusedPosition(state, 8, "six");
    expect(state.positions.has(6)).toBe(false);

    state = selectAllPositions(state, 8);
    expect(state.positions.size).toBe(8);
    expect(state.focus).toBe(6);
  });

  it("applies a repeatable marquee against its starting selection", () => {
    const baseline = selectPosition(createSelectionState(), 1, 20, plain, "one");
    const replacement = applyMarqueeSelection(baseline, new Set([4, 5, 6]), false, 20);
    expect([...replacement.positions]).toEqual([4, 5, 6]);

    const additive = applyMarqueeSelection(baseline, new Set([4, 5, 6]), true, 20);
    expect([...additive.positions]).toEqual([1, 4, 5, 6]);
  });

  it("drops positions outside a refreshed result set", () => {
    const all = selectAllPositions(createSelectionState(), 5);
    const reconciled = reconcileSelection(all, 3);
    expect([...reconciled.positions]).toEqual([0, 1, 2]);
    expect(reconciled.focus).toBe(0);
  });
});
