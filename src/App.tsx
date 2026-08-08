import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleAlert,
  CheckCheck,
  Command,
  CopyCheck,
  Columns2,
  Cpu,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  FolderTree,
  Globe2,
  ListChecks,
  Maximize2,
  Minus,
  Minimize2,
  Pin,
  PinOff,
  PanelTopClose,
  PanelTopOpen,
  Play,
  Search,
  Settings as SettingsIcon,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { resolveAppCommand } from "./commands/appCommands";
import {
  CommandPalette,
  type CommandPaletteItem,
} from "./features/command/CommandPalette";
import { SuccessBurst } from "./features/feedback/SuccessBurst";
import { useInterfaceAudio } from "./features/feedback/useInterfaceAudio";
import {
  CompareWorkspace,
  type CompareNavigationState,
  type CompareWorkspaceHandle,
} from "./features/compare/CompareWorkspace";
import {
  VirtualDuplicateList,
  type VirtualDuplicateListHandle,
} from "./features/dedup/VirtualDuplicateList";
import { DuplicateGroupDetail } from "./features/dedup/DuplicateGroupDetail";
import {
  buildDuplicateRows,
  filterDuplicateGroups,
  formatBytes,
} from "./features/dedup/duplicateListModel";
import {
  adoptDuplicateSuggestions,
  applyDuplicateDecision,
  confirmedDuplicatePaths,
  type DuplicateDecision,
} from "./features/dedup/duplicateDecisionModel";
import type { DuplicateGroup, ScanPhase } from "./features/dedup/types";
import { createInitialScanState } from "./features/dedup/scanState";
import { useDedupScan } from "./features/dedup/useDedupScan";
import { recycleDuplicates } from "./features/dedup/recycleClient";
import { ALBUM_IMAGE_EXTENSIONS } from "./features/album/imageFormats";
import {
  BrowseWorkspace,
  type BrowseNavigationState,
  type BrowseComparisonRequest,
  type BrowseWorkspaceHandle,
} from "./features/explorer/BrowseWorkspace";
import { DirectorySearchBar } from "./features/explorer/DirectorySearchBar";
import { listDirectoryExtensions, warmGlobalSearchIndex, type DirectoryExtensionCount } from "./features/explorer/explorerClient";
import { openNativePath } from "./features/explorer/fileOperationsClient";
import { displayPath } from "./features/explorer/pathDisplay";
import { ThisPcWorkspace } from "./features/explorer/ThisPcWorkspace";
import type { DirectoryEntry, DirectoryQueryFilter, DirectorySearchMode, FileClipboardState } from "./features/explorer/types";
import { WorkspaceFilterMenu } from "./features/filter/WorkspaceFilterMenu";
import { HomeDashboard } from "./features/home/HomeDashboard";
import {
  FlowBorder,
  type FlowBorderHandle,
} from "./features/flow-border/FlowBorder";
import type {
  FlowBorderStats,
  FlowVisualState,
} from "./features/flow-border/protocol";
import { SettingsPage } from "./features/settings/SettingsPage";
import { LocationRail, type QuickLocation } from "./features/shell/LocationRail";
import { ExplorerAddressBar } from "./features/shell/ExplorerAddressBar";
import {
  getShellLocations,
  listLogicalDrives,
  completeDirectoryPath,
  type LogicalDrive,
  type ShellLocation,
} from "./features/shell/windowsNavigationClient";
import { ToolRibbon } from "./features/shell/ToolRibbon";
import { WorkspaceTabs } from "./features/shell/WorkspaceTabs";
import { usePreferences } from "./preferences/usePreferences";
import { I18nProvider, useI18n, type TranslationKey } from "./i18n/i18n";
import { GradientText } from "./ui/react-bits/GradientText/GradientText";
import { SpecularButton } from "./ui/react-bits/SpecularButton/SpecularButton";
import {
  createWorkspaceTab,
  dateFilterBoundary,
  type DirectoryPresentation,
  type WorkspaceMode,
} from "./workspace/workspaceModel";
import { useWorkspaceState } from "./workspace/useWorkspaceState";

const INITIAL_STATS: FlowBorderStats = {
  renderer: "webgl2-worker",
  fps: 0,
  frameTimeMs: 0,
  messagesPerSecond: 0,
  drawCallsPerFrame: 4,
};
const EMPTY_SCAN_STATE = createInitialScanState();

const ColorBendsBackground = lazy(async () => {
  const module = await import("./visual/ColorBendsBackground");
  return { default: module.ColorBendsBackground };
});

interface RecyclePromptItem {
  path: string;
  expectedBlake3: string;
  size: number;
  createdUnixMs: number | null;
  modifiedUnixMs: number | null;
  hardLinkCount: number;
}

interface RecyclePrompt {
  items: RecyclePromptItem[];
}

const PHASE_LABELS: Record<ScanPhase, TranslationKey> = {
  discovering: "phaseDiscovering",
  fingerprinting: "phaseFingerprinting",
  full_hashing: "phaseFullHashing",
  complete: "statusComplete",
};

function isActiveScan(status: string): boolean {
  return status === "starting" || status === "scanning";
}

function isDriveRoot(path: string): boolean {
  return /^[a-z]:[\\/]?$/i.test(displayPath(path));
}

function isNetworkHostRoot(path: string): boolean {
  return /^\\\\[^\\/]+[\\/]?$/.test(displayPath(path));
}

function scanStatusKey(status: string): TranslationKey {
  switch (status) {
    case "starting":
      return "statusStarting";
    case "scanning":
      return "statusScanning";
    case "done":
      return "statusComplete";
    case "cancelled":
      return "statusCancelled";
    case "error":
      return "statusFailed";
    default:
      return "statusReady";
  }
}

