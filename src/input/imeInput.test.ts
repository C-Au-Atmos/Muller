import { describe, expect, it } from "vitest";

import {
  createImeInputState,
  isImeCompositionEvent,
  transitionImeInput,
  type ImeInputAction,
  type ImeInputState,
} from "./imeInput";

function apply(
  state: ImeInputState,
  action: ImeInputAction,
): [ImeInputState, string | null] {
  const transition = transitionImeInput(state, action);
  return [transition.state, transition.commit];
}

describe("IME event detection", () => {
  it("recognizes standard composition and the WebView2 229 fallback", () => {
    expect(isImeCompositionEvent({ isComposing: true })).toBe(true);
    expect(isImeCompositionEvent({ keyCode: 229 })).toBe(true);
    expect(isImeCompositionEvent({ which: 229 })).toBe(true);
    expect(isImeCompositionEvent({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeCompositionEvent(null)).toBe(false);
  });
});

describe("IME-aware input state", () => {
  it("commits ordinary input immediately and ignores an identical value", () => {
    let state = createImeInputState("");
    let commit: string | null;
    [state, commit] = apply(state, { type: "input", value: "Alpha", isComposing: false });
    expect(commit).toBe("Alpha");
    [state, commit] = apply(state, { type: "input", value: "Alpha", isComposing: false });
    expect(commit).toBeNull();
    expect(state.draft).toBe("Alpha");
  });

  it("keeps pre-edit text local and commits the final value once", () => {
    let state = createImeInputState("Alpha");
    let commit: string | null;
    [state] = apply(state, { type: "composition-start" });
    [state, commit] = apply(state, { type: "input", value: "Alphaz", isComposing: true });
    expect(commit).toBeNull();
    [state, commit] = apply(state, { type: "input", value: "Alphazhong", isComposing: false });
    expect(commit).toBeNull();
    expect(state.draft).toBe("Alphazhong");

    [state, commit] = apply(state, { type: "composition-end", value: "Alpha\u4e2d" });
    expect(commit).toBeNull();
    expect(state.pendingCommit).toBe(true);
    [state, commit] = apply(state, { type: "input", value: "Alpha\u4e2d", isComposing: false });
    expect(commit).toBeNull();
    [state, commit] = apply(state, { type: "flush" });
    expect(commit).toBe("Alpha\u4e2d");
    [state, commit] = apply(state, { type: "flush" });
    expect(commit).toBeNull();
  });

  it("uses the trailing final input when compositionend still exposes pre-edit text", () => {
    let state = createImeInputState("");
    let commit: string | null;
    [state] = apply(state, { type: "composition-start" });
    [state] = apply(state, { type: "input", value: "zhong", isComposing: true });
    [state] = apply(state, { type: "composition-end", value: "zhong" });
    [state, commit] = apply(state, { type: "input", value: "\u4e2d", isComposing: false });
    expect(commit).toBeNull();
    [state, commit] = apply(state, { type: "flush" });
    expect(commit).toBe("\u4e2d");
    expect(state.draft).toBe("\u4e2d");
  });

  it("flushes the final value when a trailing WebView2 input still reports composing", () => {
    let state = createImeInputState("");
    let commit: string | null;
    [state] = apply(state, { type: "composition-start" });
    [state] = apply(state, { type: "composition-end", value: "wei" });
    [state, commit] = apply(state, { type: "input", value: "\u5fae", isComposing: true });
    expect(commit).toBeNull();
    expect(state.pendingCommit).toBe(true);
    [state, commit] = apply(state, { type: "flush" });
    expect(commit).toBe("\u5fae");
  });

  it("discards an unfinished composition on blur and ignores its stale end event", () => {
    let state = createImeInputState("saved");
    let commit: string | null;
    [state] = apply(state, { type: "composition-start" });
    [state] = apply(state, { type: "input", value: "savedpin", isComposing: true });
    [state, commit] = apply(state, { type: "blur" });
    expect(commit).toBeNull();
    expect(state.draft).toBe("saved");
    [state, commit] = apply(state, { type: "composition-end", value: "saved\u62fc" });
    expect(commit).toBeNull();
    expect(state.draft).toBe("saved");

    [state, commit] = apply(state, { type: "input", value: "saved-next", isComposing: false });
    expect(commit).toBe("saved-next");
  });

  it("flushes a completed composition when blur follows compositionend", () => {
    let state = createImeInputState("");
    [state] = apply(state, { type: "composition-start" });
    [state] = apply(state, { type: "composition-end", value: "\u5fae\u4fe1" });
    const [blurredState, commit] = apply(state, { type: "blur" });
    state = blurredState;
    expect(commit).toBe("\u5fae\u4fe1");
    expect(state.pendingCommit).toBe(false);
  });

  it("does not let a stale composition overwrite a newer external value", () => {
    let state = createImeInputState("old");
    [state] = apply(state, { type: "composition-start" });
    [state] = apply(state, { type: "input", value: "oldpin", isComposing: true });
    [state] = apply(state, { type: "external", value: "new" });
    const [endedState, commit] = apply(state, { type: "composition-end", value: "old\u62fc" });
    state = endedState;
    expect(commit).toBeNull();
    expect(state.draft).toBe("new");
    expect(state.committed).toBe("new");
  });
});
