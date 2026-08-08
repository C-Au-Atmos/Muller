import { useCallback, useEffect, useRef, useState } from "react";

import { isPageLoaded, mergePage, pagesForRange } from "../paging/pagedData";

import {
  cancelDiff,
  closeDiffSession,
  findDiffPosition,
  readFolderDiffPage,
  startFolderDiff,
} from "./compareClient";
import type {
  CompareStatus,
  FolderDiffEntry,
  FolderDiffProgress,
  FolderDiffStats,
} from "./types";

const PAGE_SIZE = 128;

function ignoreFailure(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export interface FolderDiffState {
  status: CompareStatus;
  taskId: number | null;
  sessionId: number | null;
  totalEntries: number;
  issueCount: number;
  progress: FolderDiffProgress | null;
  stats: FolderDiffStats | null;
  entries: ReadonlyMap<number, FolderDiffEntry>;
  error: string | null;
}

const INITIAL_STATE: FolderDiffState = {
  status: "idle",
  taskId: null,
  sessionId: null,
  totalEntries: 0,
  issueCount: 0,
  progress: null,
  stats: null,
  entries: new Map(),
  error: null,
};

export function useFolderDiff() {
  const [state, setState] = useState(INITIAL_STATE);
  const generationRef = useRef(0);
  const taskRef = useRef<number | null>(null);
  const sessionRef = useRef<number | null>(null);
  const loadingPagesRef = useRef(new Set<number>());

  const loadPage = useCallback(async (sessionId: number, page: number, generation: number) => {
    if (loadingPagesRef.current.has(page)) return;
    loadingPagesRef.current.add(page);
    try {
      const response = await readFolderDiffPage(
        sessionId,
        page * PAGE_SIZE,
        PAGE_SIZE,
      );
      if (generationRef.current !== generation || sessionRef.current !== sessionId) return;
      setState((current) => {
        const entries = mergePage(current.entries, response.offset, response.entries);
        return { ...current, entries, totalEntries: response.totalEntries };
      });
    } catch (error) {
      if (generationRef.current !== generation) return;
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Unable to read comparison page",
      }));
    } finally {
      loadingPagesRef.current.delete(page);
    }
  }, []);

  const start = useCallback(
    async (leftRoot: string, rightRoot: string, treatMtimeAsDiff: boolean) => {
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
        const task = await startFolderDiff(
          leftRoot,
          rightRoot,
          treatMtimeAsDiff,
          (event) => {
            if (generationRef.current !== generation) return;
            if (event.type === "started") {
              setState((current) => ({ ...current, taskId: event.taskId }));
            } else if (event.type === "progress") {
              setState((current) => ({ ...current, progress: event.progress }));
            } else if (event.type === "ready") {
              terminal = true;
              taskRef.current = null;
              sessionRef.current = event.sessionId;
              setState({
                status: "ready",
                taskId: event.taskId,
                sessionId: event.sessionId,
                totalEntries: event.totalEntries,
                issueCount: event.issueCount,
                progress: null,
                stats: event.stats,
                entries: new Map(),
                error: null,
              });
              void loadPage(event.sessionId, 0, generation);
            } else if (event.type === "cancelled") {
              terminal = true;
              taskRef.current = null;
              setState((current) => ({ ...current, status: "cancelled", progress: null }));
            } else {
              terminal = true;
              taskRef.current = null;
              setState((current) => ({
                ...current,
                status: "error",
                progress: null,
                error: event.message,
              }));
            }
          },
        );
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
          error: error instanceof Error ? error.message : "Unable to start folder comparison",
        }));
      }
    },
    [loadPage],
  );

  const ensureRange = useCallback(
    (startPosition: number, endPosition: number) => {
      const sessionId = sessionRef.current;
      if (sessionId === null) return;
      const generation = generationRef.current;
      for (const page of pagesForRange(startPosition, endPosition, PAGE_SIZE)) {
        if (!isPageLoaded(state.entries, page, PAGE_SIZE)) {
          void loadPage(sessionId, page, generation);
        }
      }
    },
    [loadPage, state.entries],
  );

  const cancel = useCallback(() => {
    generationRef.current += 1;
    if (taskRef.current !== null) ignoreFailure(cancelDiff(taskRef.current));
    taskRef.current = null;
    setState((current) => ({ ...current, status: "cancelled", progress: null }));
  }, []);

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
    if (sessionId === null) return null;
    return findDiffPosition(sessionId, from, direction);
  }, []);

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
    cancel,
    reset,
    findDifference,
    ensureRange,
    entryAt: (position: number) => state.entries.get(position),
  };
}
