import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CompositionEvent,
  type FocusEvent,
  type InputEvent,
  type KeyboardEvent,
} from "react";

import {
  createImeInputState,
  isImeCompositionEvent,
  transitionImeInput,
  type ImeInputAction,
} from "../../input/imeInput";
import { diagnosticDebug } from "../../diagnostics/diagnosticsClient";

interface ImeAwareSearchInputProps extends Omit<
  ComponentPropsWithoutRef<"input">,
  "defaultValue" | "onChange" | "onCompositionEnd" | "onCompositionStart" | "value"
> {
  value: string;
  onValueChange: (value: string) => void;
  diagnosticMode?: string;
  diagnosticSource?: string;
}

export const ImeAwareSearchInput = forwardRef<
  HTMLInputElement,
  ImeAwareSearchInputProps
>(function ImeAwareSearchInput(
  {
    value,
    onValueChange,
    onBlur,
    onInput,
    onKeyDown,
    diagnosticMode = "current",
    diagnosticSource = "directory",
    ...inputProps
  },
  ref,
) {
  const stateRef = useRef(createImeInputState(value));
  const onValueChangeRef = useRef(onValueChange);
  const finalizeTimerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  const clearFinalizeTimer = useCallback(() => {
    if (finalizeTimerRef.current === null) return;
    window.clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = null;
  }, []);

  const applyAction = useCallback((action: ImeInputAction) => {
    const transition = transitionImeInput(stateRef.current, action);
    stateRef.current = transition.state;
    setDraft(transition.state.draft);
    if (transition.commit !== null) {
      diagnosticDebug("search.input_committed", {
        inputLength: transition.commit.length,
        mode: diagnosticMode,
        source: diagnosticSource,
      });
      onValueChangeRef.current(transition.commit);
    }
    return transition.state;
  }, [diagnosticMode, diagnosticSource]);

  const scheduleFinalCommit = useCallback(() => {
    clearFinalizeTimer();
    finalizeTimerRef.current = window.setTimeout(() => {
      finalizeTimerRef.current = null;
      applyAction({ type: "flush" });
    }, 0);
  }, [applyAction, clearFinalizeTimer]);

  useEffect(() => {
    const next = applyAction({ type: "external", value });
    if (!next.pendingCommit) clearFinalizeTimer();
  }, [applyAction, clearFinalizeTimer, value]);

  useEffect(() => clearFinalizeTimer, [clearFinalizeTimer]);

  const handleInput = (event: InputEvent<HTMLInputElement>) => {
    const isComposing = stateRef.current.composing || isImeCompositionEvent(event.nativeEvent);
    diagnosticDebug("search.input_event", {
      inputLength: event.currentTarget.value.length,
      mode: diagnosticMode,
      phase: isComposing ? "composition" : "committed",
      source: diagnosticSource,
    });
    const next = applyAction({
      type: "input",
      value: event.currentTarget.value,
      isComposing,
    });
    if (next.pendingCommit) scheduleFinalCommit();
    onInput?.(event);
  };

  const handleCompositionStart = () => {
    clearFinalizeTimer();
    diagnosticDebug("ime.composition_start", {
      inputLength: stateRef.current.draft.length,
      mode: diagnosticMode,
      source: diagnosticSource,
    });
    applyAction({ type: "composition-start" });
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    diagnosticDebug("ime.composition_end", {
      inputLength: event.currentTarget.value.length,
      mode: diagnosticMode,
      source: diagnosticSource,
    });
    const next = applyAction({
      type: "composition-end",
      value: event.currentTarget.value,
    });
    if (next.pendingCommit) scheduleFinalCommit();
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    clearFinalizeTimer();
    if (stateRef.current.composing || stateRef.current.pendingCommit) {
      diagnosticDebug("ime.composition_blur", {
        inputLength: stateRef.current.draft.length,
        mode: diagnosticMode,
        source: diagnosticSource,
      });
    }
    applyAction({ type: "blur" });
    onBlur?.(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const state = stateRef.current;
    if (state.composing || state.pendingCommit || isImeCompositionEvent(event.nativeEvent)) {
      diagnosticDebug("ime.candidate_key_ignored", {
        action: event.key === "Enter" || event.key === "Escape" ? event.key : "other",
        mode: diagnosticMode,
        source: diagnosticSource,
      });
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <input
      {...inputProps}
      ref={ref}
      value={draft}
      onBlur={handleBlur}
      onChange={() => undefined}
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
    />
  );
});
