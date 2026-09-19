import { isTauri } from "@tauri-apps/api/core";
import { Database, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAppI18n, type TranslationKey } from "../../i18n/i18n";
import {
  DISABLED_NATIVE_INDEXER,
  enableNativeIndexer,
  getNativeIndexerStatus,
  isNativeIndexerCancelled,
  nativeIndexerError,
  stopNativeIndexer,
  type NativeIndexerState,
  type NativeIndexerStatus,
} from "./nativeIndexerClient";
import "./NativeIndexerControl.css";

const STATE_LABELS: Record<NativeIndexerState, TranslationKey> = {
  disabled: "nativeIndexDisabled",
  starting: "nativeIndexStarting",
  building: "nativeIndexBuilding",
  ready: "nativeIndexReady",
  degraded: "nativeIndexDegraded",
  error: "nativeIndexError",
};

export function NativeIndexerControl({ roots, onAction }: {
  roots: readonly string[];
  onAction?: () => void;
}) {
  const { t, formatNumber } = useAppI18n();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(DISABLED_NATIVE_INDEXER);
  const [pending, setPending] = useState<"enable" | "stop" | null>(null);
  const [operationError, setOperationError] = useState<{ error: Error; action: "enable" | "stop" } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const native = isTauri();

  useEffect(() => {
    if (!native) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      let delay = 2_500;
      if (!document.hidden) {
        try {
          const next = await getNativeIndexerStatus();
          if (stopped) return;
          setStatus((previous) => Object.keys(next).every((key) =>
            previous[key as keyof NativeIndexerStatus] === next[key as keyof NativeIndexerStatus]) ? previous : next);
          if (next.state === "disabled" || next.state === "error") delay = 15_000;
        } catch (error) {
          if (stopped) return;
          setStatus((previous) => ({ ...previous, state: "error", message: nativeIndexerError(error).message }));
          delay = 15_000;
        }
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [native, refresh]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  const enable = async () => {
    setPending("enable");
    setOperationError(null);
    onAction?.();
    try {
      await enableNativeIndexer(roots);
    } catch (error) {
      setOperationError({ error: nativeIndexerError(error), action: "enable" });
    } finally {
      setPending(null);
      setRefresh((value) => value + 1);
    }
  };

  const stop = async () => {
    setPending("stop");
    setOperationError(null);
    onAction?.();
    try {
      await stopNativeIndexer();
    } catch (error) {
      setOperationError({ error: nativeIndexerError(error), action: "stop" });
    } finally {
      setPending(null);
      setRefresh((value) => value + 1);
    }
  };

  const state = pending === "enable" ? "starting" : status.state;
  const stateLabel = t(STATE_LABELS[state]);
  const busy = pending !== null || state === "starting" || state === "building";
  const canEnable = native && roots.length > 0 && !busy && state !== "ready";
  const canStop = native && status.state !== "disabled";

  return (
    <div className="native-indexer" ref={controlRef} data-state={state}>
      <button
        ref={triggerRef}
        className="native-indexer__trigger"
        type="button"
        aria-label={`${t("nativeIndexTitle")}: ${stateLabel}`}
        aria-expanded={open}
        aria-controls="native-indexer-panel"
        onClick={() => setOpen((value) => !value)}
        title={`${t("nativeIndexTitle")}: ${stateLabel}`}
      >
        <Database size={14} aria-hidden="true" />
        <span className="native-indexer__trigger-label">{t("nativeIndexShortTitle")}</span>
        <span className="native-indexer__dot" aria-hidden="true" />
        <span className="native-indexer__trigger-state">{stateLabel}</span>
      </button>
      {open ? (
        <section id="native-indexer-panel" className="native-indexer__panel" aria-label={t("nativeIndexTitle")}>
          <div className="native-indexer__heading">
            <strong>{t("nativeIndexTitle")}</strong>
            <button type="button" aria-label={t("nativeIndexClose")} onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={15} /></button>
          </div>
          <p>{t("nativeIndexDescription")}</p>
          <div className="native-indexer__status" role="status" aria-live="polite">
            <span className="native-indexer__dot" aria-hidden="true" />
            <span>{stateLabel}</span>
          </div>
          <dl className="native-indexer__counts">
            <div><dt>{t("nativeIndexEntries")}</dt><dd>{formatNumber(status.entries)}</dd></div>
            <div><dt>{t("nativeIndexVolumes")}</dt><dd>{formatNumber(status.volumes)}</dd></div>
          </dl>
          {operationError ? (
            <p className="native-indexer__notice" role="alert">
              {operationError.action === "enable" && isNativeIndexerCancelled(operationError.error)
                ? t("nativeIndexCancelled")
                : `${t(operationError.action === "stop" ? "nativeIndexStopError" : "nativeIndexStartError")} ${operationError.error.message}`}
            </p>
          ) : status.message ? <p className="native-indexer__notice">{status.message}</p> : null}
          {!native ? <p className="native-indexer__notice">{t("nativeIndexDesktopOnly")}</p>
            : state !== "ready" ? <p>{t("nativeIndexPermission")}</p> : null}
          {state !== "ready" ? (
            <button type="button" className="native-indexer__enable" disabled={!canEnable} onClick={() => void enable()}>
              <ShieldCheck size={15} aria-hidden="true" />
              {busy ? stateLabel : t("nativeIndexEnable")}
            </button>
          ) : null}
          {canStop ? (
            <button type="button" className="native-indexer__stop" disabled={pending !== null} onClick={() => void stop()}>
              {t(pending === "stop" ? "nativeIndexStopping" : "nativeIndexStop")}
            </button>
          ) : null}
          <details className="native-indexer__details">
            <summary>{t("nativeIndexDetails")}</summary>
            <dl><dt>{t("nativeIndexProvider")}</dt><dd>{status.provider}</dd></dl>
            <p>{t("nativeIndexHardLinkBoundary")}</p>
            <p>{t("nativeIndexSpaceBoundary")}</p>
          </details>
        </section>
      ) : null}
    </div>
  );
}
