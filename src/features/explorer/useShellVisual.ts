import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import {
  cancelShellVisual,
  startShellVisual,
  type ShellVisual,
  type ShellVisualPreference,
} from "./shellVisualClient";

interface ShellVisualState {
  status: "idle" | "loading" | "ready" | "cancelled" | "error";
  visual: ShellVisual | null;
  error: string | null;
}

const IDLE_STATE: ShellVisualState = { status: "idle", visual: null, error: null };

function ignoreFailure(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export function useShellVisual(
  path: string | null,
  logicalSize: number,
  preference: ShellVisualPreference,
  theme: string,
): ShellVisualState {
  const [state, setState] = useState<ShellVisualState>(IDLE_STATE);
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  const generationRef = useRef(0);
  const taskRef = useRef<number | null>(null);

  useEffect(() => {
    const updateVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (taskRef.current !== null) ignoreFailure(cancelShellVisual(taskRef.current));
    taskRef.current = null;
    if (!path || !isTauri() || !visible) {
      setState(IDLE_STATE);
      return;
    }
    let terminal = false;
    setState({ status: "loading", visual: null, error: null });
    void startShellVisual(path, logicalSize, preference, generation, theme, (event) => {
      if (event.generation !== generation || generationRef.current !== generation) return;
      if (event.type === "started") {
        taskRef.current = event.taskId;
      } else if (event.type === "ready") {
        terminal = true;
        taskRef.current = null;
        setState({ status: "ready", visual: event.visual, error: null });
      } else if (event.type === "cancelled") {
        terminal = true;
        taskRef.current = null;
        setState({ status: "cancelled", visual: null, error: null });
      } else {
        terminal = true;
        taskRef.current = null;
        setState({ status: "error", visual: null, error: event.message });
      }
    }).then((taskId) => {
      if (generationRef.current !== generation) ignoreFailure(cancelShellVisual(taskId));
      else if (!terminal) taskRef.current = taskId;
    }).catch((error) => {
      if (generationRef.current !== generation) return;
      setState({
        status: "error",
        visual: null,
        error: error instanceof Error ? error.message : "Unable to load Shell visual",
      });
    });
    return () => {
      generationRef.current += 1;
      if (taskRef.current !== null) ignoreFailure(cancelShellVisual(taskRef.current));
      taskRef.current = null;
    };
  }, [logicalSize, path, preference, theme, visible]);

  return state;
}
