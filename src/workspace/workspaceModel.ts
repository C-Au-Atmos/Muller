export const WORKSPACE_SCHEMA_VERSION = 3;
export const MAX_WORKSPACE_TABS = 12;

export type WorkspaceMode = "browse" | "duplicates" | "compare" | "album";
export type DirectoryPresentation = "list" | "cubes-grid" | "album";
export type DateFilterMode = "before" | "after";
export type VirtualLocation = "this-pc" | null;

export type SystemRoute =
  | { kind: "workspace"; tabId: string }
  | { kind: "settings"; section?: "appearance" | "language" | "interaction" | "sound" };

export interface DateFilter {
  mode: DateFilterMode;
  year: number;
  month: number;
  day: number;
}

export interface WorkspaceFilter {
  extensions: string[];
  date: DateFilter | null;
}

export interface WorkspaceTab {
  id: string;
  title: string;
  mode: WorkspaceMode;
  path: string;
  virtualLocation: VirtualLocation;
  presentation: DirectoryPresentation;
  filter: WorkspaceFilter;
  split: boolean;
  activePane: "left" | "right";
  scrollAnchors: { left: number; right: number };
}

export interface WorkspaceState {
  version: typeof WORKSPACE_SCHEMA_VERSION;
  tabs: WorkspaceTab[];
  activeTabId: string;
  paneRatio: number;
  previewWidth: number;
  inspectorWidth: number;
  favorites: string[];
}

export type WorkspaceAction =
  | { type: "activate-tab"; id: string }
  | { type: "add-tab"; tab: WorkspaceTab }
  | { type: "close-tab"; id: string }
  | { type: "move-tab"; id: string; delta: -1 | 1 }
  | { type: "update-active"; patch: Partial<Omit<WorkspaceTab, "id">> }
  | { type: "set-pane-ratio"; value: number }
  | { type: "set-preview-width"; value: number }
  | { type: "set-inspector-width"; value: number }
  | { type: "add-favorite"; path: string }
  | { type: "remove-favorite"; path: string }
  | { type: "replace"; state: WorkspaceState };

const MODES = new Set<WorkspaceMode>([
  "browse",
  "duplicates",
  "compare",
  "album",
]);
const PRESENTATIONS = new Set<DirectoryPresentation>([
  "list",
  "cubes-grid",
  "album",
]);

export function emptyWorkspaceFilter(): WorkspaceFilter {
  return { extensions: [], date: null };
}

export function createWorkspaceTab(
  id: string,
  path: string,
  mode: WorkspaceMode = "browse",
): WorkspaceTab {
  return {
    id,
    title: path,
    mode,
    path,
    virtualLocation: null,
    presentation: mode === "album" ? "album" : "list",
    filter: emptyWorkspaceFilter(),
    split: true,
    activePane: "left",
    scrollAnchors: { left: 0, right: 0 },
  };
}

export function createInitialWorkspaceState(path = "D:\\Muller"): WorkspaceState {
  const browse = createWorkspaceTab("browse-1", path, "browse");
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    tabs: [browse],
    activeTabId: browse.id,
    paneRatio: 50,
    previewWidth: 320,
    inspectorWidth: 256,
    favorites: [],
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function sanitizeDateFilter(value: unknown): DateFilter | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DateFilter>;
  if (candidate.mode !== "before" && candidate.mode !== "after") return null;
  if (
    !Number.isInteger(candidate.year) ||
    !Number.isInteger(candidate.month) ||
    !Number.isInteger(candidate.day)
  ) {
    return null;
  }
  const year = clamp(candidate.year ?? 2026, 1970, 9999);
  const month = clamp(candidate.month ?? 1, 1, 12);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    mode: candidate.mode,
    year,
    month,
    day: clamp(candidate.day ?? 1, 1, lastDay),
  };
}

function sanitizeTab(value: unknown, fallbackPath: string): WorkspaceTab | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WorkspaceTab>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return null;
  if ((candidate as { mode?: string }).mode === "home") return null;
  const mode = MODES.has(candidate.mode as WorkspaceMode)
    ? (candidate.mode as WorkspaceMode)
    : "browse";
  const path = typeof candidate.path === "string" && candidate.path.trim()
    ? candidate.path
    : fallbackPath;
  const rawPresentation = candidate.presentation as string | undefined;
  const presentation = rawPresentation === "cubes-row"
    ? "cubes-grid"
    : PRESENTATIONS.has(candidate.presentation as DirectoryPresentation)
    ? (candidate.presentation as DirectoryPresentation)
    : mode === "album"
      ? "album"
      : "list";
  const rawFilter = candidate.filter;
  const extensions = rawFilter && Array.isArray(rawFilter.extensions)
    ? [...new Set(rawFilter.extensions.filter((item): item is string =>
        typeof item === "string" && /^[a-z0-9+_-]{1,16}$/i.test(item),
      ).map((item) => item.toLowerCase()))].slice(0, 32)
    : [];
  return {
    id: candidate.id,
    title: typeof candidate.title === "string" && candidate.title.trim()
      ? candidate.title.slice(0, 80)
       : path,
    mode,
    path,
    virtualLocation: candidate.virtualLocation === "this-pc" ? "this-pc" : null,
    presentation,
    filter: {
      extensions,
      date: sanitizeDateFilter(rawFilter?.date),
    },
    split: candidate.split !== false,
    activePane: candidate.activePane === "right" ? "right" : "left",
    scrollAnchors: {
      left: Math.max(0, Number(candidate.scrollAnchors?.left) || 0),
      right: Math.max(0, Number(candidate.scrollAnchors?.right) || 0),
    },
  } satisfies WorkspaceTab;
}