export function App() {
  const { state: workspaceState, activeTab, dispatch: dispatchWorkspace } =
    useWorkspaceState("D:\\Muller");
  const { preferences, updatePreferences, resetPreferences } = usePreferences();
  const { t, formatNumber, formatDate } = useI18n(preferences.locale);
  const [systemRoute, setSystemRoute] = useState<"workspace" | "home" | "settings">("workspace");
  const [filterOpen, setFilterOpen] = useState(false);
  const [ribbonCollapsed, setRibbonCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("muller:workspace-tools-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [fileActionsCollapsed, setFileActionsCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("muller:file-actions-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [fileClipboard, setFileClipboard] = useState<FileClipboardState | null>(null);
  const activeTool = activeTab.mode;
  const explorerTool = activeTool === "browse" || activeTool === "album";
  const activePage = systemRoute === "workspace" ? activeTool : systemRoute;
  const flowRef = useRef<FlowBorderHandle>(null);
  const browseRef = useRef<BrowseWorkspaceHandle>(null);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  const searchModeMenuRef = useRef<HTMLDivElement>(null);
  const scanCompletionRef = useRef({ source: "", candidates: [] as string[], index: -1, revision: 0 });
  const duplicateListRef = useRef<VirtualDuplicateListHandle>(null);
  const duplicateSearchRef = useRef<HTMLInputElement>(null);
  const compareRef = useRef<CompareWorkspaceHandle>(null);
  const recycleCancelRef = useRef<HTMLButtonElement>(null);
  const pendingVelocity = useRef<number | null>(null);
  const velocityFrame = useRef<number | null>(null);
  const [duplicateFocusPath, setDuplicateFocusPath] = useState<string | null>(null);
  const [selectedDuplicatePaths, setSelectedDuplicatePaths] = useState<Set<string>>(new Set());
  const [duplicateDecisions, setDuplicateDecisions] = useState<Map<string, DuplicateDecision>>(new Map());
  const [duplicateDecisionError, setDuplicateDecisionError] = useState<string | null>(null);
  const [openDuplicateGroupHash, setOpenDuplicateGroupHash] = useState<string | null>(null);
  const duplicateAnchorPosition = useRef(-1);
  const [duplicateSearchOpen, setDuplicateSearchOpen] = useState(false);
  const [searchModeMenuOpen, setSearchModeMenuOpen] = useState(false);
  const [duplicateQuery, setDuplicateQuery] = useState("");
  const [visualState, setVisualState] = useState<FlowVisualState>("idle");
  const [scanRoot, setScanRoot] = useState("D:\\Muller");
  const [scanRoots, setScanRoots] = useState<string[]>([]);
  const [shellLocations, setShellLocations] = useState<ShellLocation[]>([]);
  const [logicalDrives, setLogicalDrives] = useState<LogicalDrive[]>([]);
  const [extensionOptions, setExtensionOptions] = useState<DirectoryExtensionCount[]>([]);
  const [extensionsLoading, setExtensionsLoading] = useState(false);
  const [compareNavigation, setCompareNavigation] = useState<CompareNavigationState>({
    activePane: "left",
    path: "D:\\Muller",
    split: true,
    canBack: false,
    canForward: false,
    canUp: false,
    editing: false,
  });
  const [compareAddress, setCompareAddress] = useState("D:\\Muller");
  const [compareLaunchRequest, setCompareLaunchRequest] = useState<(BrowseComparisonRequest & { token: number }) | null>(null);
  const [browseNavigation, setBrowseNavigation] = useState<BrowseNavigationState>({
    activePane: "left",
    path: "D:\\Muller",
    split: true,
    canBack: false,
    canForward: false,
    canUp: false,
    selectedName: null,
    searchQuery: "",
    searchMode: "current",
    searchResultCount: 0,
    totalEntries: 0,
    searchBoth: false,
    canSearchBoth: false,
  });
  const [browseAddress, setBrowseAddress] = useState("D:\\Muller");
  const [minSize, setMinSize] = useState("1024");
  const [depth, setDepth] = useState(3);
  const [stats, setStats] = useState(INITIAL_STATS);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [recyclePrompt, setRecyclePrompt] = useState<RecyclePrompt | null>(null);
  const [recycleBusy, setRecycleBusy] = useState(false);
  const [recycleError, setRecycleError] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [successToken, setSuccessToken] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");
  const [scanOwnerTabId, setScanOwnerTabId] = useState<string | null>(null);
  const { enabled: soundEnabled, play } = useInterfaceAudio({
    enabled: preferences.audioEnabled && preferences.audioVolume > 0,
    volume: preferences.audioVolume,
  });

  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    const syncWindowState = () => {
      void getCurrentWindow().isMaximized()
        .then((maximized) => {
          if (mounted) setWindowMaximized(maximized);
        })
        .catch(() => undefined);
    };
    syncWindowState();
    window.addEventListener("resize", syncWindowState);
    return () => {
      mounted = false;
      window.removeEventListener("resize", syncWindowState);
    };
  }, []);

  const completeScanRoot = useCallback(async (reverse: boolean) => {
    const state = scanCompletionRef.current;
    let available = state.candidates;
    if (available.length === 0 || (scanRoot !== state.source && !available.includes(scanRoot))) {
      const revision = ++state.revision;
      try {
        available = await completeDirectoryPath(scanRoot);
      } catch {
        available = [];
      }
      if (revision !== state.revision || available.length === 0) return;
      state.source = scanRoot;
      state.candidates = available;
      state.index = -1;
    }
    const next = reverse
      ? (state.index <= 0 ? available.length - 1 : state.index - 1)
      : (state.index + 1) % available.length;
    state.index = next;
    setScanRoot(available[next] ?? scanRoot);
  }, [scanRoot]);

  const resetScanCompletion = useCallback(() => {
    scanCompletionRef.current = {
      source: "",
      candidates: [],
      index: -1,
      revision: scanCompletionRef.current.revision + 1,
    };
  }, []);
  const { state: scanSessionState, start: startScan, cancel: cancelScan, removePaths: removeScannedPaths } = useDedupScan();
  const scanState = scanOwnerTabId === null || scanOwnerTabId === activeTab.id
    ? scanSessionState
    : EMPTY_SCAN_STATE;
  const previousScanStatus = useRef(scanSessionState.status);
  const explorerMode = systemRoute === "workspace" && explorerTool;
  const isThisPc = activeTab.virtualLocation === "this-pc";
  const addressMode = explorerMode || (systemRoute === "workspace" && activeTool === "compare");
  const filterCount = activeTab.filter.extensions.length + (activeTab.filter.date ? 1 : 0);
  const directoryFilter = useMemo<DirectoryQueryFilter>(() => {
    const date = activeTab.filter.date;
    const boundary = date ? dateFilterBoundary(date) : null;
    const albumExtensions: string[] = [...ALBUM_IMAGE_EXTENSIONS];
    const requestedExtensions = activeTab.filter.extensions;
    const extensions = activeTool === "album"
      ? (requestedExtensions.length > 0
          ? requestedExtensions.filter((extension) => albumExtensions.includes(extension))
          : albumExtensions)
      : requestedExtensions;
    return {
      extensions,
      modifiedBeforeUnixMs: date?.mode === "before" ? boundary : null,
      modifiedAfterUnixMs: date?.mode === "after" ? boundary : null,
      filesOnly: activeTool === "album" || requestedExtensions.length > 0 || date !== null,
      sortBy: "name",
      sortDirection: "ascending",
    };
  }, [activeTab.filter, activeTool]);

  const scanActive = isActiveScan(scanState.status);
  const parsedMinSize = Number(minSize);
  const effectiveScanRoots = useMemo(
    () => [...new Set([scanRoot.trim(), ...scanRoots].filter(Boolean))],
    [scanRoot, scanRoots],
  );
  const scanInputValid =
    effectiveScanRoots.length > 0 &&
    Number.isFinite(parsedMinSize) &&
    parsedMinSize >= 0 &&
    Number.isInteger(parsedMinSize);
  const filteredDuplicateGroups = useMemo(
    () => filterDuplicateGroups(scanState.groups, duplicateQuery),
    [duplicateQuery, scanState.groups],
  );
  const duplicateRows = useMemo(
    () => buildDuplicateRows(filteredDuplicateGroups),
    [filteredDuplicateGroups],
  );
  const openDuplicateGroup = openDuplicateGroupHash === null
    ? null
    : scanState.groups.find((group) => group.full_hash === openDuplicateGroupHash) ?? null;
  const openDuplicateGroupOrdinal = openDuplicateGroup === null
    ? 0
    : scanState.groups.indexOf(openDuplicateGroup) + 1;
  const duplicateFilePositions = useMemo(
    () =>
      duplicateRows.flatMap((row, position) =>
        row.kind === "file" ? [position] : [],
      ),
    [duplicateRows],
  );
  const selectedDuplicatePosition = duplicateRows.findIndex(
    (row) => row.kind === "file" && row.file.path === duplicateFocusPath,
  );
  const selectedDuplicateRow = duplicateRows[selectedDuplicatePosition];
  const selectedDuplicateFile =
    selectedDuplicateRow?.kind === "file" ? selectedDuplicateRow.file : null;
  const selectedDuplicateOrdinal = duplicateFilePositions.indexOf(
    selectedDuplicatePosition,
  );
  const confirmedDuplicates = useMemo(
    () => confirmedDuplicatePaths(scanState.groups, duplicateDecisions),
    [duplicateDecisions, scanState.groups],
  );
  const cleanupCandidates = useMemo<RecyclePromptItem[]>(
    () => scanState.groups.flatMap((group) => group.files.flatMap((file) =>
      selectedDuplicatePaths.has(file.path) &&
        confirmedDuplicates.has(file.path) &&
        file.hard_link_count === 1 &&
        group.full_hash.length === 64
        ? [{
            path: file.path,
            expectedBlake3: group.full_hash,
            size: file.size,
            createdUnixMs: file.created_unix_ms,
            modifiedUnixMs: file.modified_unix_ms,
            hardLinkCount: file.hard_link_count,
          }]
        : [],
    )),
    [confirmedDuplicates, scanState.groups, selectedDuplicatePaths],
  );
  const canRecycleSelected = cleanupCandidates.length > 0 && scanState.status === "done";
  const progressPercent =
    scanState.progress?.total !== null && scanState.progress?.total !== undefined
      ? Math.min(
          100,
          Math.round(
            (scanState.progress.processed /
              Math.max(scanState.progress.total, 1)) *
              100,
          ),
        )
      : null;

  const handleStats = useCallback((next: FlowBorderStats) => {
    setStats(next);
  }, []);

  const handleWorkerError = useCallback((message: string) => {
    setWorkerError(message);
  }, []);

  const handleCompareNavigation = useCallback((next: CompareNavigationState) => {
    setCompareNavigation(next);
    setCompareAddress(next.path);
    dispatchWorkspace({
      type: "update-active",
      patch: { path: next.path, title: next.path, split: next.split, activePane: next.activePane },
    });
  }, [dispatchWorkspace]);

  const handleBrowseNavigation = useCallback((next: BrowseNavigationState) => {
    setBrowseNavigation(next);
    setBrowseAddress(next.path);
    dispatchWorkspace({
      type: "update-active",
      patch: { path: next.path, title: next.path, virtualLocation: null, split: next.split, activePane: next.activePane },
    });
  }, [dispatchWorkspace]);

  const activateTool = useCallback((tool: WorkspaceMode) => {
    setSystemRoute("workspace");
    const presentation: DirectoryPresentation = tool === "album"
      ? "album"
      : activeTab.presentation === "album"
        ? "list"
        : activeTab.presentation;
    dispatchWorkspace({ type: "update-active", patch: { mode: tool, presentation } });
  }, [activeTab.presentation, dispatchWorkspace]);

  const launchBrowseComparison = useCallback((request: BrowseComparisonRequest) => {
    setCompareLaunchRequest({ ...request, token: Date.now() });
    setSystemRoute("workspace");
    dispatchWorkspace({ type: "update-active", patch: { mode: "compare", presentation: "list" } });
  }, [dispatchWorkspace]);

  const openThisPcHome = useCallback(() => {
    setSystemRoute("workspace");
    setFilterOpen(false);
    dispatchWorkspace({
      type: "update-active",
      patch: { mode: "browse", title: t("thisPc"), virtualLocation: "this-pc" },
    });
  }, [dispatchWorkspace, t]);

  const openMullerHome = useCallback(() => {
    setSystemRoute("home");
    setFilterOpen(false);
  }, []);

  const updateRibbonCollapsed = useCallback((collapsed: boolean) => {
    setRibbonCollapsed(collapsed);
    try {
      window.localStorage.setItem("muller:workspace-tools-collapsed", String(collapsed));
    } catch {
      // The layout remains usable when persistence is unavailable.
    }
  }, []);

  const updateFileActionsCollapsed = useCallback((collapsed: boolean) => {
    setFileActionsCollapsed(collapsed);
    try {
      window.localStorage.setItem("muller:file-actions-collapsed", String(collapsed));
    } catch {
      // The layout remains usable when persistence is unavailable.
    }
  }, []);

  useEffect(() => {
    const focusSearch = () => {
      directorySearchRef.current?.focus();
      directorySearchRef.current?.select();
    };
    window.addEventListener("muller:focus-directory-search", focusSearch);
    return () => window.removeEventListener("muller:focus-directory-search", focusSearch);
  }, []);

  useEffect(() => {
    if (!searchModeMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!searchModeMenuRef.current?.contains(event.target as Node)) setSearchModeMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearchModeMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [searchModeMenuOpen]);

  const sendScrollVelocity = useCallback((velocity: number) => {
    pendingVelocity.current = velocity;
    if (velocityFrame.current !== null) return;

    velocityFrame.current = window.requestAnimationFrame(() => {
      if (pendingVelocity.current !== null) {
        flowRef.current?.scroll(pendingVelocity.current);
      }
      pendingVelocity.current = null;
      velocityFrame.current = null;
    });
  }, []);

  const moveDuplicateSelection = useCallback(
    (delta: number, extend = false) => {
      if (duplicateFilePositions.length === 0) return;
      const currentOrdinal = duplicateFilePositions.indexOf(selectedDuplicatePosition);
      const origin = currentOrdinal < 0 ? 0 : currentOrdinal;
      const nextOrdinal = Math.min(
        Math.max(origin + delta, 0),
        duplicateFilePositions.length - 1,
      );
      const nextPosition = duplicateFilePositions[nextOrdinal];
      if (nextPosition === undefined) return;
      const row = duplicateRows[nextPosition];
      if (!row || row.kind !== "file") return;
      setDuplicateFocusPath(row.file.path);
      if (extend) {
        const anchorPosition = duplicateAnchorPosition.current >= 0
          ? duplicateAnchorPosition.current
          : selectedDuplicatePosition;
        const anchorOrdinal = Math.max(0, duplicateFilePositions.indexOf(anchorPosition));
        const start = Math.min(anchorOrdinal, nextOrdinal);
        const end = Math.max(anchorOrdinal, nextOrdinal);
        setSelectedDuplicatePaths(new Set(
          duplicateFilePositions.slice(start, end + 1).flatMap((position) => {
            const candidate = duplicateRows[position];
            return candidate?.kind === "file" ? [candidate.file.path] : [];
          }),
        ));
      } else {
        duplicateAnchorPosition.current = nextPosition;
        setSelectedDuplicatePaths(new Set([row.file.path]));
      }
    },
    [duplicateFilePositions, duplicateRows, selectedDuplicatePosition],
  );

  const selectDuplicatePosition = useCallback((
    position: number,
    modifiers: { ctrl: boolean; shift: boolean },
  ) => {
    const row = duplicateRows[position];
    if (!row || row.kind !== "file") return;
    setDuplicateFocusPath(row.file.path);
    if (modifiers.shift) {
      const targetOrdinal = duplicateFilePositions.indexOf(position);
      const anchorPosition = duplicateAnchorPosition.current >= 0
        ? duplicateAnchorPosition.current
        : position;
      const anchorOrdinal = Math.max(0, duplicateFilePositions.indexOf(anchorPosition));
      const start = Math.min(anchorOrdinal, targetOrdinal);
      const end = Math.max(anchorOrdinal, targetOrdinal);
      const range = duplicateFilePositions.slice(start, end + 1).flatMap((candidatePosition) => {
        const candidate = duplicateRows[candidatePosition];
        return candidate?.kind === "file" ? [candidate.file.path] : [];
      });
      setSelectedDuplicatePaths((current) => new Set(modifiers.ctrl ? [...current, ...range] : range));
      return;
    }
    duplicateAnchorPosition.current = position;
    if (modifiers.ctrl) {
      setSelectedDuplicatePaths((current) => {
        const next = new Set(current);
        if (next.has(row.file.path)) next.delete(row.file.path);
        else next.add(row.file.path);
        return next;
      });
    } else {
      setSelectedDuplicatePaths(new Set([row.file.path]));
    }
  }, [duplicateFilePositions, duplicateRows]);

  const selectAllDuplicateFiles = useCallback(() => {
    const paths = duplicateFilePositions.flatMap((position) => {
      const row = duplicateRows[position];
      return row?.kind === "file" ? [row.file.path] : [];
    });
    setSelectedDuplicatePaths(new Set(paths));
    const first = duplicateFilePositions[0];
    const row = first === undefined ? null : duplicateRows[first];
    if (row?.kind === "file") setDuplicateFocusPath(row.file.path);
  }, [duplicateFilePositions, duplicateRows]);

  const markDuplicatePath = useCallback((path: string, decision: DuplicateDecision) => {
    const update = applyDuplicateDecision(
      scanState.groups,
      duplicateDecisions,
      new Set([path]),
      decision,
    );
    setDuplicateDecisions(update.decisions);
    setDuplicateDecisionError(update.error);
  }, [duplicateDecisions, scanState.groups]);

  const showDuplicateGroup = useCallback((group: DuplicateGroup) => {
    setDuplicateSearchOpen(false);
    setOpenDuplicateGroupHash(group.full_hash);
    play("navigate");
  }, [play]);

  const adoptSuggestions = useCallback(() => {
    setDuplicateDecisions(adoptDuplicateSuggestions(scanState.groups));
    setDuplicateDecisionError(null);
  }, [scanState.groups]);

  const selectConfirmedDuplicates = useCallback(() => {
    setSelectedDuplicatePaths(new Set(confirmedDuplicates));
    const first = duplicateRows.find(
      (row) => row.kind === "file" && confirmedDuplicates.has(row.file.path),
    );
    if (first?.kind === "file") setDuplicateFocusPath(first.file.path);
  }, [confirmedDuplicates, duplicateRows]);

  const openDuplicateSearch = useCallback(() => {
    setDuplicateSearchOpen(true);
    window.requestAnimationFrame(() => {
      duplicateSearchRef.current?.focus();
      duplicateSearchRef.current?.select();
    });
  }, []);

  const closeDuplicateSearch = useCallback(() => {
    setDuplicateQuery("");
    setDuplicateSearchOpen(false);
    window.requestAnimationFrame(() => duplicateListRef.current?.focus());
  }, []);

  useEffect(() => {
    if (selectedDuplicatePosition >= 0) return;
    const first = duplicateFilePositions[0];
    const row = first === undefined ? null : duplicateRows[first];
    setDuplicateFocusPath(row?.kind === "file" ? row.file.path : null);
  }, [duplicateFilePositions, duplicateRows, selectedDuplicatePosition]);

  useEffect(() => {
    duplicateListRef.current?.scrollToPosition(selectedDuplicatePosition);
  }, [selectedDuplicatePosition]);

  useEffect(() => {
    const valid = new Set(scanState.groups.flatMap((group) => group.files.map((file) => file.path)));
    setSelectedDuplicatePaths((current) => {
      const next = new Set([...current].filter((path) => valid.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [scanState.groups]);

  useEffect(() => {
    if (openDuplicateGroupHash !== null && openDuplicateGroup === null) setOpenDuplicateGroupHash(null);
  }, [openDuplicateGroup, openDuplicateGroupHash]);

  useEffect(() => {
    if (!recyclePrompt) return;
    recycleCancelRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || recycleBusy) return;
      event.preventDefault();
      setRecyclePrompt(null);
      setRecycleError(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [recycleBusy, recyclePrompt]);

  useEffect(() => {
    const ownsVisibleScan = activeTool === "duplicates" && scanOwnerTabId === activeTab.id;
    setVisualState(ownsVisibleScan && isActiveScan(scanSessionState.status) ? "scanning" : "idle");
  }, [activeTab.id, activeTool, scanOwnerTabId, scanSessionState.status]);

  const handleSuccess = useCallback(
    (message: string) => {
      setSuccessMessage(message);
      setSuccessToken((current) => current + 1);
      play("success");
    },
    [play],
  );

  const openHomeSearchResult = useCallback((entry: DirectoryEntry) => {
    if (entry.kind === "directory") {
      activateTool("browse");
      window.requestAnimationFrame(() => browseRef.current?.navigateActive(entry.path));
      return;
    }
    if (entry.kind === "file") {
      void openNativePath(entry.path).catch((error) => {
        play("warning");
        console.error("Unable to open global search result", error);
      });
    }
  }, [activateTool, play]);

  useEffect(() => {
    const previous = previousScanStatus.current;
    const ownsVisibleScan = activeTool === "duplicates" && scanOwnerTabId === activeTab.id;
    let timeout: number | null = null;
    if (previous === "scanning" && scanSessionState.status === "done") {
      handleSuccess(t("duplicateScanComplete"));
      if (ownsVisibleScan) {
        setVisualState("success");
        timeout = window.setTimeout(() => setVisualState("idle"), 1400);
      }
    } else if (previous === "scanning" && scanSessionState.status === "error" && ownsVisibleScan) {
      setVisualState("danger");
      timeout = window.setTimeout(() => setVisualState("idle"), 1800);
    }
    previousScanStatus.current = scanSessionState.status;
    return () => {
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [activeTab.id, activeTool, handleSuccess, scanOwnerTabId, scanSessionState.status, t]);

  useEffect(() => {
    flowRef.current?.setState(visualState);
  }, [visualState]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const command = resolveAppCommand(event);
      if (!command) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('[role="dialog"], [role="menu"]')
      ) {
        return;
      }
      if (command === "openCommandPalette") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (command === "openSettings") {
        event.preventDefault();
        setSystemRoute("settings");
        setFilterOpen(false);
        return;
      }
      if (command === "newTab") {
        event.preventDefault();
        dispatchWorkspace({
          type: "add-tab",
          tab: createWorkspaceTab(`workspace-${crypto.randomUUID()}`, activeTab.path, "browse"),
        });
        setSystemRoute("workspace");
        return;
      }
      if (command === "editAddress" && addressMode && !isThisPc) {
        event.preventDefault();
        window.dispatchEvent(new Event("muller:edit-address"));
        return;
      }
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const mullerFindFromInput =
        command === "findInDirectory" &&
        !(target instanceof HTMLElement && target.closest(".cm-editor"));
      if (
        command === "cancelScan" &&
        target instanceof HTMLElement &&
        target.closest(".directory-search-bar")
      ) {
        return;
      }
      if (
        isEditing &&
        !(command === "cancelScan" && scanActive) &&
        !mullerFindFromInput
      ) {
        return;
      }
      if (command === "cancelScan" && !scanActive) return;
      const fileCommand = new Set([
        "copySelection",
        "cutSelection",
        "paste",
        "renameSelection",
        "recycleSelection",
        "goUp",
        "refresh",
        "togglePreview",
        "selectAll",
      ]).has(command);
      if (fileCommand && !explorerMode && !(activeTool === "duplicates" && command === "selectAll")) return;
      const paneCommand =
        command === "activateLeftPane" || command === "activateRightPane";
      if (paneCommand && (!addressMode || !explorerNavigation.split)) return;
      event.preventDefault();
      switch (command) {
        case "openBrowse":
          activateTool("browse");
          break;
        case "openDuplicates":
          activateTool("duplicates");
          break;
        case "openCompare":
          activateTool("compare");
          break;
        case "cancelScan":
          cancelScan();
          break;
        case "moveNext":
          if (activeTool === "duplicates") {
            moveDuplicateSelection(1, event.shiftKey);
            play("tick");
          } else if (activeTool === "compare") {
            compareRef.current?.moveSelection(1);
            play("tick");
          } else if (explorerMode) {
            browseRef.current?.moveSelection("down", event.shiftKey);
            play("tick");
          }
          break;
        case "movePrevious":
          if (activeTool === "duplicates") {
            moveDuplicateSelection(-1, event.shiftKey);
            play("tick");
          } else if (activeTool === "compare") {
            compareRef.current?.moveSelection(-1);
            play("tick");
          } else if (explorerMode) {
            browseRef.current?.moveSelection("up", event.shiftKey);
            play("tick");
          }
          break;
        case "moveLeft":
          if (explorerMode) {
            browseRef.current?.moveSelection("left", event.shiftKey);
            play("tick");
          }
          break;
        case "moveRight":
          if (explorerMode) {
            browseRef.current?.moveSelection("right", event.shiftKey);
            play("tick");
          }
          break;
        case "movePageNext":
          if (activeTool === "duplicates") {
            moveDuplicateSelection(14, event.shiftKey);
            play("tick");
          } else if (activeTool === "compare") {
            compareRef.current?.moveSelection(14);
            play("tick");
          } else if (explorerMode) {
            browseRef.current?.moveSelection("pageDown", event.shiftKey);
            play("tick");
          }
          break;
        case "movePagePrevious":
          if (activeTool === "duplicates") {
            moveDuplicateSelection(-14, event.shiftKey);
            play("tick");
          } else if (activeTool === "compare") {
            compareRef.current?.moveSelection(-14);
            play("tick");
          } else if (explorerMode) {
            browseRef.current?.moveSelection("pageUp", event.shiftKey);
            play("tick");
          }
          break;
        case "activateLeftPane":
          explorerRef.current?.activatePane("left");
          break;
        case "activateRightPane":
          explorerRef.current?.activatePane("right");
          break;
        case "openSelection":
          if (activeTool === "compare") compareRef.current?.openSelection();
          else if (explorerMode) browseRef.current?.openSelection();
          break;
        case "nextDifference":
          if (activeTool === "compare") compareRef.current?.nextDifference();
          break;
        case "previousDifference":
          if (activeTool === "compare") compareRef.current?.previousDifference();
          break;
        case "copySelection":
          browseRef.current?.copySelection();
          break;
        case "cutSelection":
          browseRef.current?.cutSelection();
          break;
        case "paste":
          browseRef.current?.paste();
          break;
        case "renameSelection":
          browseRef.current?.renameSelection();
          break;
        case "recycleSelection":
          browseRef.current?.recycleSelection();
          break;
        case "goUp":
          browseRef.current?.up();
          break;
        case "refresh":
          browseRef.current?.refresh();
          break;
        case "togglePreview":
          browseRef.current?.togglePreview();
          break;
        case "findInDirectory":
          if (activeTool === "duplicates") openDuplicateSearch();
          else if (addressMode) explorerRef.current?.findInDirectory();
          break;
        case "selectAll":
          if (activeTool === "duplicates") selectAllDuplicateFiles();
          else if (explorerMode) browseRef.current?.selectAll();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyboard, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyboard, { capture: true });
  }, [
    activeTab.path,
    activeTool,
    activateTool,
    addressMode,
    cancelScan,
    dispatchWorkspace,
    explorerMode,
    isThisPc,
    moveDuplicateSelection,
    openDuplicateSearch,
    play,
    scanActive,
    selectAllDuplicateFiles,
  ]);

  useEffect(
    () => () => {
      if (velocityFrame.current !== null) {
        window.cancelAnimationFrame(velocityFrame.current);
      }
    },
    [],
  );

  useEffect(() => {
    const updateSuspension = () => {
      document.documentElement.dataset.appSuspended = String(
        document.visibilityState !== "visible",
      );
    };
    updateSuspension();
    document.addEventListener("visibilitychange", updateSuspension);
    window.addEventListener("pagehide", updateSuspension);
    window.addEventListener("pageshow", updateSuspension);
    return () => {
      document.removeEventListener("visibilitychange", updateSuspension);
      window.removeEventListener("pagehide", updateSuspension);
      window.removeEventListener("pageshow", updateSuspension);
    };
  }, []);

  useEffect(() => {
    if (!filterOpen || !explorerMode || isThisPc) return;
    let current = true;
    setExtensionsLoading(true);
    void listDirectoryExtensions(browseNavigation.path).then((options) => {
      if (current) setExtensionOptions(options);
    }).catch(() => {
      if (current) setExtensionOptions([]);
    }).finally(() => {
      if (current) setExtensionsLoading(false);
    });
    return () => { current = false; };
  }, [browseNavigation.path, explorerMode, filterOpen, isThisPc]);

  const navigate = (direction: "enter" | "back") => {
    const nextDepth = direction === "enter" ? depth + 1 : Math.max(0, depth - 1);
    setDepth(nextDepth);
    flowRef.current?.navigate(direction, nextDepth);
  };

  const handleStartScan = (event: FormEvent) => {
    event.preventDefault();
    if (!scanInputValid) return;
    setDuplicateDecisions(new Map());
    setSelectedDuplicatePaths(new Set());
    setDuplicateDecisionError(null);
    setDuplicateFocusPath(null);
    setScanOwnerTabId(activeTab.id);
    void startScan({
      roots: effectiveScanRoots,
      minSize: parsedMinSize,
    });
  };

  const openRecycleConfirmation = () => {
    if (!canRecycleSelected) return;
    setRecycleError(null);
    setRecyclePrompt({ items: cleanupCandidates });
  };

  const confirmRecycle = async () => {
    if (!recyclePrompt || recycleBusy) return;
    setRecycleBusy(true);
    setRecycleError(null);
    try {
      const report = await recycleDuplicates(recyclePrompt.items.map((item) => ({
        path: item.path,
        expectedSize: item.size,
        expectedBlake3: item.expectedBlake3,
      })));
      if (report.recycled.length > 0) {
        removeScannedPaths(report.recycled);
        const recycled = new Set(report.recycled.map((path) => displayPath(path).toLowerCase()));
        setSelectedDuplicatePaths((current) => new Set(
          [...current].filter((path) => !recycled.has(displayPath(path).toLowerCase())),
        ));
        setDuplicateDecisions((current) => new Map(
          [...current].filter(([path]) => !recycled.has(displayPath(path).toLowerCase())),
        ));
      }
      if (report.failures.length > 0) {
        const failed = new Set(report.failures.map((failure) => displayPath(failure.path).toLowerCase()));
        setRecyclePrompt({
          items: recyclePrompt.items.filter((item) => failed.has(displayPath(item.path).toLowerCase())),
        });
        setRecycleError(report.failures.map((failure) => `${displayPath(failure.path)}: ${failure.message}`).join("\n"));
      } else {
        setRecyclePrompt(null);
        handleSuccess(t("recycledDuplicates", { count: formatNumber(report.recycled.length) }));
      }
    } catch (error) {
      setRecycleError(
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : t("unableRecycle"),
      );
    } finally {
      setRecycleBusy(false);
    }
  };

  const progressDetail = scanState.error
    ? scanState.error
    : scanState.progress
      ? t("progressFiles", {
          processed: formatNumber(scanState.progress.processed),
          total: scanState.progress.total === null ? t("unknown") : formatNumber(scanState.progress.total),
        })
      : t(scanStatusKey(scanState.status));

  useEffect(() => {
    if (!isThisPc) setScanRoot(activeTab.path);
    setBrowseAddress(activeTab.path);
    setCompareAddress(activeTab.path);
  }, [activeTab.id, activeTab.path, isThisPc]);

  useEffect(() => {
    let current = true;
    void getShellLocations().then((locations) => {
      if (current) setShellLocations(locations);
    }).catch(() => {
      if (current) setShellLocations([]);
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    void listLogicalDrives().then((drives) => {
      if (current) setLogicalDrives(drives);
    }).catch(() => {
      if (current) setLogicalDrives([]);
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!scanOwnerTabId || workspaceState.tabs.some((tab) => tab.id === scanOwnerTabId)) return;
    cancelScan();
    setScanOwnerTabId(null);
  }, [cancelScan, scanOwnerTabId, workspaceState.tabs]);

  const explorerNavigation =
    activeTool === "compare" ? compareNavigation : browseNavigation;
  const explorerAddress = activeTool === "compare" ? compareAddress : browseAddress;
  const explorerRef = activeTool === "compare" ? compareRef : browseRef;
  const globalSearchRoots = useMemo(
    () => logicalDrives
      .filter((drive) => ["fixed", "removable", "ramdisk"].includes(drive.driveType))
      .map((drive) => drive.path),
    [logicalDrives],
  );
  useEffect(() => {
    if (globalSearchRoots.length > 0) {
      void warmGlobalSearchIndex(globalSearchRoots).catch(() => undefined);
    }
  }, [globalSearchRoots]);
  const quickLocations: readonly QuickLocation[] = useMemo(() => [
    { id: "this-pc", label: t("thisPc"), target: { kind: "this-pc" as const } },
    ...logicalDrives.map((drive) => ({
      id: `drive-${drive.path.toLowerCase()}`,
      label: `${drive.label || t("localDisk")} (${displayPath(drive.path).replace("\\", "")})`,
      target: { kind: "directory" as const, path: drive.path },
    })),
    ...shellLocations.map((location) => ({
      id: `known-${location.id}`,
      label: location.label,
      target: { kind: "directory" as const, path: location.path },
    })),
    ...workspaceState.favorites.map((path) => ({
      id: `favorite-${path.toLowerCase()}`,
      label: path.split(/[\\/]/).filter(Boolean).at(-1) ?? displayPath(path),
      target: { kind: "directory" as const, path },
    })),
  ], [logicalDrives, shellLocations, t, workspaceState.favorites]);
  const addWorkspaceTab = () => {
    const id = `workspace-${crypto.randomUUID()}`;
    const tab = createWorkspaceTab(id, activeTab.path, "browse");
    tab.title = t("thisPc");
    tab.virtualLocation = "this-pc";
    dispatchWorkspace({
      type: "add-tab",
      tab,
    });
    setSystemRoute("workspace");
  };
  const updatePresentation = (presentation: DirectoryPresentation) => {
    dispatchWorkspace({
      type: "update-active",
      patch: { mode: "browse", presentation },
    });
  };
  const navigateQuickLocation = (location: QuickLocation, disposition: "current" | "newTab" = "current") => {
    if (disposition === "newTab") {
      const tab = createWorkspaceTab(`workspace-${crypto.randomUUID()}`, activeTab.path, "browse");
      if (location.target.kind === "this-pc") {
        tab.title = t("thisPc");
        tab.virtualLocation = "this-pc";
      } else {
        tab.path = location.target.path;
        tab.title = location.target.path;
        tab.mode = location.target.mode ?? "browse";
        tab.presentation = tab.mode === "album" ? "album" : activeTab.presentation;
      }
      dispatchWorkspace({ type: "add-tab", tab });
      setSystemRoute("workspace");
      return;
    }
    setSystemRoute("workspace");
    if (location.target.kind === "this-pc") {
      dispatchWorkspace({
        type: "update-active",
        patch: { mode: "browse", title: t("thisPc"), virtualLocation: "this-pc" },
      });
      return;
    }
    const mode = location.target.mode ?? (activeTool === "album" ? "album" : "browse");
    dispatchWorkspace({
      type: "update-active",
      patch: {
        mode,
        path: location.target.path,
        title: location.target.path,
        virtualLocation: null,
        presentation: mode === "album" ? "album" : activeTab.presentation,
      },
    });
    if (mode === "album" || mode === "browse") browseRef.current?.navigateActive(location.target.path);
  };
  const openDrive = (path: string) => {
    dispatchWorkspace({
      type: "update-active",
      patch: { mode: "browse", path, title: path, virtualLocation: null },
    });
  };
  const activePathIsFavorite = !isThisPc && workspaceState.favorites.some(
    (path) => path.toLowerCase() === activeTab.path.toLowerCase(),
  );
  const toggleFavorite = () => dispatchWorkspace({
    type: activePathIsFavorite ? "remove-favorite" : "add-favorite",
    path: activeTab.path,
  });
  const chooseScanRoots = async () => {
    const selection = await open({
      directory: true,
      multiple: true,
      defaultPath: scanRoot.trim() || undefined,
      title: t("chooseFoldersToScan"),
    });
    if (!selection) return;
    const roots = Array.isArray(selection) ? selection : [selection];
    if (roots.length === 0) return;
    setScanRoots(roots);
    setScanRoot(roots[0] ?? scanRoot);
  };
  const commandItems: readonly CommandPaletteItem[] = [
    {
      id: "browse",
      label: t("openBrowse"),
      detail: t("browseDetail"),
      shortcut: "Ctrl 1",
      icon: <FolderOpen size={16} />,
      run: () => activateTool("browse"),
    },
    {
      id: "duplicates",
      label: t("openDuplicates"),
      detail: t("duplicatesDetail"),
      shortcut: "Ctrl 2",
      icon: <CopyCheck size={16} />,
      run: () => activateTool("duplicates"),
    },
    {
      id: "compare",
      label: t("openCompare"),
      detail: t("compareDetail"),
      shortcut: "Ctrl 3",
      icon: <Columns2 size={16} />,
      run: () => activateTool("compare"),
    },
    {
      id: "back",
      label: t("back"),
      detail: t("backDetail"),
      icon: <ArrowLeft size={16} />,
      disabled: activeTool === "duplicates" || !explorerNavigation.canBack,
      run: () => explorerRef.current?.back(),
    },
    {
      id: "forward",
      label: t("forward"),
      detail: t("forwardDetail"),
      icon: <ArrowRight size={16} />,
      disabled: activeTool === "duplicates" || !explorerNavigation.canForward,
      run: () => explorerRef.current?.forward(),
    },
    {
      id: "up",
      label: t("up"),
      detail: t("upDetail"),
      shortcut: "Backspace",
      icon: <ArrowUp size={16} />,
      disabled: activeTool === "duplicates" || !explorerNavigation.canUp,
      run: () => explorerRef.current?.up(),
    },
    {
      id: "split",
      label: explorerNavigation.split ? t("singlePane") : t("dualPane"),
      detail: t("splitDetail"),
      icon: <Columns2 size={16} />,
      disabled: activeTool === "duplicates",
      run: () => explorerRef.current?.toggleSplit(),
    },
    {
      id: "preview",
      label: t("togglePreview"),
      detail: t("previewDetail"),
      shortcut: "Space",
      icon: <Command size={16} />,
      disabled: !explorerMode,
      run: () => browseRef.current?.togglePreview(),
    },
    {
      id: "settings",
      label: t("openSettings"),
      detail: t("settingsDetail"),
      shortcut: "Ctrl ,",
      icon: <SettingsIcon size={16} />,
      run: () => setSystemRoute("settings"),
    },
  ];

  const SearchScopeIcon = browseNavigation.searchMode === "global"
    ? Globe2
    : browseNavigation.searchMode === "recursive"
      ? FolderTree
      : FolderSearch;
  const searchModeOptions: readonly { mode: DirectorySearchMode; label: TranslationKey; icon: typeof Search }[] = [
    { mode: "global", label: "searchModeGlobal", icon: Globe2 },
    { mode: "recursive", label: "searchModeRecursive", icon: FolderTree },
    { mode: "current", label: "searchModeCurrent", icon: FolderSearch },
  ];
  const searchPlaceholder = browseNavigation.searchMode === "global"
    ? t("searchAllDrives")
    : browseNavigation.searchMode === "recursive"
      ? t("searchModeRecursive")
      : t("searchModeCurrent");

  const runWindowAction = (action: "minimize" | "maximize" | "close") => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    const operation = action === "minimize"
      ? appWindow.minimize()
      : action === "maximize"
        ? appWindow.toggleMaximize()
        : appWindow.close();
    void operation
      .then(() => action === "maximize" ? appWindow.isMaximized() : null)
      .then((maximized) => {
        if (typeof maximized === "boolean") setWindowMaximized(maximized);
      })
      .catch(() => undefined);
  };

  const handleWindowDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!isTauri()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, input, select, textarea, a, [draggable='true'], [contenteditable='true']")) return;
    void getCurrentWindow().startDragging().catch(() => undefined);
  };

  return (
    <I18nProvider locale={preferences.locale}>
      <div
        className={`app-shell stage7-shell${ribbonCollapsed ? " is-ribbon-collapsed" : ""}`}
        data-workspace-mode={activePage}
      >
      <FlowBorder
        ref={flowRef}
        onStats={handleStats}
        onError={handleWorkerError}
      />
      <output className="live-metrics" hidden aria-hidden="true">
        <span>{stats.renderer === "webgl2-worker" ? "Worker GL" : "CSS"}</span>
        <span>{stats.fps} fps</span>
        <span>{stats.frameTimeMs.toFixed(2)} ms GPU submit</span>
        <span>{stats.messagesPerSecond} msg/s</span>
      </output>

      <Suspense fallback={null}>
        <ColorBendsBackground intensity="workspace" />
      </Suspense>

      <header className="stage7-header">
        <div className="stage7-topbar" onPointerDown={handleWindowDrag}>
          <button className="brand-lockup" type="button" aria-label={t("mullerHome")} onClick={openMullerHome}>
            <img className="brand-mark" src="/muller-icon.png" alt="" />
            <span className="brand-copy">
              <GradientText>Muller</GradientText>
            </span>
          </button>
          <WorkspaceTabs
            tabs={workspaceState.tabs}
            activeId={workspaceState.activeTabId}
            onActivate={(id) => { dispatchWorkspace({ type: "activate-tab", id }); setSystemRoute("workspace"); }}
            onAdd={addWorkspaceTab}
            onClose={(id) => dispatchWorkspace({ type: "close-tab", id })}
            onMove={(id, delta) => dispatchWorkspace({ type: "move-tab", id, delta })}
          />
          <div className="window-actions">
            <SpecularButton compact aria-label={t("commandPalette")} title={t("commandShortcut")} onClick={() => setCommandOpen(true)}><Command size={15} /></SpecularButton>
            <SpecularButton compact className={systemRoute === "settings" ? "is-active" : ""} aria-label={t("openSettings")} title={t("settingsShortcut")} aria-pressed={systemRoute === "settings"} onClick={() => { setSystemRoute("settings"); setFilterOpen(false); }}><SettingsIcon size={15} /></SpecularButton>
            <span className="window-action-divider" aria-hidden="true" />
            <button className="window-control" type="button" aria-label={t("minimizeWindow")} title={t("minimizeWindow")} onClick={() => runWindowAction("minimize")}><Minus size={15} /></button>
            <button
              className="window-control"
              type="button"
              aria-label={t(windowMaximized ? "restoreWindow" : "maximizeWindow")}
              title={t(windowMaximized ? "restoreWindow" : "maximizeWindow")}
              aria-pressed={windowMaximized}
              onClick={() => runWindowAction("maximize")}
            >
              {windowMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button className="window-control is-close" type="button" aria-label={t("closeWindow")} title={t("closeWindow")} onClick={() => runWindowAction("close")}><X size={15} /></button>
          </div>
        </div>
        <div className="stage7-addressbar">
          <div className="nav-actions">
            <SpecularButton compact title={t("back")} aria-label={t("back")} disabled={!addressMode || isThisPc || !explorerNavigation.canBack} onClick={() => { explorerRef.current?.back(); navigate("back"); }}><ArrowLeft size={16} /></SpecularButton>
            <SpecularButton compact title={t("forward")} aria-label={t("forward")} disabled={!addressMode || isThisPc || !explorerNavigation.canForward} onClick={() => { explorerRef.current?.forward(); navigate("enter"); }}><ArrowRight size={16} /></SpecularButton>
            <SpecularButton
              compact
              title={t("up")}
              aria-label={t("up")}
              disabled={!addressMode || isThisPc || (!explorerNavigation.canUp && !(explorerTool && (isDriveRoot(explorerNavigation.path) || isNetworkHostRoot(explorerNavigation.path))))}
              onClick={() => {
                if (explorerTool && (isDriveRoot(explorerNavigation.path) || isNetworkHostRoot(explorerNavigation.path))) openThisPcHome();
                else explorerRef.current?.up();
                navigate("back");
              }}
            >
              <ArrowUp size={16} />
            </SpecularButton>
          </div>
          {addressMode && !isThisPc ? (
            <div className="stage7-address-center">
              <ExplorerAddressBar
                paneLabel={explorerNavigation.activePane.toUpperCase()}
                value={explorerAddress}
                onChange={(value) => {
                  if (activeTool === "compare") setCompareAddress(value);
                  else setBrowseAddress(value);
                }}
                onNavigate={(path) => {
                  explorerRef.current?.navigateActive(path);
                  navigate("enter");
                }}
                onNavigateThisPc={openThisPcHome}
                onPaneToggle={() => explorerRef.current?.activatePane(explorerNavigation.activePane === "left" ? "right" : "left")}
              />
              {explorerMode ? (
                <label className="address-directory-search" role="search">
                  <div className="address-search-mode" ref={searchModeMenuRef}>
                    <button
                      type="button"
                      className="address-search-mode-button"
                      aria-label={t("chooseSearchMode")}
                      title={t(browseNavigation.searchMode === "global"
                        ? "searchModeGlobal"
                        : browseNavigation.searchMode === "recursive"
                          ? "searchModeRecursive"
                          : "searchModeCurrent")}
                      aria-expanded={searchModeMenuOpen}
                      onClick={() => setSearchModeMenuOpen((open) => !open)}
                    >
                      <SearchScopeIcon key={browseNavigation.searchMode} className="search-mode-icon" size={14} />
                    </button>
                    {searchModeMenuOpen ? (
                      <div className="address-search-mode-menu" role="menu" aria-label={t("searchMode")}>
                        {searchModeOptions.map(({ mode, label, icon: ModeIcon }) => (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={browseNavigation.searchMode === mode}
                            className={browseNavigation.searchMode === mode ? "is-active" : ""}
                            key={mode}
                            onClick={() => {
                              browseRef.current?.setSearchMode(mode);
                              play("navigate");
                              setSearchModeMenuOpen(false);
                              window.requestAnimationFrame(() => directorySearchRef.current?.focus());
                            }}
                          >
                            <ModeIcon size={14} /><span>{t(label)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <input
                    key={browseNavigation.searchMode}
                    className="address-search-input is-mode-changing"
                    ref={directorySearchRef}
                    aria-label={t("searchDirectory")}
                    placeholder={searchPlaceholder}
                    value={browseNavigation.searchQuery}
                    onChange={(event) => browseRef.current?.setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        browseRef.current?.setSearchQuery("");
                        event.currentTarget.blur();
                      } else if (event.key === "Enter") {
                        browseRef.current?.commitSearch();
                      }
                    }}
                  />
                  <span className="address-search-actions">
                    {browseNavigation.searchQuery ? (
                      <output>{browseNavigation.searchMode === "current"
                        ? `${formatNumber(browseNavigation.searchResultCount)} / ${formatNumber(browseNavigation.totalEntries)}`
                        : formatNumber(browseNavigation.searchResultCount)}</output>
                    ) : null}
                    <button
                      type="button"
                      className={`address-search-both-button${browseNavigation.searchBoth ? " is-active" : ""}`}
                      aria-label={t(browseNavigation.searchBoth ? "searchActivePane" : "searchBothPanes")}
                      title={t(browseNavigation.searchBoth ? "searchActivePane" : "searchBothPanes")}
                      aria-pressed={browseNavigation.searchBoth}
                      disabled={!browseNavigation.canSearchBoth}
                      onClick={() => {
                        browseRef.current?.setSearchBoth(!browseNavigation.searchBoth);
                        directorySearchRef.current?.focus();
                      }}
                    >
                      <Columns2 size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("closeSearch")}
                      title={t("closeSearch")}
                      disabled={!browseNavigation.searchQuery}
                      onClick={() => {
                        browseRef.current?.setSearchQuery("");
                        directorySearchRef.current?.focus();
                      }}
                    >
                      <X size={13} />
                    </button>
                  </span>
                </label>
              ) : null}
            </div>
          ) : systemRoute === "home" ? (
            <div className="stage7-context-path"><strong>Muller</strong></div>
          ) : systemRoute === "workspace" && isThisPc ? (
            <div className="stage7-context-path"><span>{t("browse").toUpperCase()}</span><strong>{t("thisPc")}</strong></div>
          ) : (
            <div className="stage7-context-path"><span>{activePage.toUpperCase()}</span><strong>{activePage === "settings" ? t("preferences") : displayPath(activeTab.path)}</strong></div>
          )}
          <div className="address-actions">
            {explorerMode && !isThisPc ? <SpecularButton compact className={activePathIsFavorite ? "is-active" : ""} title={activePathIsFavorite ? t("unpinSidebar") : t("pinSidebar")} aria-label={activePathIsFavorite ? t("unpinSidebar") : t("pinSidebar")} aria-pressed={activePathIsFavorite} onClick={toggleFavorite}>{activePathIsFavorite ? <PinOff size={16} /> : <Pin size={16} />}</SpecularButton> : null}
            <SpecularButton compact className={explorerNavigation.split && addressMode && !isThisPc ? "is-active" : ""} title={t("splitView")} aria-label={t("splitView")} disabled={!addressMode || isThisPc || activeTool === "album"} aria-pressed={addressMode && !isThisPc && explorerNavigation.split} onClick={() => explorerRef.current?.toggleSplit()}><Columns2 size={16} /></SpecularButton>
            <SpecularButton
              compact
              title={t(ribbonCollapsed ? "expandWorkspaceTools" : "collapseWorkspaceTools")}
              aria-label={t(ribbonCollapsed ? "expandWorkspaceTools" : "collapseWorkspaceTools")}
              aria-expanded={!ribbonCollapsed}
              onClick={() => updateRibbonCollapsed(!ribbonCollapsed)}
            >
              {ribbonCollapsed ? <PanelTopOpen size={16} /> : <PanelTopClose size={16} />}
            </SpecularButton>
          </div>
        </div>
      </header>

      <ToolRibbon
        mode={activeTool}
        presentation={activeTab.presentation}
        filterOpen={filterOpen}
        filterCount={filterCount}
        operationsCollapsed={fileActionsCollapsed && explorerMode && !isThisPc}
        onModeChange={activateTool}
        onPresentationChange={updatePresentation}
        onFilterToggle={() => setFilterOpen((open) => !open)}
        onOperationsExpand={() => updateFileActionsCollapsed(false)}
      />

      <LocationRail
        mode={preferences.sidebarMode}
        path={activeTab.path}
        virtualLocation={activeTab.virtualLocation}
        locations={quickLocations}
        soundEnabled={soundEnabled}
        onModeChange={(sidebarMode) => updatePreferences({ sidebarMode })}
        onNavigate={navigateQuickLocation}
        onTick={() => play("navigate")}
      />

      <main
        className={`${activeTool === "duplicates" && systemRoute === "workspace" ? "workspace stage7-workspace has-inspector" : "workspace stage7-workspace"}${filterOpen && explorerMode ? " has-filter" : ""}`}
        style={activeTool === "duplicates" ? { "--inspector-width": `${workspaceState.inspectorWidth}px` } as CSSProperties : undefined}
      >
        {systemRoute === "home" ? (
          <HomeDashboard
            currentPath={activeTab.path}
            scanStatus={t(scanStatusKey(scanState.status))}
            tabCount={workspaceState.tabs.length}
            searchRoots={globalSearchRoots}
            onOpen={activateTool}
            onOpenSearchResult={openHomeSearchResult}
            onClipboardChange={setFileClipboard}
            onSuccess={handleSuccess}
          />
        ) : systemRoute === "settings" ? (
          <SettingsPage preferences={preferences} onChange={updatePreferences} onReset={resetPreferences} />
        ) : null}

        {explorerTool && !isThisPc ? (
          <BrowseWorkspace
            key={activeTab.id}
            ref={browseRef}
            initialRoot={activeTab.path}
            routeVisible={systemRoute === "workspace"}
            presentation={activeTool === "album" ? "album" : activeTab.presentation}
            filter={directoryFilter}
            paneRatio={workspaceState.paneRatio}
            previewWidth={workspaceState.previewWidth}
            singlePane={activeTool === "album"}
            globalSearchRoots={globalSearchRoots}
            onPaneRatioChange={(value) => dispatchWorkspace({ type: "set-pane-ratio", value })}
            onPreviewWidthChange={(value) => dispatchWorkspace({ type: "set-preview-width", value })}
            onNavigationChange={handleBrowseNavigation}
            onScrollVelocity={sendScrollVelocity}
            onSuccess={handleSuccess}
            hoverDelayMs={preferences.hoverDelayMs}
            operationsCollapsed={fileActionsCollapsed}
            onOperationsCollapsedChange={updateFileActionsCollapsed}
            onCompareSelection={launchBrowseComparison}
            clipboard={fileClipboard}
            onClipboardChange={setFileClipboard}
          />
        ) : systemRoute !== "workspace" ? null : explorerTool && isThisPc ? (
          <ThisPcWorkspace onOpenDrive={openDrive} />
        ) : activeTool === "duplicates" ? (
          <section
            className={
              openDuplicateGroup
                ? "result-pane duplicate-result-pane has-group-detail"
                : duplicateSearchOpen
                ? "result-pane duplicate-result-pane has-search"
                : "result-pane duplicate-result-pane"
            }
            aria-label={t("duplicateResults")}
          >
            <div className="result-toolbar scan-toolbar">
              <form className="scan-actions" onSubmit={handleStartScan}>
                <label className="scan-root-field">
                  <FolderSearch size={16} />
                  <input
                    aria-label={t("scanLocation")}
                    value={scanRoot}
                    spellCheck={false}
                    onChange={(event) => {
                      resetScanCompletion();
                      setScanRoot(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Tab") return;
                      event.preventDefault();
                      void completeScanRoot(event.shiftKey);
                    }}
                  />
                </label>
                <button className="icon-button" type="button" aria-label={t("chooseScanFolders")} title={t("chooseScanFolders")} onClick={() => void chooseScanRoots()}>
                  <FolderPlus size={16} />
                </button>
                <label className="scan-min-size">
                  <span>{t("minimumBytes")}</span>
                  <input
                    aria-label={t("minimumBytes")}
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={minSize}
                    onChange={(event) => setMinSize(event.target.value)}
                  />
                </label>
                <button
                  className="command-button is-primary"
                  type="submit"
                  aria-label={t("startDuplicateScan")}
                  title={scanActive ? t("restartScan") : t("startScan")}
                  disabled={!scanInputValid}
                >
                  <Play size={15} fill="currentColor" />
                  <span>{scanActive ? t("restart") : t("scan")}</span>
                </button>
                <button
                  className="icon-button cancel-button"
                  type="button"
                  aria-label={t("cancelScan")}
                  title={t("cancelScan")}
                  disabled={!scanActive}
                  onClick={cancelScan}
                >
                  <Square size={14} fill="currentColor" />
                </button>
                <button
                  className={duplicateSearchOpen ? "icon-button is-active" : "icon-button"}
                  type="button"
                  aria-label={t("searchDuplicateResults")}
                  title={t("searchDuplicateShortcut")}
                  aria-pressed={duplicateSearchOpen}
                  onClick={openDuplicateSearch}
                >
                  <Search size={15} />
                </button>
              </form>
              {scanRoots.length > 0 ? (
                <div className="scan-root-list" aria-label={t("scanRoots")}>
                  {scanRoots.map((root) => (
                    <span key={root} title={displayPath(root)}>
                      {displayPath(root)}
                      <button type="button" aria-label={t("removePath", { path: displayPath(root) })} onClick={() => setScanRoots((current) => current.filter((item) => item !== root))}><X size={14} /></button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="scan-summary" aria-live="polite">
                <span className={`scan-status is-${scanState.status}`}>
                  {t(scanStatusKey(scanState.status))}
                </span>
                <strong>
                  {duplicateQuery.trim()
                    ? t("groupCount", { count: `${formatNumber(filteredDuplicateGroups.length)}/${formatNumber(scanState.groups.length)}` })
                    : t("groupCount", { count: formatNumber(scanState.groups.length) })}
                </strong>
                <span>{t("reclaimable", { size: formatBytes(scanState.reclaimableBytes) })}</span>
              </div>
            </div>

            {openDuplicateGroup ? (
              <DuplicateGroupDetail
                group={openDuplicateGroup}
                ordinal={openDuplicateGroupOrdinal}
                decisions={duplicateDecisions}
                error={duplicateDecisionError}
                onDecision={markDuplicatePath}
                onBack={() => {
                  setOpenDuplicateGroupHash(null);
                  play("navigate");
                }}
              />
            ) : (
            <>
            {duplicateSearchOpen ? (
              <DirectorySearchBar
                ref={duplicateSearchRef}
                label={t("searchDuplicateResults")}
                placeholder={t("filterDuplicatePaths")}
                query={duplicateQuery}
                status="ready"
                resultCount={filteredDuplicateGroups.length}
                totalCount={scanState.groups.length}
                onQueryChange={setDuplicateQuery}
                onCommit={() => duplicateListRef.current?.focus()}
                onClose={closeDuplicateSearch}
              />
            ) : null}

            <div className="duplicate-decision-toolbar">
              <button className="command-button" type="button" disabled={scanState.groups.length === 0} onClick={adoptSuggestions}>
                <CheckCheck size={15} /><span>{t("adoptSuggestions")}</span>
              </button>
              <button className="command-button" type="button" disabled={confirmedDuplicates.size === 0} onClick={selectConfirmedDuplicates}>
                <ListChecks size={15} /><span>{t("selectConfirmedDup")}</span>
              </button>
              <button className="command-button" type="button" disabled={duplicateFilePositions.length === 0} onClick={selectAllDuplicateFiles}>
                <ListChecks size={15} /><span>{t("selectAll")}</span>
              </button>
              <button className="command-button is-danger" type="button" disabled={!canRecycleSelected} onClick={openRecycleConfirmation}>
                <Trash2 size={15} /><span>{t("reviewCleanupCount", { count: formatNumber(cleanupCandidates.length) })}</span>
              </button>
              {duplicateDecisionError ? <span className="duplicate-decision-error" role="alert">{duplicateDecisionError}</span> : null}
            </div>

            <div className="scan-progress-row">
              <div
                className="scan-progress-track"
                role="progressbar"
                aria-label={t("scanProgress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent ?? undefined}
              >
                <span
                  className={progressPercent === null && scanActive ? "is-indeterminate" : ""}
                  style={{ width: progressPercent === null ? undefined : `${progressPercent}%` }}
                />
              </div>
              <span className="scan-phase">
                {scanState.progress
                  ? t(PHASE_LABELS[scanState.progress.phase])
                  : t(scanStatusKey(scanState.status))}
              </span>
              <span
                className={scanState.error ? "scan-detail is-error" : "scan-detail"}
                title={progressDetail}
              >
                {progressDetail}
              </span>
            </div>

            <div className="column-headings duplicate-column-headings" aria-hidden="true">
              <span>{t("file")}</span>
              <span>{t("created")}</span>
              <span>{t("modified")}</span>
              <span>{t("size")}</span>
              <span>{t("decision")}</span>
            </div>
            <VirtualDuplicateList
              ref={duplicateListRef}
              rows={duplicateRows}
              focusPosition={selectedDuplicatePosition}
              selectedPaths={selectedDuplicatePaths}
              decisions={duplicateDecisions}
              status={scanState.status}
              onSelect={selectDuplicatePosition}
              onDecision={markDuplicatePath}
              onOpenGroup={showDuplicateGroup}
              onScrollVelocity={sendScrollVelocity}
            />
            </>
            )}
          </section>
        ) : activeTool === "compare" ? (
          <CompareWorkspace
            key={activeTab.id}
            ref={compareRef}
            initialRoot={activeTab.path}
            onNavigationChange={handleCompareNavigation}
            onScrollVelocity={sendScrollVelocity}
            onSuccess={handleSuccess}
            launchRequest={compareLaunchRequest}
            onLaunchConsumed={(token) => setCompareLaunchRequest((current) => current?.token === token ? null : current)}
          />
        ) : null}

        {systemRoute === "workspace" && activeTool === "duplicates" ? (
        <>
        <button
          className="inspector-resizer"
          type="button"
          role="separator"
          aria-label={t("resizeScanInspector")}
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={420}
          aria-valuenow={Math.round(workspaceState.inspectorWidth)}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
            if (bounds) dispatchWorkspace({ type: "set-inspector-width", value: bounds.right - event.clientX });
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              dispatchWorkspace({ type: "set-inspector-width", value: workspaceState.inspectorWidth + (event.key === "ArrowLeft" ? 8 : -8) });
            }
          }}
        />
        <aside className="inspector" aria-label={t("signalInspector")}>
          <div className="inspector-heading">
            <span>{t("signalInspector")}</span>
            <Cpu size={16} />
          </div>

          <dl className="signal-grid">
                <div>
                  <dt>{t("task")}</dt>
                  <dd>{scanState.taskId ?? t("notAssigned")}</dd>
                </div>
                <div>
                  <dt>{t("phase")}</dt>
                  <dd>
                    {scanState.progress
                      ? t(PHASE_LABELS[scanState.progress.phase])
                      : t(scanStatusKey(scanState.status))}
                  </dd>
                </div>
                <div>
                  <dt>{t("processed")}</dt>
                  <dd>{formatNumber(scanState.progress?.processed ?? scanState.stats?.files_seen ?? 0)}</dd>
                </div>
                <div>
                  <dt>{t("candidates")}</dt>
                  <dd>{formatNumber(scanState.progress?.candidate_files ?? scanState.stats?.head_tail_candidate_files ?? 0)}</dd>
                </div>
                <div>
                  <dt>{t("bytesRead")}</dt>
                  <dd>
                    {formatBytes(
                      scanState.progress?.bytes_read ?? scanState.stats?.bytes_read ?? 0,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("skipped")}</dt>
                  <dd>{formatNumber(scanState.skipped.length)}</dd>
                </div>
          </dl>

          <div className="selected-file">
            <span>{t("selected")}</span>
            <strong>{selectedDuplicateFile ? t("duplicateFile") : t("noFileSelected")}</strong>
            <p>{displayPath(selectedDuplicateFile?.path ?? effectiveScanRoots.join("; "))}</p>
          </div>

          {scanState.error ? (
            <div className="worker-warning scan-warning" role="alert">
              <CircleAlert size={17} />
              <span>{scanState.error}</span>
            </div>
          ) : null}

          {workerError ? (
            <div className="worker-warning" role="status">
              <CircleAlert size={17} />
              <span>{workerError}</span>
            </div>
          ) : null}
        </aside>
        </>
        ) : null}
        {filterOpen && explorerMode ? (
          <WorkspaceFilterMenu
            filter={activeTab.filter}
            extensionOptions={extensionOptions}
            extensionsLoading={extensionsLoading}
            onChange={(filter) => dispatchWorkspace({ type: "update-active", patch: { filter } })}
            onClose={() => setFilterOpen(false)}
          />
        ) : null}
      </main>

      <footer className="statusbar">
        <span className="mode-indicator">
          {scanActive ? "SCAN" : activePage.toUpperCase()}
        </span>
        <span>
          {activePage === "duplicates"
            ? effectiveScanRoots.map(displayPath).join("; ")
            : activePage === "compare"
              ? displayPath(compareNavigation.path)
              : activePage === "home"
                ? "Muller"
              : activePage === "settings"
                ? displayPath(activeTab.path)
                : isThisPc ? t("thisPc") : displayPath(browseNavigation.path)}
        </span>
        <span className="key-buffer">
          {activePage === "duplicates"
            ? t(scanStatusKey(scanState.status))
            : activePage === "compare"
              ? t("pane", { name: compareNavigation.activePane.toUpperCase() })
              : activePage === "home"
                ? t("homeDashboard")
              : activePage === "settings"
                  ? t("applicationPreferences")
                : t("pane", { name: browseNavigation.activePane.toUpperCase() })}
        </span>
        <span className="status-selection">
          {activePage === "duplicates"
            ? `${selectedDuplicateOrdinal < 0 ? 0 : selectedDuplicateOrdinal + 1} / ${duplicateFilePositions.length}`
            : activePage === "compare"
              ? compareNavigation.editing
                ? t("editableMerge")
                : t("readOnlyComparison")
              : activePage === "settings"
                  ? t("settings")
                : activePage === "home"
                  ? t("openTabs", { count: formatNumber(workspaceState.tabs.length) })
                : browseNavigation.selectedName ?? t("noSelection")}
        </span>
      </footer>

      <CommandPalette
        open={commandOpen}
        items={commandItems}
        onClose={() => setCommandOpen(false)}
      />
      <SuccessBurst token={successToken} message={successMessage} />

      {recyclePrompt ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recycle-dialog-title"
          >
            <div className="confirmation-dialog-heading">
              <Trash2 size={17} />
              <h2 id="recycle-dialog-title">{t("reviewDuplicateCleanup")}</h2>
            </div>
            <dl>
              <div><dt>{t("files")}</dt><dd>{formatNumber(recyclePrompt.items.length)}</dd></div>
              <div><dt>{t("estimatedRelease")}</dt><dd>{formatBytes(recyclePrompt.items.reduce((total, item) => total + item.size, 0))}</dd></div>
            </dl>
            <div className="duplicate-cleanup-review">
              {recyclePrompt.items.map((item) => (
                <div key={item.path}>
                  <span title={displayPath(item.path)}>{displayPath(item.path)}</span>
                  <small>{t("cleanupFileDetail", {
                    created: item.createdUnixMs === null ? t("unknown") : formatDate(item.createdUnixMs, { dateStyle: "short", timeStyle: "medium" }),
                    modified: item.modifiedUnixMs === null ? t("unknown") : formatDate(item.modifiedUnixMs, { dateStyle: "short", timeStyle: "medium" }),
                    size: formatBytes(item.size),
                    count: formatNumber(item.hardLinkCount),
                  })}</small>
                  <button
                    type="button"
                    aria-label={t("removeFromCleanup", { path: displayPath(item.path) })}
                    title={t("removeCleanup")}
                    disabled={recycleBusy}
                    onClick={() => setRecyclePrompt((current) => current ? { items: current.items.filter((candidate) => candidate.path !== item.path) } : null)}
                  ><X size={14} /></button>
                </div>
              ))}
            </div>
            {recycleError ? <div className="dialog-error" role="alert">{recycleError}</div> : null}
            <div className="confirmation-dialog-actions">
              <button
                ref={recycleCancelRef}
                className="command-button"
                type="button"
                disabled={recycleBusy || recyclePrompt.items.length === 0}
                onClick={() => {
                  setRecyclePrompt(null);
                  setRecycleError(null);
                }}
              >
                {t("cancel")}
              </button>
              <button
                className="command-button is-danger"
                type="button"
                disabled={recycleBusy}
                onClick={() => void confirmRecycle()}
              >
                <Trash2 size={14} /> {recycleBusy ? t("moving") : t("moveToRecycleBin", { count: formatNumber(recyclePrompt.items.length) })}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      </div>
    </I18nProvider>
  );
}
