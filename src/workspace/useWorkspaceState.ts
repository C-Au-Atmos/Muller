import { useEffect, useMemo, useReducer } from "react";

import {
  activeWorkspaceTab,
  createInitialWorkspaceState,
  parseWorkspaceState,
  workspaceReducer,
} from "./workspaceModel";

const STORAGE_KEY = "muller.workspace.v3";
const LEGACY_STORAGE_KEYS = ["muller.workspace.v2", "muller.workspace.v1"] as const;

export function useWorkspaceState(initialPath: string) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    initialPath,
    (path) => {
      try {
        return parseWorkspaceState(
          window.localStorage.getItem(STORAGE_KEY) ??
            LEGACY_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(Boolean) ??
            null,
          path,
        );
      } catch {
        return createInitialWorkspaceState(path);
      }
    },
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Persistence is optional; private or quota-limited contexts remain usable.
    }
  }, [state]);

  const activeTab = useMemo(() => activeWorkspaceTab(state), [state]);
  return { state, activeTab, dispatch };
}
