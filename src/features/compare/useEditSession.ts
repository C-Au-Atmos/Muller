import { useCallback, useEffect, useRef, useState } from "react";

import {
  closeEditSession,
  openEditSession,
  rollbackEditSide,
  saveEditSide,
} from "./mutationClient";
import type { EditableDocumentInfo, EditSide } from "./types";

export interface EditableSideState extends EditableDocumentInfo {
  persistedText: string;
  dirty: boolean;
  canRollback: boolean;
}

export interface EditSessionState {
  phase: "idle" | "loading" | "ready";
  sessionId: number | null;
  left: EditableSideState | null;
  right: EditableSideState | null;
  busySide: EditSide | null;
  error: string | null;
  conflict: boolean;
}

const INITIAL_STATE: EditSessionState = {
  phase: "idle",
  sessionId: null,
  left: null,
  right: null,
  busySide: null,
  error: null,
  conflict: false,
};

function editableSide(document: EditableDocumentInfo): EditableSideState {
  return {
    ...document,
    persistedText: document.text,
    dirty: false,
    canRollback: false,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : fallback;
}

function isConflict(message: string): boolean {
  return message.includes("changed outside Muller");
}

export function useEditSession() {
  const [state, setState] = useState<EditSessionState>(INITIAL_STATE);
  const stateRef = useRef(state);
  const sessionRef = useRef<number | null>(null);
  const generationRef = useRef(0);

  const commitState = useCallback(
    (update: (current: EditSessionState) => EditSessionState) => {
      setState((current) => {
        const next = update(current);
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  const close = useCallback(() => {
    generationRef.current += 1;
    const sessionId = sessionRef.current;
    sessionRef.current = null;
    stateRef.current = INITIAL_STATE;
    setState(INITIAL_STATE);
    if (sessionId !== null) void closeEditSession(sessionId).catch(() => undefined);
  }, []);

  const open = useCallback(
    async (leftPath: string, rightPath: string) => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const previous = sessionRef.current;
      sessionRef.current = null;
      if (previous !== null) void closeEditSession(previous).catch(() => undefined);
      const loading = { ...INITIAL_STATE, phase: "loading" as const };
      stateRef.current = loading;
      setState(loading);
      try {
        const response = await openEditSession(leftPath, rightPath);
        if (generationRef.current !== generation) {
          void closeEditSession(response.sessionId).catch(() => undefined);
          return;
        }
        sessionRef.current = response.sessionId;
        commitState(() => ({
          phase: "ready",
          sessionId: response.sessionId,
          left: editableSide(response.left),
          right: editableSide(response.right),
          busySide: null,
          error: null,
          conflict: false,
        }));
      } catch (error) {
        if (generationRef.current !== generation) return;
        const message = errorMessage(error, "Unable to open editable comparison");
        commitState(() => ({
          ...INITIAL_STATE,
          error: message,
          conflict: isConflict(message),
        }));
      }
    },
    [commitState],
  );

  const updateText = useCallback(
    (side: EditSide, text: string) => {
      commitState((current) => {
        const document = current[side];
        if (!document || document.text === text) return current;
        return {
          ...current,
          [side]: {
            ...document,
            text,
            dirty: text !== document.persistedText,
          },
          error: null,
          conflict: false,
        };
      });
    },
    [commitState],
  );

  const save = useCallback(
    async (side: EditSide) => {
      const current = stateRef.current;
      const document = current[side];
      if (current.sessionId === null || !document || current.busySide !== null) return;
      const generation = generationRef.current;
      const sessionId = current.sessionId;
      commitState((value) => ({ ...value, busySide: side, error: null, conflict: false }));
      try {
        const report = await saveEditSide(sessionId, side, document.text);
        if (generationRef.current !== generation) return;
        commitState((value) => {
          const latest = value[side];
          if (!latest) return value;
          return {
            ...value,
            [side]: {
              ...latest,
              fingerprint: report.fingerprint,
              byteLen: report.fingerprint.size,
              persistedText: document.text,
              dirty: latest.text !== document.text,
              canRollback: true,
            },
            busySide: null,
          };
        });
      } catch (error) {
        if (generationRef.current !== generation) return;
        const message = errorMessage(error, "Unable to save file");
        commitState((value) => ({
          ...value,
          busySide: null,
          error: message,
          conflict: isConflict(message),
        }));
      }
    },
    [commitState],
  );

  const rollback = useCallback(
    async (side: EditSide) => {
      const current = stateRef.current;
      if (current.sessionId === null || !current[side] || current.busySide !== null) return;
      const generation = generationRef.current;
      commitState((value) => ({ ...value, busySide: side, error: null, conflict: false }));
      try {
        const report = await rollbackEditSide(current.sessionId, side);
        if (generationRef.current !== generation) return;
        commitState((value) => {
          const latest = value[side];
          if (!latest) return value;
          return {
            ...value,
            [side]: {
              ...latest,
              text: report.text,
              persistedText: report.text,
              dirty: false,
              canRollback: true,
              fingerprint: report.fingerprint,
              byteLen: report.fingerprint.size,
            },
            busySide: null,
          };
        });
      } catch (error) {
        if (generationRef.current !== generation) return;
        const message = errorMessage(error, "Unable to roll back file");
        commitState((value) => ({
          ...value,
          busySide: null,
          error: message,
          conflict: isConflict(message),
        }));
      }
    },
    [commitState],
  );

  useEffect(
    () => () => {
      generationRef.current += 1;
      if (sessionRef.current !== null) {
        void closeEditSession(sessionRef.current).catch(() => undefined);
      }
    },
    [],
  );

  return { state, open, close, updateText, save, rollback };
}
