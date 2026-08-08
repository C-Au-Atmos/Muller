import { useEffect, useRef, useState } from "react";

import { cancelImageThumbnail, startImageThumbnail } from "./thumbnailClient";
import type { ImageThumbnail, ThumbnailStatus } from "./types";

interface ThumbnailState {
  status: ThumbnailStatus;
  thumbnail: ImageThumbnail | null;
  error: string | null;
}

const IDLE_STATE: ThumbnailState = { status: "idle", thumbnail: null, error: null };

function ignoreFailure(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export function useImageThumbnail(path: string | null, maxEdge = 360): ThumbnailState {
  const [state, setState] = useState<ThumbnailState>(IDLE_STATE);
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
    if (taskRef.current !== null) ignoreFailure(cancelImageThumbnail(taskRef.current));
    taskRef.current = null;
    if (!path || !visible) {
      setState(IDLE_STATE);
      return;
    }
    setState({ status: "loading", thumbnail: null, error: null });
    let terminal = false;
    void startImageThumbnail(path, maxEdge, (event) => {
      if (generationRef.current !== generation) return;
      if (event.type === "started") taskRef.current = event.taskId;
      else if (event.type === "ready") {
        terminal = true;
        taskRef.current = null;
        setState({ status: "ready", thumbnail: event.thumbnail, error: null });
      } else if (event.type === "cancelled") {
        terminal = true;
        taskRef.current = null;
        setState({ status: "cancelled", thumbnail: null, error: null });
      } else {
        terminal = true;
        taskRef.current = null;
        setState({ status: "error", thumbnail: null, error: event.message });
      }
    })
      .then((taskId) => {
        if (generationRef.current !== generation) ignoreFailure(cancelImageThumbnail(taskId));
        else if (!terminal) taskRef.current = taskId;
      })
      .catch((error) => {
        if (generationRef.current !== generation) return;
        setState({
          status: "error",
          thumbnail: null,
          error: error instanceof Error ? error.message : "Unable to load thumbnail",
        });
      });
    return () => {
      generationRef.current += 1;
      if (taskRef.current !== null) ignoreFailure(cancelImageThumbnail(taskRef.current));
      taskRef.current = null;
    };
  }, [maxEdge, path, visible]);

  return state;
}
