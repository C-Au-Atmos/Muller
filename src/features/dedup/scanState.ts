import type {
  DesktopScanEvent,
  DuplicateGroup,
  ScanProgress,
  ScanStats,
  SkippedFile,
} from "./types";

export type ScanStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "done"
  | "cancelled"
  | "error";

export interface DedupScanState {
  status: ScanStatus;
  taskId: number | null;
  progress: ScanProgress | null;
  groups: DuplicateGroup[];
  reclaimableBytes: number;
  skipped: SkippedFile[];
  stats: ScanStats | null;
  error: string | null;
}

export type ScanAction =
  | { type: "start" }
  | { type: "bindTask"; taskId: number }
  | { type: "event"; event: DesktopScanEvent }
  | { type: "removePaths"; paths: readonly string[] }
  | { type: "localCancel" }
  | { type: "localError"; message: string };

export function createInitialScanState(): DedupScanState {
  return {
    status: "idle",
    taskId: null,
    progress: null,
    groups: [],
    reclaimableBytes: 0,
    skipped: [],
    stats: null,
    error: null,
  };
}

export function scanStateReducer(
  state: DedupScanState,
  action: ScanAction,
): DedupScanState {
  switch (action.type) {
    case "start":
      return { ...createInitialScanState(), status: "starting" };
    case "bindTask":
      return { ...state, taskId: action.taskId, status: "scanning" };
    case "localCancel":
      return { ...state, status: "cancelled", progress: null };
    case "localError":
      return { ...state, status: "error", error: action.message, progress: null };
    case "removePaths": {
      const removed = new Set(action.paths.map((path) => path.toLowerCase()));
      const groups = state.groups.flatMap((group) => {
        const suggestedPath = group.files[group.suggested_keep]?.path;
        const files = group.files.filter((file) => !removed.has(file.path.toLowerCase()));
        if (files.length < 2) return [];
        const suggestedIndex = suggestedPath
          ? files.findIndex((file) => file.path === suggestedPath)
          : 0;
        return [{ ...group, files, suggested_keep: Math.max(0, suggestedIndex) }];
      });
      const reclaimableBytes = groups.reduce(
        (total, group) => total + group.files.reduce(
          (groupTotal, file, index) =>
            index === group.suggested_keep || file.hard_link_count > 1
              ? groupTotal
              : groupTotal + file.size,
          0,
        ),
        0,
      );
      return { ...state, groups, reclaimableBytes };
    }
    case "event":
      return reduceDesktopEvent(state, action.event);
  }
}

function reduceDesktopEvent(
  state: DedupScanState,
  event: DesktopScanEvent,
): DedupScanState {
  if (state.taskId !== null && state.taskId !== event.taskId) return state;

  switch (event.type) {
    case "started":
      return { ...state, taskId: event.taskId, status: "scanning" };
    case "progress":
      return {
        ...state,
        taskId: event.taskId,
        status: "scanning",
        progress: event.progress,
      };
    case "groupFound": {
      const groups = state.groups.slice();
      const existing = groups.findIndex((group) => group.full_hash === event.group.full_hash);
      if (existing >= 0) groups[existing] = event.group;
      else groups.push(event.group);
      return { ...state, taskId: event.taskId, groups };
    }
    case "done": {
      const byHash = new Map(state.groups.map((group) => [group.full_hash, group]));
      const groups = event.groupOrder.flatMap((hash) => {
        const group = byHash.get(hash);
        if (!group) return [];
        byHash.delete(hash);
        return [group];
      });
      groups.push(...byHash.values());
      return {
        ...state,
        taskId: event.taskId,
        status: "done",
        progress: null,
        reclaimableBytes: event.reclaimableBytes,
        skipped: event.skipped,
        stats: event.stats,
        groups,
      };
    }
    case "cancelled":
      return { ...state, taskId: event.taskId, status: "cancelled", progress: null };
    case "error":
      return {
        ...state,
        taskId: event.taskId,
        status: "error",
        progress: null,
        error: event.message,
      };
  }
}
