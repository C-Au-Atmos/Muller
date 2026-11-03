import {
  ChevronDown, File, FileImage, FileText, Folder, LoaderCircle,
  Music2, Pause, Pin, PinOff, Play, Presentation, X,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";

import { useAppI18n, type TranslationKey } from "../../i18n/i18n";
import { isImeCompositionEvent } from "../../input/imeInput";
import { isRawImageExtension } from "../album/imageFormats";
import { formatBytes } from "../dedup/duplicateListModel";
import { loadDirectoryStatistics, type DirectoryStatistics } from "../explorer/fileOperationsClient";
import { displayPath } from "../explorer/pathDisplay";
import type { DirectoryEntry } from "../explorer/types";
import { useShellVisual } from "../explorer/useShellVisual";
import type { FilePreview } from "./types";
import { useFilePreview } from "./useFilePreview";
import "./PreviewPanel.css";

interface PreviewPanelProps {
  entry: DirectoryEntry | null;
  pinned: boolean;
  mediaAutoplay: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onMediaAutoplayChange: (enabled: boolean) => void;
  onClose: () => void;
  variant?: "browse" | "embedded";
}

export function PreviewPanel({
  entry, pinned, mediaAutoplay, onPinnedChange, onMediaAutoplayChange, onClose, variant = "browse",
}: PreviewPanelProps) {
  const { t } = useAppI18n();
  return (
    <aside
      className={`preview-panel preview-panel--studio preview-panel--${variant}`}
      aria-label={t("filePreview")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || isImeCompositionEvent(event.nativeEvent)
          || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("input, textarea, select, [contenteditable=true], [role=menu], [role=dialog]")) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="preview-heading">
        <span className="preview-heading__label">{t("preview")}</span>
        <span className="preview-heading__actions">
          <button
            className={mediaAutoplay ? "icon-button is-active" : "icon-button"}
            type="button"
            aria-label={t(mediaAutoplay ? "disableMediaAutoplay" : "enableMediaAutoplay")}
            title={t(mediaAutoplay ? "disableMediaAutoplay" : "enableMediaAutoplay")}
            aria-pressed={mediaAutoplay}
            onClick={() => onMediaAutoplayChange(!mediaAutoplay)}
          >
            {mediaAutoplay ? <Pause size={14} /> : <Play size={14} />}
          </button>
          {variant === "browse" ? (
            <button
              className={pinned ? "icon-button is-active" : "icon-button"}
              type="button"
              aria-label={t(pinned ? "unpinPreview" : "pinPreview")}
              title={t(pinned ? "unpinPreview" : "pinPreview")}
              aria-pressed={pinned}
              onClick={() => onPinnedChange(!pinned)}
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          ) : null}
          <button className="icon-button" type="button" aria-label={t("closePreview")} title={t("closePreview")} onClick={onClose}>
            <X size={15} />
          </button>
        </span>
      </div>
      {entry ? (
        // Remount readers and media together: new selections must not paint the old
        // file, retain its playback, or inherit late directory/Shell metadata.
        <PreviewSelection
          key={`${entry.path}\0${entry.kind}\0${entry.kind === "file" ? `${entry.size}/${entry.modifiedUnixMs}` : ""}`}
          entry={entry}
          mediaAutoplay={mediaAutoplay}
        />
      ) : (
        <div className="preview-empty preview-empty--selection"><File size={28} /><span>{t("selectFilePreview")}</span></div>
      )}
    </aside>
  );
}

function PreviewSelection({ entry, mediaAutoplay }: { entry: DirectoryEntry; mediaAutoplay: boolean }) {
  const { t } = useAppI18n();
  const isDirectory = entry.kind === "directory";
  const isPresentation = entry.extension?.toLowerCase() === "pptx";
  const isShellPreview = entry.kind === "file" && (isRawImageExtension(entry.extension) || isPresentation);
  const typeLabel = isDirectory ? t("folder") : entry.extension
    ? t("fileType", { extension: entry.extension.toUpperCase() })
    : t("file");
  return (
    <div className={`preview-selection${isDirectory ? " preview-folder" : ""}`}>
      <div className="preview-file-heading" title={displayPath(entry.path)}>
        <span className="preview-file-heading__icon" aria-hidden="true">
          {isDirectory ? <Folder size={20} /> : isPresentation ? <Presentation size={20} /> : isShellPreview ? <FileImage size={20} /> : <File size={20} />}
        </span>
        <span className="preview-file-heading__identity">
          <strong>{entry.name}</strong>
          <small><span className="preview-type">{typeLabel}</span>{!isDirectory ? <span>{formatBytes(entry.size)}</span> : null}</small>
        </span>
      </div>
      {isDirectory ? <FolderPreview entry={entry} /> : isShellPreview ? (
        <ShellPreview entry={entry} isPresentation={isPresentation} />
      ) : entry.kind === "file" ? <FileContentPreview path={entry.path} mediaAutoplay={mediaAutoplay} /> : <PreviewStatus loading={false} error={null} icon={<File size={28} />} />}
    </div>
  );
}

function FolderPreview({ entry }: { entry: DirectoryEntry }) {
  const { t, formatDate, formatNumber } = useAppI18n();
  const request = useRef<Promise<DirectoryStatistics> | null>(null);
  const [statistics, setStatistics] = useState<DirectoryStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const promise = request.current ?? loadDirectoryStatistics(entry.path);
    request.current = promise;
    void promise.then((value) => {
      if (!cancelled) setStatistics(value);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [entry.path]);
  const loading = !statistics && !error;
  return (
    <>
      <div className="preview-content preview-content--folder" aria-busy={loading}>
        <div className="preview-folder__visual"><Folder size={48} strokeWidth={1.15} /></div>
        <div className="preview-folder__size">
          <span>{t("size")}</span>
          <strong>{loading ? <LoaderCircle className="spin" size={22} aria-label={t("calculating")} /> : statistics ? formatBytes(statistics.recursiveSize) : "—"}</strong>
        </div>
        <div className="preview-folder__counts">
          <div><strong>{statistics ? formatNumber(statistics.childDirectoryCount) : "—"}</strong><span>{t("childFolders")}</span></div>
          <div><strong>{statistics ? formatNumber(statistics.childFileCount) : "—"}</strong><span>{t("childFiles")}</span></div>
        </div>
      </div>
      {error ? <div className="preview-meta is-error" role="alert">{error}</div> : null}
      <PreviewMetadata>
        <MetadataRow label={t("modified")} value={entry.modifiedUnixMs === null ? t("unknown") : formatDate(entry.modifiedUnixMs, { dateStyle: "short", timeStyle: "medium" })} />
        <MetadataRow label={t("path")} value={displayPath(entry.path)} />
      </PreviewMetadata>
    </>
  );
}

function ShellPreview({ entry, isPresentation }: { entry: DirectoryEntry; isPresentation: boolean }) {
  const { t, formatDate } = useAppI18n();
  const state = useShellVisual(entry.path, 512, "thumbnail", document.documentElement.dataset.theme ?? "dark");
  const visual = state.visual;
  const icon = isPresentation ? <Presentation size={28} /> : <FileImage size={28} />;
  return visual ? (
    <>
      <div className="preview-content preview-content--image"><img src={visual.dataUrl} alt={entry.name} /></div>
      <div className="preview-meta"><span>{visual.width} × {visual.height} px</span><span className="preview-type">{entry.extension?.toUpperCase()}</span></div>
      <PreviewMetadata>
        <MetadataRow label={t("dimensions")} value={`${visual.width} x ${visual.height} px`} />
        <MetadataRow label={t("size")} value={formatBytes(visual.sourceBytes)} />
        <MetadataRow label={t("modified")} value={visual.modifiedUnixMs === null ? t("unknown") : formatDate(visual.modifiedUnixMs, { dateStyle: "short", timeStyle: "medium" })} />
        <MetadataRow label={t("path")} value={displayPath(entry.path)} />
      </PreviewMetadata>
    </>
  ) : <PreviewStatus loading={state.status === "loading"} error={state.error} icon={icon} />;
}

function FileContentPreview({ path, mediaAutoplay }: { path: string; mediaAutoplay: boolean }) {
  const state = useFilePreview(path);
  return state.preview ? <ReadyFilePreview preview={state.preview} mediaAutoplay={mediaAutoplay} /> : (
    <PreviewStatus loading={state.status === "loading" || state.status === "idle"} error={state.error} icon={<FileText size={28} />} />
  );
}

function PreviewStatus({ loading, error, icon }: { loading: boolean; error: string | null; icon: ReactNode }) {
  const { t } = useAppI18n();
  return (
    <div className={`preview-content preview-content--status${error ? " is-error" : ""}`} aria-busy={loading}>
      <div className={`preview-empty${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
        {loading ? <LoaderCircle className="spin" size={24} /> : icon}
        {error ? <><strong>{t("previewUnavailable")}</strong><span>{error}</span></> : <span>{t(loading ? "loadingPreview" : "noPreview")}</span>}
      </div>
    </div>
  );
}

function ReadyFilePreview({ preview, mediaAutoplay }: { preview: FilePreview; mediaAutoplay: boolean }) {
  const { t, formatDate } = useAppI18n();
  const [streamMetadata, setStreamMetadata] = useState<{ duration: string | null; dimensions: string | null }>({ duration: null, dimensions: null });
  const captureStreamMetadata = (event: SyntheticEvent<HTMLMediaElement>) => {
    const media = event.currentTarget;
    const video = media instanceof HTMLVideoElement ? media : null;
    setStreamMetadata({
      duration: Number.isFinite(media.duration) ? formatMediaDuration(media.duration) : null,
      dimensions: video && video.videoWidth > 0 && video.videoHeight > 0 ? `${video.videoWidth} x ${video.videoHeight} px` : null,
    });
  };
  const autoplayWhenReady = (event: SyntheticEvent<HTMLMediaElement>) => {
    if (!mediaAutoplay) return;
    void event.currentTarget.play().catch(() => {
      // Native media policies may still require an explicit user gesture.
    });
  };
  return (
    <>
      <div className={`preview-content preview-content--${preview.kind}`}>
        {preview.kind === "image" && preview.dataUrl ? (
          <img
            src={preview.extension?.toLowerCase() === "gif" ? convertFileSrc(preview.path) : preview.dataUrl}
            alt={preview.name}
            onError={(event) => {
              const fallback = preview.dataUrl;
              if (fallback && event.currentTarget.src !== fallback) event.currentTarget.src = fallback;
            }}
          />
        ) : preview.kind === "audio" ? (
          <div className="audio-preview">
            {preview.artworkDataUrl ? <img src={preview.artworkDataUrl} alt="" /> : <div className="audio-preview__placeholder"><Music2 size={48} strokeWidth={1.2} /></div>}
            <audio autoPlay={mediaAutoplay} controls preload="metadata" src={convertFileSrc(preview.path)} onLoadedMetadata={captureStreamMetadata} onCanPlay={autoplayWhenReady} />
          </div>
        ) : preview.kind === "video" ? (
          <video autoPlay={mediaAutoplay} controls preload="metadata" src={convertFileSrc(preview.path)} onLoadedMetadata={captureStreamMetadata} onCanPlay={autoplayWhenReady} />
        ) : preview.kind === "text" && preview.text !== null ? (
          <pre tabIndex={0} aria-label={t("filePreview")}>{preview.text}</pre>
        ) : (
          <div className="preview-empty"><File size={28} /><span>{preview.message ?? t("noInlinePreview")}</span></div>
        )}
      </div>
      <div className="preview-meta">
        <span>{preview.kind === "audio" || preview.kind === "video" ? t("streamedOnDemand") : t("bytesLoaded", { bytes: formatBytes(preview.bytesLoaded) })}</span>
        {preview.truncated ? <span className="preview-meta__notice">{t("previewTruncated")}</span> : null}
      </div>
      <PreviewMetadata>
        <MetadataRow label={t("created")} value={preview.createdUnixMs === null ? t("unknown") : formatDate(preview.createdUnixMs, { dateStyle: "short", timeStyle: "medium" })} />
        <MetadataRow label={t("modified")} value={preview.modifiedUnixMs === null ? t("unknown") : formatDate(preview.modifiedUnixMs, { dateStyle: "short", timeStyle: "medium" })} />
        <MetadataRow label={t("accessed")} value={preview.accessedUnixMs === null ? t("unknown") : formatDate(preview.accessedUnixMs, { dateStyle: "short", timeStyle: "medium" })} />
        {streamMetadata.duration && !preview.metadata.some((field) => field.label === "Duration") ? <MetadataRow label={t("duration")} value={streamMetadata.duration} /> : null}
        {streamMetadata.dimensions && !preview.metadata.some((field) => field.label === "Dimensions") ? <MetadataRow label={t("dimensions")} value={streamMetadata.dimensions} /> : null}
        {preview.metadata.map((field) => (
          <MetadataRow key={`${field.label}-${field.value}`} label={translateMetadataLabel(field.label, t)} value={field.label === "Path" ? displayPath(field.value) : field.value} />
        ))}
      </PreviewMetadata>
    </>
  );
}

function PreviewMetadata({ children }: { children: ReactNode }) {
  const { t } = useAppI18n();
  return (
    <details className="preview-details">
      <summary><span>{t("properties")}</span><ChevronDown size={14} aria-hidden="true" /></summary>
      <dl className="preview-metadata">{children}</dl>
    </details>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd title={value}>{value}</dd></div>;
}

function translateMetadataLabel(label: string, t: (key: TranslationKey) => string): string {
  const keys: Record<string, TranslationKey> = {
    Accessed: "accessed", Created: "created", Dimensions: "dimensions", Duration: "duration",
    Modified: "modified", Path: "path", Size: "size", Type: "type",
  };
  return keys[label] ? t(keys[label]) : label;
}

function formatMediaDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
