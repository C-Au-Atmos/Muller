import { useCallback, useEffect, useRef, useState } from "react";

import { isPageLoaded, mergePage, pagesForRange } from "../paging/pagedData";

import {
  cancelDiff,
  closeDiffSession,
  findDiffPosition,
  readBinaryRange,
  readTextDiffPage,
  startFileDiff,
} from "./compareClient";
import type {
  BinaryDiffRange,
  CompareStatus,
  FilePairInspection,
  TextDiffRow,
} from "./types";

const TEXT_PAGE_SIZE = 256;
export const BINARY_PAGE_SIZE = 4096;

function ignoreFailure(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export interface FileDiffState {
  status: CompareStatus;
  taskId: number | null;
  sessionId: number | null;
  inspection: FilePairInspection | null;
  totalRows: number;
  rows: ReadonlyMap<number, TextDiffRow>;
  binary: BinaryDiffRange | null;
  error: string | null;
}

const INITIAL_STATE: FileDiffState = {
  status: "idle",
  taskId: null,
  sessionId: null,
  inspection: null,
  totalRows: 0,
  rows: new Map(),
  binary: null,
  error: null,
};

export function useFileDiff() {
  const [state, setState] = useState(INITIAL_STATE);
  const generationRef = useRef(0);
  const taskRef = useRef<number | null>(null);
  const sessionRef = useRef<number | null>(null);
  const loadingPagesRef = useRef(new Set<number>());

  const loadTextPage = useCallback(
    async (sessionId: number, page: number, generation: number) => {
      if (loadingPagesRef.current.has(page)) return;
      loadingPagesRef.current.add(page);
      try {
        const response = await readTextDiffPage(
          sessionId,
          page * TEXT_PAGE_SIZE,
          TEXT_PAGE_SIZE,
        );
        if (generationRef.current !== generation || sessionRef.current !== sessionId) return;
        setState((current) => {
          const rows = mergePage(current.rows, response.offset, response.rows);
          return { ...current, rows, totalRows: response.totalRows };
        });
      } catch (error) {
        if (generationRef.current !== generation) return;
        setState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "Unable to read text comparison",
        }));
      } finally {
        loadingPagesRef.current.delete(page);
      }
    },
    [],
  );

  const loadBinary = useCallback(async (sessionId: number, offset: number, generation: number) => {
    try {
      const binary = await readBinaryRange(sessionId, offset, BINARY_PAGE_SIZE);
      if (generationRef.current !== generation || sessionRef.current !== sessionId) return;
      setState((current) => ({ ...current, binary }));
    } catch (error) {
      if (generationRef.current !== generation) return;
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Unable to read binary comparison",
      }));
    }
  }, []);

  const start = useCallback(
    async (leftPath: string, rightPath: string) => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      if (taskRef.current !== null) ignoreFailure(cancelDiff(taskRef.current));
      if (sessionRef.current !== null) ignoreFailure(closeDiffSession(sessionRef.current));
      taskRef.current = null;
      sessionRef.current = null;
      loadingPagesRef.current.clear();
      setState({ ...INITIAL_STATE, status: "loading" });
      let terminal = false;
      try {
        const task = await startFileDiff(leftPath, rightPath, (event) => {
          if (generationRef.current !== generation) return;
          if (event.type === "started") {
            setState((current) => ({ ...current, taskId: event.taskId }));
          } else if (event.type === "ready") {
            terminal = true;
            taskRef.current = null;
            sessionRef.current = event.sessionId;
            setState({
              status: "ready",
              taskId: event.taskId,
              sessionId: event.sessionId,
              inspection: event.inspection,
              totalRows: event.totalRows ?? 0,
              rows: new Map(),
              binary: null,
              error: null,
            });
            if (event.inspection.kind === "text") {
              void loadTextPage(event.sessionId, 0, generation);
            } else {
              void loadBinary(event.sessionId, 0, generation);
            }
          } else if (event.type === "cancelled") {
            terminal = true;
            taskRef.current = null;
            setState((current) => ({ ...current, status: "cancelled" }));
          } else {
            terminal = true;
            taskRef.current = null;
            setState((current) => ({
              ...current,
              status: "error",
              error: event.message,
            }));
          }
        });
        if (generationRef.current !== generation) {
          ignoreFailure(cancelDiff(task.taskId));
          return;
        }
        if (!terminal) taskRef.current = task.taskId;
      } catch (error) {
        if (generationRef.current !== generation) return;
        setState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "Unable to compare files",
        }));
      }
    },
    [loadBinary, loadTextPage],
  );

  const ensureTextRange = useCallback(
    (startPosition: number, endPosition: number) => {
      const sessionId = sessionRef.current;
      if (sessionId === null || state.inspection?.kind !== "text") return;
      const generation = generationRef.current;
      for (const page of pagesForRange(startPosition, endPosition, TEXT_PAGE_SIZE)) {
        if (!isPageLoaded(state.rows, page, TEXT_PAGE_SIZE)) {
          void loadTextPage(sessionId, page, generation);
        }
      }
    },
    [loadTextPage, state.inspection?.kind, state.rows],
  );

  const readBinaryOffset = useCallback(
    (offset: number) => {
      const sessionId = sessionRef.current;
      if (sessionId === null || state.inspection?.kind !== "binary") return;
      void loadBinary(sessionId, Math.max(0, offset), generationRef.current);
    },
    [loadBinary, state.inspection?.kind],
  );

  const reset = useCallback(() => {
    generationRef.current += 1;
    if (taskRef.current !== null) ignoreFailure(cancelDiff(taskRef.current));
    if (sessionRef.current !== null) ignoreFailure(closeDiffSession(sessionRef.current));
    taskRef.current = null;
    sessionRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const findDifference = useCallback(async (from: number, direction: 1 | -1) => {
    const sessionId = sessionRef.current;
    if (sessionId === null || state.inspection?.kind !== "text") return null;
    return findDiffPosition(sessionId, from, direction);
  }, [state.inspection?.kind]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      if (taskRef.current !== null) ignoreFailure(cancelDiff(taskRef.current));
      if (sessionRef.current !== null) ignoreFailure(closeDiffSession(sessionRef.current));
    },
    [],
  );

  return {
    state,
    start,
    reset,
    findDifference,
    ensureTextRange,
    readBinaryOffset,
    rowAt: (position: number) => state.rows.get(position),
  };
}
