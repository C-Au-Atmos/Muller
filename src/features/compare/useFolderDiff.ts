import { useCallback, useEffect, useRef, useState } from "react";

import { isPageLoaded, pagesForRange } from "../paging/pagedData";
import { retainComparePage } from "./comparePageCache";
import { cancelDiff, closeDiffSession, findDiffPosition, readFolderDiffPage, startFolderDiff } from "./compareClient";
import type { CompareStatus, FolderDiffEntry, FolderDiffFilter, FolderDiffProgress, FolderDiffStats } from "./types";

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
  filter: FolderDiffFilter;
  pageLoading: boolean;
}

const INITIAL_STATE: FolderDiffState = {
  status: "idle", taskId: null, sessionId: null, totalEntries: 0, issueCount: 0,
  progress: null, stats: null, entries: new Map(), error: null, filter: "all", pageLoading: false,
};

export function useFolderDiff() {
  const [state, setState] = useState(INITIAL_STATE);
  const generationRef = useRef(0);
  const pageGenerationRef = useRef(0);
  const filterRef = useRef<FolderDiffFilter>("all");
  const taskRef = useRef<number | null>(null);
  const sessionRef = useRef<number | null>(null);
  const loadingPagesRef = useRef(new Set<string>());

  const loadPage = useCallback(async (sessionId: number, page: number, generation: number, pageGeneration: number, filter: FolderDiffFilter) => {
    const key = `${generation}/${pageGeneration}/${page}`;
    if (loadingPagesRef.current.has(key)) return;
    loadingPagesRef.current.add(key);
    const isCurrent = () => generationRef.current === generation
      && pageGenerationRef.current === pageGeneration && sessionRef.current === sessionId;
    try {
      const response = await readFolderDiffPage(sessionId, page * PAGE_SIZE, PAGE_SIZE, filter);
      if (!isCurrent()) return;
      setState((current) => ({
        ...current,
        entries: retainComparePage(current.entries, response.offset, response.entries, PAGE_SIZE),
        totalEntries: response.totalEntries,
        pageLoading: false,
      }));
    } catch (error) {
      if (!isCurrent()) return;
      setState((current) => ({ ...current, status: "error", pageLoading: false,
        error: error instanceof Error ? error.message : "Unable to read comparison page" }));
    } finally {
      loadingPagesRef.current.delete(key);
    }
  }, []);

  const start = useCallback(async (leftRoot: string, rightRoot: string, treatMtimeAsDiff: boolean) => {
    const generation = ++generationRef.current;
    ++pageGenerationRef.current;
    if (taskRef.current !== null) ignoreFailure(cancelDiff(taskRef.current));
    if (sessionRef.current !== null) ignoreFailure(closeDiffSession(sessionRef.current));
    taskRef.current = null;
    sessionRef.current = null;
    loadingPagesRef.current.clear();
    setState({ ...INITIAL_STATE, status: "loading", filter: filterRef.current });
    let terminal = false;
    try {
      const task = await startFolderDiff(leftRoot, rightRoot, treatMtimeAsDiff, (event) => {
        if (generationRef.current !== generation) {
          if (event.type === "ready") ignoreFailure(closeDiffSession(event.sessionId));
          return;
        }
        if (event.type === "started") {
          taskRef.current = event.taskId;
          setState((current) => ({ ...current, taskId: event.taskId }));
        } else if (event.type === "progress") {
          setState((current) => ({ ...current, progress: event.progress }));
        } else if (event.type === "ready") {
          terminal = true;
          taskRef.current = null;
          sessionRef.current = event.sessionId;
          setState({ ...INITIAL_STATE, status: "ready", taskId: event.taskId, sessionId: event.sessionId,
            issueCount: event.issueCount, stats: event.stats, filter: filterRef.current, pageLoading: true });
          void loadPage(event.sessionId, 0, generation, pageGenerationRef.current, filterRef.current);
        } else if (event.type === "cancelled") {
          terminal = true;
          taskRef.current = null;
          setState((current) => ({ ...current, status: "cancelled", progress: null }));
        } else {
          terminal = true;
          taskRef.current = null;
          setState((current) => ({ ...current, status: "error", progress: null, error: event.message }));
        }
      });
      if (generationRef.current !== generation) {
        ignoreFailure(cancelDiff(task.taskId));
        return;
      }
      if (!terminal) taskRef.current = task.taskId;
    } catch (error) {
      if (generationRef.current !== generation) return;
      setState((current) => ({ ...current, status: "error",
        error: error instanceof Error ? error.message : "Unable to start folder comparison" }));
    }
  }, [loadPage]);

  const setFilter = useCallback((filter: FolderDiffFilter) => {
    if (filterRef.current === filter) return;
    filterRef.current = filter;
    const pageGeneration = ++pageGenerationRef.current;
    loadingPagesRef.current.clear();
    const sessionId = sessionRef.current;
    setState((current) => ({ ...current, filter, entries: new Map(), totalEntries: 0,
      error: null, pageLoading: sessionId !== null }));
    if (sessionId !== null) void loadPage(sessionId, 0, generationRef.current, pageGeneration, filter);
  }, [loadPage]);

  const ensureRange = useCallback((startPosition: number, endPosition: number) => {
    const sessionId = sessionRef.current;
    if (sessionId === null || state.pageLoading) return;
    for (const page of pagesForRange(startPosition, endPosition, PAGE_SIZE)) {
      if (!isPageLoaded(state.entries, page, PAGE_SIZE)) {
        void loadPage(sessionId, page, generationRef.current, pageGenerationRef.current, filterRef.current);
      }
    }
  }, [loadPage, state.entries, state.pageLoading]);

  const cancel = useCallback(() => {
    ++generationRef.current;
    ++pageGenerationRef.current;
    if (taskRef.current !== null) ignoreFailure(cancelDiff(taskRef.current));
    taskRef.current = null;
    setState((current) => ({ ...current, status: "cancelled", progress: null, pageLoading: false }));
  }, []);

  const reset = useCallback(() => {
    ++generationRef.current;
    ++pageGenerationRef.current;
    if (taskRef.current !== null) ignoreFailure(cancelDiff(taskRef.current));
    if (sessionRef.current !== null) ignoreFailure(closeDiffSession(sessionRef.current));
    taskRef.current = null;
    sessionRef.current = null;
    loadingPagesRef.current.clear();
    setState({ ...INITIAL_STATE, filter: filterRef.current });
  }, []);

  const findDifference = useCallback(async (from: number, direction: 1 | -1) => {
    const sessionId = sessionRef.current;
    if (sessionId === null) return null;
    const generation = generationRef.current;
    const pageGeneration = pageGenerationRef.current;
    const position = await findDiffPosition(sessionId, from, direction, filterRef.current);
    return generationRef.current === generation && pageGenerationRef.current === pageGeneration ? position : null;
  }, []);

  useEffect(() => () => {
    ++generationRef.current;
    ++pageGenerationRef.current;
    if (taskRef.current !== null) ignoreFailure(cancelDiff(taskRef.current));
    if (sessionRef.current !== null) ignoreFailure(closeDiffSession(sessionRef.current));
  }, []);

  return { state, start, cancel, reset, setFilter, findDifference, ensureRange,
    entryAt: (position: number) => state.entries.get(position) };
}
