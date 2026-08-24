import { useCallback, useEffect, useRef, useState } from "react";

import {
  diagnosticDebug,
  reportDiagnosticError,
} from "../../diagnostics/diagnosticsClient";
import { isPageLoaded, mergePage, pagesForRange } from "../paging/pagedData";

import {
  cancelDirectoryQuery,
  closeDirectorySession,
  readDirectoryPage,
  locateDirectoryEntry,
  resolveDirectoryEntries,
  searchDirectoryPage,
  startDirectoryQuery,
  startDirectorySearch,
} from "./explorerClient";
import type { DirectoryEntry, DirectoryPaneState, DirectoryQueryFilter, DirectorySearchMode } from "./types";
import { displayPath } from "./pathDisplay";

const PAGE_SIZE = 128;

interface DirectorySearchState {
  mode: DirectorySearchMode;
  query: string;
  status: "idle" | "loading" | "ready" | "error";
  totalEntries: number;
  entries: ReadonlyMap<number, DirectoryEntry>;
  error: string | null;
}

const INITIAL_SEARCH_STATE: DirectorySearchState = {
  mode: "current",
  query: "",
  status: "idle",
  totalEntries: 0,
  entries: new Map(),
  error: null,
};

const INITIAL_STATE = (path: string): DirectoryPaneState => ({
  status: "idle",
  taskId: null,
  sessionId: null,
  requestedPath: path,
  path,
  parent: null,
  totalEntries: 0,
  entries: new Map(),
  error: null,
});

