export interface SelectionState {
  positions: ReadonlySet<number>;
  keysByPosition: ReadonlyMap<number, string>;
  anchor: number | null;
  focus: number | null;
}

export interface SelectionModifiers {
  ctrl: boolean;
  shift: boolean;
}

export function createSelectionState(): SelectionState {
  return {
    positions: new Set(),
    keysByPosition: new Map(),
    anchor: null,
    focus: null,
  };
}

function clampPosition(position: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(Math.max(Math.trunc(position), 0), total - 1);
}

function rangeBetween(left: number, right: number): Set<number> {
  const start = Math.min(left, right);
  const end = Math.max(left, right);
  return new Set(Array.from({ length: end - start + 1 }, (_, offset) => start + offset));
}

function retainKnownKeys(
  positions: ReadonlySet<number>,
  current: ReadonlyMap<number, string>,
  known?: ReadonlyMap<number, string>,
): Map<number, string> {
  const next = new Map<number, string>();
  for (const position of positions) {
    const key = known?.get(position) ?? current.get(position);
    if (key) next.set(position, key);
  }
  return next;
}

export function selectPosition(
  state: SelectionState,
  position: number,
  total: number,
  modifiers: SelectionModifiers,
  key?: string,
): SelectionState {
  const target = clampPosition(position, total);
  if (target === null) return createSelectionState();

  if (modifiers.shift) {
    const anchor = state.anchor ?? state.focus ?? target;
    const range = rangeBetween(anchor, target);
    const positions = modifiers.ctrl
      ? new Set([...state.positions, ...range])
      : range;
    const known = key ? new Map([[target, key]]) : undefined;
    return {
      positions,
      keysByPosition: retainKnownKeys(positions, state.keysByPosition, known),
      anchor,
      focus: target,
    };
  }

  if (modifiers.ctrl) {
    const positions = new Set(state.positions);
    const keysByPosition = new Map(state.keysByPosition);
    if (positions.has(target)) {
      positions.delete(target);
      keysByPosition.delete(target);
    } else {
      positions.add(target);
      if (key) keysByPosition.set(target, key);
    }
    return {
      positions,
      keysByPosition,
      anchor: target,
      focus: target,
    };
  }

  return {
    positions: new Set([target]),
    keysByPosition: key ? new Map([[target, key]]) : new Map(),
    anchor: target,
    focus: target,
  };
}

export function moveSelectionFocus(
  state: SelectionState,
  position: number,
  total: number,
  extend: boolean,
  key?: string,
): SelectionState {
  return selectPosition(
    state,
    position,
    total,
    { ctrl: false, shift: extend },
    key,
  );
}

export function selectAllPositions(
  state: SelectionState,
  total: number,
): SelectionState {
  const positions = new Set(Array.from({ length: Math.max(0, total) }, (_, position) => position));
  const focus = state.focus !== null && state.focus < total
    ? state.focus
    : total > 0
      ? 0
      : null;
  return {
    positions,
    keysByPosition: retainKnownKeys(positions, state.keysByPosition),
    anchor: focus,
    focus,
  };
}

export function toggleFocusedPosition(
  state: SelectionState,
  total: number,
  key?: string,
): SelectionState {
  if (state.focus === null) return state;
  return selectPosition(state, state.focus, total, { ctrl: true, shift: false }, key);
}

export function applyMarqueeSelection(
  baseline: SelectionState,
  positionsInRectangle: ReadonlySet<number>,
  additive: boolean,
  total: number,
): SelectionState {
  const hits = new Set(
    [...positionsInRectangle].filter((position) => position >= 0 && position < total),
  );
  const positions = additive
    ? new Set([...baseline.positions, ...hits])
    : hits;
  const focus = hits.size > 0 ? [...hits].at(-1) ?? null : baseline.focus;
  return {
    positions,
    keysByPosition: retainKnownKeys(positions, baseline.keysByPosition),
    anchor: additive ? baseline.anchor : focus,
    focus,
  };
}

export function hydrateSelectionKey(
  state: SelectionState,
  position: number,
  key: string,
): SelectionState {
  if (!state.positions.has(position) || state.keysByPosition.get(position) === key) return state;
  const keysByPosition = new Map(state.keysByPosition);
  keysByPosition.set(position, key);
  return { ...state, keysByPosition };
}

export function reconcileSelection(
  state: SelectionState,
  total: number,
): SelectionState {
  if (total <= 0) return createSelectionState();
  const positions = new Set([...state.positions].filter((position) => position < total));
  const focus = state.focus === null ? null : clampPosition(state.focus, total);
  const anchor = state.anchor === null ? focus : clampPosition(state.anchor, total);
  return {
    positions,
    keysByPosition: retainKnownKeys(positions, state.keysByPosition),
    anchor,
    focus,
  };
}

export function selectionCount(state: SelectionState): number {
  return state.positions.size;
}

