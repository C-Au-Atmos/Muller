import { useEffect, useRef, useState } from "react";

import { cancelFilePreview, startFilePreview } from "./previewClient";
import type { FilePreview, PreviewStatus } from "./types";

interface PreviewState {
  status: PreviewStatus;
  preview: FilePreview | null;
  error: string | null;
}

const IDLE_STATE: PreviewState = {
  status: "idle",
  preview: null,
  error: null,
};

function ignoreFailure(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export function useFilePreview(path: string | null) {
  const [state, setState] = useState<PreviewState>(IDLE_STATE);
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  const generationRef = useRef(0);
  const taskRef = useRef<number | null>(null);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (taskRef.current !== null) ignoreFailure(cancelFilePreview(taskRef.current));
    taskRef.current = null;
    if (!path || !visible) {
      setState(IDLE_STATE);
      return;
    }

    setState({ status: "loading", preview: null, error: null });
    let terminal = false;
    void startFilePreview(path, (event) => {
      if (generationRef.current !== generation) return;
      if (event.type === "started") {
        taskRef.current = event.taskId;
      } else if (event.type === "ready") {
        terminal = true;
        taskRef.current = null;
        setState({ status: "ready", preview: event.preview, error: null });
      } else if (event.type === "cancelled") {
        terminal = true;
        taskRef.current = null;
        setState({ status: "cancelled", preview: null, error: null });
      } else {
        terminal = true;
        taskRef.current = null;
        setState({ status: "error", preview: null, error: event.message });
      }
    })
      .then((taskId) => {
        if (generationRef.current !== generation) {
          ignoreFailure(cancelFilePreview(taskId));
        } else if (!terminal) {
          taskRef.current = taskId;
        }
      })
      .catch((error) => {
        if (generationRef.current !== generation) return;
        setState({
          status: "error",
          preview: null,
          error: error instanceof Error ? error.message : "Unable to load preview",
        });
      });

    return () => {
      generationRef.current += 1;
      if (taskRef.current !== null) ignoreFailure(cancelFilePreview(taskRef.current));
      taskRef.current = null;
    };
  }, [path, visible]);

  return state;
}