function ignoreFailure(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function emptySearchState(mode: DirectorySearchMode): DirectorySearchState {
  return { ...INITIAL_SEARCH_STATE, mode };
}

export function useDirectoryPane(
  initialPath: string,
  filter?: DirectoryQueryFilter,
  globalSearchRoots: readonly string[] = [],
  enabled = true,
) {
  const [state, setState] = useState<DirectoryPaneState>(() => INITIAL_STATE(initialPath));
  const [search, setSearch] = useState<DirectorySearchState>(INITIAL_SEARCH_STATE);
  const generationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const searchModeRef = useRef<DirectorySearchMode>("current");
  const searchQueryRef = useRef("");
  const taskRef = useRef<number | null>(null);
  const sessionRef = useRef<number | null>(null);
  const searchTaskRef = useRef<number | null>(null);
  const searchSessionRef = useRef<number | null>(null);
  const loadingPagesRef = useRef(new Set<string>());
  const loadingSearchPagesRef = useRef(new Set<string>());
  const searchTimerRef = useRef<number | null>(null);
  const backRef = useRef<string[]>([]);
  const forwardRef = useRef<string[]>([]);

  const loadPage = useCallback(
    async (sessionId: number, pageIndex: number, generation: number) => {
      const loadKey = `${generation}:${pageIndex}`;
      if (loadingPagesRef.current.has(loadKey)) return;
      loadingPagesRef.current.add(loadKey);
      try {
        const page = await readDirectoryPage(
          sessionId,
          pageIndex * PAGE_SIZE,
          PAGE_SIZE,
        );
        if (generationRef.current !== generation || sessionRef.current !== sessionId) return;
        setState((current) => {
          const entries = mergePage(current.entries, page.offset, page.entries);
          return { ...current, entries, totalEntries: page.totalEntries };
        });
      } catch (error) {
        if (generationRef.current !== generation) return;
        setState((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Unable to read directory page",
        }));
      } finally {
        loadingPagesRef.current.delete(loadKey);
      }
    },
    [],
  );

  const loadSearchPage = useCallback(
    async (
      sessionId: number,
      query: string,
      pageIndex: number,
      generation: number,
    ) => {
      const loadKey = `${generation}:${pageIndex}`;
      if (loadingSearchPagesRef.current.has(loadKey)) return;
      loadingSearchPagesRef.current.add(loadKey);
      try {
        const page = searchSessionRef.current === sessionId
          ? await readDirectoryPage(sessionId, pageIndex * PAGE_SIZE, PAGE_SIZE)
          : await searchDirectoryPage(sessionId, query, pageIndex * PAGE_SIZE, PAGE_SIZE);
        if (
          searchGenerationRef.current !== generation ||
          !(
            searchSessionRef.current === sessionId ||
            (searchSessionRef.current === null && sessionRef.current === sessionId)
          )
        ) {
          return;
        }
        setSearch((current) => ({
          ...current,
          status: "ready",
          totalEntries: page.totalEntries,
          entries: mergePage(current.entries, page.offset, page.entries),
          error: null,
        }));
        diagnosticDebug("search.page_ready", {
          generation,
          resultCount: page.totalEntries,
          status: "ready",
        });
      } catch (error) {
        if (searchGenerationRef.current !== generation) return;
        reportDiagnosticError("search.page_failed", error, { generation });
        setSearch((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Unable to search this directory",
        }));
      } finally {
        loadingSearchPagesRef.current.delete(loadKey);
      }
    },
    [],
  );

  const scheduleSearch = useCallback(
    (query: string, mode: DirectorySearchMode) => {
      searchQueryRef.current = query;
      const generation = searchGenerationRef.current + 1;
      searchGenerationRef.current = generation;
      loadingSearchPagesRef.current.clear();
      const previousSearchTask = searchTaskRef.current;
      const previousSearchSession = searchSessionRef.current;
      searchTaskRef.current = null;
      searchSessionRef.current = null;
      if (previousSearchTask !== null) ignoreFailure(cancelDirectoryQuery(previousSearchTask));
      if (previousSearchSession !== null) ignoreFailure(closeDirectorySession(previousSearchSession));
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      diagnosticDebug("search.scheduled", {
        generation,
        inputLength: query.length,
        mode,
        status: previousSearchTask !== null || previousSearchSession !== null ? "replaced" : "new",
      });
      if (!query.trim()) {
        setSearch(emptySearchState(mode));
        return;
      }
      setSearch({
        mode,
        query,
        status: "loading",
        totalEntries: 0,
        entries: new Map(),
        error: null,
      });
      searchTimerRef.current = window.setTimeout(() => {
        searchTimerRef.current = null;
        if (searchGenerationRef.current !== generation) return;
        diagnosticDebug("search.debounce_finished", {
          generation,
          inputLength: query.length,
          mode,
        });
        if (mode === "current") {
          const sessionId = sessionRef.current;
          if (sessionId !== null) void loadSearchPage(sessionId, query, 0, generation);
          return;
        }
        const roots = mode === "global" ? [...globalSearchRoots] : [state.path];
        if (roots.length === 0 || roots.every((root) => !root.trim())) {
          diagnosticDebug("search.roots_unavailable", { generation, mode });
          setSearch((current) => ({ ...current, status: "error", error: "No searchable roots are available" }));
          return;
        }
        let terminal = false;
        void startDirectorySearch(roots.filter(Boolean), query, mode, (event) => {
          if (searchGenerationRef.current !== generation) return;
          if (event.type === "started") {
            setSearch((current) => ({ ...current, status: "loading", error: null }));
            return;
          }
          terminal = true;
          searchTaskRef.current = null;
          if (event.type === "ready") {
            searchSessionRef.current = event.sessionId;
            diagnosticDebug("search.session_ready", {
              generation,
              mode,
              resultCount: event.totalEntries,
            });
            setSearch((current) => ({
              ...current,
              status: "ready",
              totalEntries: event.totalEntries,
              entries: new Map(),
              error: null,
            }));
            void loadSearchPage(event.sessionId, query, 0, generation);
          } else if (event.type === "cancelled") {
            diagnosticDebug("search.session_cancelled", { generation, mode });
            setSearch((current) => ({ ...current, status: "idle" }));
          } else {
            reportDiagnosticError("search.session_failed", new Error("native search error"), {
              generation,
              mode,
            });
            setSearch((current) => ({ ...current, status: "error", error: event.message }));
          }
        }, filter).then((start) => {
          if (searchGenerationRef.current !== generation) {
            ignoreFailure(cancelDirectoryQuery(start.taskId));
          } else if (!terminal) {
            searchTaskRef.current = start.taskId;
          }
        }).catch((error) => {
          if (searchGenerationRef.current !== generation) return;
          reportDiagnosticError("search.start_failed", error, { generation, mode });
          setSearch((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : "Unable to start directory search",
          }));
        });
      }, 120);
    },
    [filter, globalSearchRoots, loadSearchPage, state.path],
  );

  const setSearchQuery = useCallback((query: string) => {
    if (query === searchQueryRef.current) return;
    scheduleSearch(query, searchModeRef.current);
  }, [scheduleSearch]);

  const setSearchMode = useCallback((mode: DirectorySearchMode) => {
    searchModeRef.current = mode;
    scheduleSearch(searchQueryRef.current, mode);
  }, [scheduleSearch]);

  const openPath = useCallback(
    async (path: string, historyMode: "push" | "back" | "forward" | "replace" = "push") => {
      const normalized = path.trim();
      if (!normalized) return;
      const previousPath = state.path;
      if (historyMode === "push" && previousPath && previousPath !== normalized) {
        backRef.current.push(previousPath);
        forwardRef.current = [];
      }

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      searchGenerationRef.current += 1;
      searchQueryRef.current = "";
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      const previousTask = taskRef.current;
      const previousSession = sessionRef.current;
      const previousSearchTask = searchTaskRef.current;
      const previousSearchSession = searchSessionRef.current;
      taskRef.current = null;
      sessionRef.current = null;
      searchTaskRef.current = null;
      searchSessionRef.current = null;
      loadingPagesRef.current.clear();
      loadingSearchPagesRef.current.clear();
      setSearch(emptySearchState(searchModeRef.current));
      if (previousTask !== null) ignoreFailure(cancelDirectoryQuery(previousTask));
      if (previousSession !== null) ignoreFailure(closeDirectorySession(previousSession));
      if (previousSearchTask !== null) ignoreFailure(cancelDirectoryQuery(previousSearchTask));
      if (previousSearchSession !== null) ignoreFailure(closeDirectorySession(previousSearchSession));
      setState((current) => ({
        ...INITIAL_STATE(normalized),
        path: current.path,
        status: "loading",
        requestedPath: normalized,
      }));

      let terminal = false;
      try {
        const start = await startDirectoryQuery(normalized, (event) => {
          if (generationRef.current !== generation) return;
          if (event.type === "started") {
            setState((current) => ({ ...current, taskId: event.taskId, status: "loading" }));
            return;
          }
          terminal = true;
          taskRef.current = null;
          if (event.type === "ready") {
            sessionRef.current = event.sessionId;
            const path = displayPath(event.path);
            setState({
              status: "ready",
              taskId: event.taskId,
              sessionId: event.sessionId,
              requestedPath: path,
              path,
              parent: event.parent === null ? null : displayPath(event.parent),
              totalEntries: event.totalEntries,
              entries: new Map(),
              error: null,
            });
            void loadPage(event.sessionId, 0, generation);
            const pendingSearch = searchQueryRef.current;
            if (pendingSearch.trim() && searchModeRef.current === "current") {
              void loadSearchPage(event.sessionId, pendingSearch, 0, searchGenerationRef.current);
            }
          } else if (event.type === "cancelled") {
            setState((current) => ({ ...current, status: "cancelled" }));
          } else {
            setState((current) => ({
              ...current,
              path: current.requestedPath,
              status: "error",
              error: event.message,
            }));
          }
        }, filter);
        if (generationRef.current !== generation) {
          ignoreFailure(cancelDirectoryQuery(start.taskId));
          return;
        }
        if (!terminal) taskRef.current = start.taskId;
      } catch (error) {
        if (generationRef.current !== generation) return;
        setState((current) => ({
          ...current,
          path: current.requestedPath,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Unable to open directory",
        }));
      }
    },
    [filter, loadPage, loadSearchPage, state.path],
  );

  const ensureRange = useCallback(
    (start: number, end: number) => {
      const sessionId = sessionRef.current;
      const searchSessionId = searchSessionRef.current;
      if (sessionId === null && searchSessionId === null) return;
      const generation = generationRef.current;
      const searchGeneration = searchGenerationRef.current;
      const query = search.query.trim();
      for (const page of pagesForRange(start, end, PAGE_SIZE)) {
        if (query && !isPageLoaded(search.entries, page, PAGE_SIZE)) {
          const targetSession = searchSessionId ?? sessionId;
          if (targetSession !== null) void loadSearchPage(targetSession, search.query, page, searchGeneration);
        } else if (!query && sessionId !== null && !isPageLoaded(state.entries, page, PAGE_SIZE)) {
          void loadPage(sessionId, page, generation);
        }
      }
    },
    [loadPage, loadSearchPage, search.entries, search.query, state.entries],
  );

  const back = useCallback(() => {
    const path = backRef.current.pop();
    if (!path) return;
    if (state.path) forwardRef.current.push(state.path);
    void openPath(path, "back");
  }, [openPath, state.path]);

  const forward = useCallback(() => {
    const path = forwardRef.current.pop();
    if (!path) return;
    if (state.path) backRef.current.push(state.path);
    void openPath(path, "forward");
  }, [openPath, state.path]);

  const up = useCallback(() => {
    if (state.parent) void openPath(state.parent);
  }, [openPath, state.parent]);

  const refresh = useCallback(() => {
    if (state.path) void openPath(state.path, "replace");
  }, [openPath, state.path]);

  const entryAt = useCallback(
    (position: number): DirectoryEntry | undefined =>
      search.query.trim()
        ? search.entries.get(position)
        : state.entries.get(position),
    [search.entries, search.query, state.entries],
  );

  const resolveEntries = useCallback(async (positions: readonly number[]) => {
    const expandedSession = search.query.trim() ? searchSessionRef.current : null;
    const sessionId = expandedSession ?? sessionRef.current;
    if (sessionId === null || positions.length === 0) return [];
    return resolveDirectoryEntries(sessionId, expandedSession === null ? search.query : "", positions);
  }, [search.query]);

  const locate = useCallback(async (prefix: string, startAfter: number | null) => {
    const expandedSession = search.query.trim() ? searchSessionRef.current : null;
    const sessionId = expandedSession ?? sessionRef.current;
    if (sessionId === null) return null;
    return locateDirectoryEntry(sessionId, prefix, startAfter, expandedSession === null ? search.query : "");
  }, [search.query]);

  useEffect(() => {
    if (!enabled) return;
    void openPath(initialPath, "replace");
  }, [enabled]);

  const filterSignature = JSON.stringify(filter ?? null);
  const previousFilterSignature = useRef(filterSignature);
  useEffect(() => {
    if (!enabled) return;
    if (previousFilterSignature.current === filterSignature) return;
    previousFilterSignature.current = filterSignature;
    if (state.path) void openPath(state.path, "replace");
  }, [enabled, filterSignature, openPath, state.path]);

  const globalRootsSignature = JSON.stringify(globalSearchRoots);
  const previousGlobalRootsSignature = useRef(globalRootsSignature);
  useEffect(() => {
    if (!enabled) return;
    if (previousGlobalRootsSignature.current === globalRootsSignature) return;
    previousGlobalRootsSignature.current = globalRootsSignature;
    if (searchModeRef.current === "global" && searchQueryRef.current.trim()) {
      scheduleSearch(searchQueryRef.current, "global");
    }
  }, [enabled, globalRootsSignature, scheduleSearch]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      searchGenerationRef.current += 1;
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      if (taskRef.current !== null) ignoreFailure(cancelDirectoryQuery(taskRef.current));
      if (sessionRef.current !== null) ignoreFailure(closeDirectorySession(sessionRef.current));
      if (searchTaskRef.current !== null) ignoreFailure(cancelDirectoryQuery(searchTaskRef.current));
      if (searchSessionRef.current !== null) ignoreFailure(closeDirectorySession(searchSessionRef.current));
    },
    [],
  );

  return {
    state,
    search,
    setSearchQuery,
    setSearchMode,
    visibleTotalEntries: search.query.trim() ? search.totalEntries : state.totalEntries,
    visibleStatus: search.query.trim() ? search.status : state.status,
    visibleError: search.query.trim()
      ? search.error ?? (search.mode === "current" ? state.error : null)
      : state.error,
    entryAt,
    resolveEntries,
    locate,
    ensureRange,
    openPath,
    back,
    forward,
    up,
    refresh,
    canBack: backRef.current.length > 0,
    canForward: forwardRef.current.length > 0,
  };
}
