import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  cancelDesktopScan,
  startDesktopScan,
  type DesktopScanSession,
} from "./scanClient";
import {
  createInitialScanState,
  scanStateReducer,
} from "./scanState";
import type { DesktopScanEvent, StartScanRequest } from "./types";

const TERMINAL_EVENTS = new Set<DesktopScanEvent["type"]>([
  "done",
  "cancelled",
  "error",
]);

function cancelWithoutBlocking(taskId: number): void {
  void cancelDesktopScan(taskId).catch(() => undefined);
}

export function useDedupScan() {
  const [state, dispatch] = useReducer(
    scanStateReducer,
    undefined,
    createInitialScanState,
  );
  const generationRef = useRef(0);
  const sessionRef = useRef<DesktopScanSession | null>(null);

  const start = useCallback(async (request: StartScanRequest) => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const previous = sessionRef.current;
    sessionRef.current = null;
    if (previous) cancelWithoutBlocking(previous.taskId);
    dispatch({ type: "start" });

    let terminal = false;
    try {
      const session = await startDesktopScan(request, (event) => {
        if (generationRef.current !== generation) return;
        terminal ||= TERMINAL_EVENTS.has(event.type);
        dispatch({ type: "event", event });
        if (terminal) sessionRef.current = null;
      });

      if (generationRef.current !== generation) {
        cancelWithoutBlocking(session.taskId);
        return;
      }
      if (!terminal) {
        dispatch({ type: "bindTask", taskId: session.taskId });
        sessionRef.current = session;
      }
    } catch (error) {
      if (generationRef.current !== generation) return;
      dispatch({
        type: "localError",
        message: error instanceof Error ? error.message : "Unable to start duplicate scan",
      });
    }
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    const session = sessionRef.current;
    sessionRef.current = null;
    dispatch({ type: "localCancel" });
    if (session) cancelWithoutBlocking(session.taskId);
  }, []);

  const removePaths = useCallback((paths: readonly string[]) => {
    dispatch({ type: "removePaths", paths });
  }, []);

  useEffect(
    () => () => {
      generationRef.current += 1;
      const session = sessionRef.current;
      if (session) cancelWithoutBlocking(session.taskId);
    },
    [],
  );

  return { state, start, cancel, removePaths };
}