export function parseWorkspaceState(
  serialized: string | null,
  fallbackPath = "D:\\Muller",
): WorkspaceState {
  if (!serialized) return createInitialWorkspaceState(fallbackPath);
  try {
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const value = parsed as unknown as Partial<WorkspaceState>;
    if (![1, 2, WORKSPACE_SCHEMA_VERSION].includes(Number(parsed.version)) || !Array.isArray(value.tabs)) {
      return createInitialWorkspaceState(fallbackPath);
    }
    const ids = new Set<string>();
    const tabs = value.tabs
      .slice(0, MAX_WORKSPACE_TABS)
      .map((tab) => sanitizeTab(tab, fallbackPath))
      .filter((tab): tab is WorkspaceTab => {
        if (!tab || (tab as { mode?: string }).mode === "home" || ids.has(tab.id)) return false;
        ids.add(tab.id);
        return true;
      });
    if (tabs.length === 0) return createInitialWorkspaceState(fallbackPath);
    const activeTabId = tabs.some((tab) => tab.id === value.activeTabId)
      ? (value.activeTabId as string)
      : (tabs[0]?.id ?? "");
    return {
      version: WORKSPACE_SCHEMA_VERSION,
      tabs,
      activeTabId,
      paneRatio: clamp(Number(value.paneRatio) || 50, 25, 75),
      previewWidth: clamp(Number(value.previewWidth) || 320, 240, 520),
      inspectorWidth: clamp(Number(value.inspectorWidth) || 256, 220, 420),
      favorites: Array.isArray(value.favorites)
        ? [...new Set(value.favorites.filter((path): path is string =>
            typeof path === "string" && path.trim().length > 0,
          ).map((path) => path.trim()))].slice(0, 32)
        : [],
    };
  } catch {
    return createInitialWorkspaceState(fallbackPath);
  }
}

export function activeWorkspaceTab(state: WorkspaceState): WorkspaceTab {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ??
    createWorkspaceTab("browse-1", "D:\\Muller");
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "activate-tab":
      return state.tabs.some((tab) => tab.id === action.id)
        ? { ...state, activeTabId: action.id }
        : state;
    case "add-tab":
      if (
        state.tabs.length >= MAX_WORKSPACE_TABS ||
        state.tabs.some((tab) => tab.id === action.tab.id)
      ) {
        return state;
      }
      return {
        ...state,
        tabs: [...state.tabs, action.tab],
        activeTabId: action.tab.id,
      };
    case "close-tab": {
      if (state.tabs.length === 1) return state;
      const closingIndex = state.tabs.findIndex((tab) => tab.id === action.id);
      if (closingIndex < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      const activeTabId = state.activeTabId === action.id
        ? (tabs[Math.min(closingIndex, tabs.length - 1)]?.id ?? state.activeTabId)
        : state.activeTabId;
      return { ...state, tabs, activeTabId };
    }
    case "move-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      const target = index + action.delta;
      const moving = state.tabs[index];
      if (
        index < 0
        || !moving
        || target < 0
        || target >= state.tabs.length
      ) return state;
      const tabs = [...state.tabs];
      const [tab] = tabs.splice(index, 1);
      if (!tab) return state;
      tabs.splice(target, 0, tab);
      return { ...state, tabs };
    }
    case "update-active":
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === state.activeTabId ? { ...tab, ...action.patch, id: tab.id } : tab,
        ),
      };
    case "set-pane-ratio":
      return { ...state, paneRatio: clamp(action.value, 25, 75) };
    case "set-preview-width":
      return { ...state, previewWidth: clamp(action.value, 240, 520) };
    case "set-inspector-width":
      return { ...state, inspectorWidth: clamp(action.value, 220, 420) };
    case "add-favorite": {
      const path = action.path.trim();
      if (!path || state.favorites.some((item) => item.toLowerCase() === path.toLowerCase())) {
        return state;
      }
      return { ...state, favorites: [...state.favorites, path].slice(-32) };
    }
    case "remove-favorite":
      return {
        ...state,
        favorites: state.favorites.filter(
          (item) => item.toLowerCase() !== action.path.trim().toLowerCase(),
        ),
      };
    case "replace":
      return action.state;
  }
}

export function dateFilterBoundary(filter: DateFilter): number {
  const boundary = new Date(filter.year, filter.month - 1, filter.day);
  if (filter.mode === "after") return boundary.getTime();
  boundary.setHours(23, 59, 59, 999);
  return boundary.getTime();
}
