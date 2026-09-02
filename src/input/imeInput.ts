export interface ImeEventDescriptor {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}

export function isImeCompositionEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const descriptor = event as ImeEventDescriptor;
  return descriptor.isComposing === true
    || descriptor.keyCode === 229
    || descriptor.which === 229;
}

export interface ImeInputState {
  draft: string;
  committed: string;
  composing: boolean;
  pendingCommit: boolean;
  invalidated: boolean;
  ignoreNextCompositionEnd: boolean;
}

export type ImeInputAction =
  | { type: "external"; value: string }
  | { type: "composition-start" }
  | { type: "input"; value: string; isComposing: boolean }
  | { type: "composition-end"; value: string }
  | { type: "flush" }
  | { type: "blur" };

export interface ImeInputTransition {
  state: ImeInputState;
  commit: string | null;
}

export function createImeInputState(value: string): ImeInputState {
  return {
    draft: value,
    committed: value,
    composing: false,
    pendingCommit: false,
    invalidated: false,
    ignoreNextCompositionEnd: false,
  };
}

function commitDraft(state: ImeInputState): ImeInputTransition {
  const next = {
    ...state,
    committed: state.draft,
    pendingCommit: false,
    invalidated: false,
    ignoreNextCompositionEnd: false,
  };
  return {
    state: next,
    commit: state.draft === state.committed ? null : state.draft,
  };
}

export function transitionImeInput(
  state: ImeInputState,
  action: ImeInputAction,
): ImeInputTransition {
  switch (action.type) {
    case "external": {
      if (action.value === state.committed) {
        return {
          state: state.composing || state.pendingCommit
            ? state
            : { ...state, draft: action.value },
          commit: null,
        };
      }
      if (state.composing) {
        return {
          state: {
            ...state,
            committed: action.value,
            invalidated: true,
          },
          commit: null,
        };
      }
      return {
        state: createImeInputState(action.value),
        commit: null,
      };
    }
    case "composition-start": {
      const flushed = state.pendingCommit ? commitDraft(state) : { state, commit: null };
      return {
        state: {
          ...flushed.state,
          composing: true,
          pendingCommit: false,
          invalidated: false,
          ignoreNextCompositionEnd: false,
        },
        commit: flushed.commit,
      };
    }
    case "input": {
      if (state.pendingCommit) {
        return {
          state: { ...state, draft: action.value },
          commit: null,
        };
      }
      if (state.composing || action.isComposing) {
        return {
          state: {
            ...state,
            draft: action.value,
            composing: true,
            pendingCommit: false,
            invalidated: state.composing ? state.invalidated : false,
            ignoreNextCompositionEnd: false,
          },
          commit: null,
        };
      }
      return {
        state: {
          ...state,
          draft: action.value,
          committed: action.value,
          ignoreNextCompositionEnd: false,
        },
        commit: action.value === state.committed ? null : action.value,
      };
    }
    case "composition-end": {
      if (state.ignoreNextCompositionEnd) {
        return {
          state: {
            ...state,
            draft: state.committed,
            composing: false,
            pendingCommit: false,
            ignoreNextCompositionEnd: false,
          },
          commit: null,
        };
      }
      if (state.invalidated) {
        return {
          state: {
            ...state,
            draft: state.committed,
            composing: false,
            pendingCommit: false,
            invalidated: false,
          },
          commit: null,
        };
      }
      return {
        state: {
          ...state,
          draft: action.value,
          composing: false,
          pendingCommit: action.value !== state.committed,
          invalidated: false,
        },
        commit: null,
      };
    }
    case "flush":
      return state.pendingCommit ? commitDraft(state) : { state, commit: null };
    case "blur": {
      if (state.pendingCommit) return commitDraft(state);
      if (!state.composing) return { state, commit: null };
      return {
        state: {
          ...state,
          draft: state.committed,
          composing: false,
          pendingCommit: false,
          invalidated: false,
          ignoreNextCompositionEnd: true,
        },
        commit: null,
      };
    }
  }
}
