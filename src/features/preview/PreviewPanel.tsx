import {
  File,
  FileImage,
  FileText,
  Folder,
  LoaderCircle,
  Pause,
  Pin,
  PinOff,
  Play,
  Presentation,
  X,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { useAppI18n, type TranslationKey } from "../../i18n/i18n";
import { isRawImageExtension } from "../album/imageFormats";
import { formatBytes } from "../dedup/duplicateListModel";
import {
  loadDirectoryStatistics,
  type DirectoryStatistics,
} from "../explorer/fileOperationsClient";
import { displayPath } from "../explorer/pathDisplay";
import type { DirectoryEntry } from "../explorer/types";
import { useShellVisual } from "../explorer/useShellVisual";
import { useFilePreview } from "./useFilePreview";

interface PreviewPanelProps {
  entry: DirectoryEntry | null;
  pinned: boolean;
  mediaAutoplay: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onMediaAutoplayChange: (enabled: boolean) => void;
  onClose: () => void;
}

export function PreviewPanel({
  entry,
  pinned,
  mediaAutoplay,
  onPinnedChange,
  onMediaAutoplayChange,
  onClose,
}: PreviewPanelProps) {
  const { t, formatDate, formatNumber } = useAppI18n();
  const rawEntry = entry?.kind === "file" && isRawImageExtension(entry.extension) ? entry : null;
  const pptxEntry = entry?.kind === "file" && entry.extension?.toLowerCase() === "pptx" ? entry : null;
  const shellPreviewEntry = rawEntry ?? pptxEntry;
  const state = useFilePreview(entry?.kind === "file" && !shellPreviewEntry ? entry.path : null);
  const shellVisual = useShellVisual(
    shellPreviewEntry?.path ?? null,
    512,
    "thumbnail",
    document.documentElement.dataset.theme ?? "dark",
  );
  const preview = state.preview;
  const directoryPath = entry?.kind === "directory" ? entry.path : null;
  const directoryStatisticsRequest = useRef<{
    path: string;
    promise: Promise<DirectoryStatistics>;
  } | null>(null);
  const [directoryStatistics, setDirectoryStatistics] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    value: DirectoryStatistics | null;
    error: string | null;
  }>({ status: "idle", value: null, error: null });
  const [streamMetadata, setStreamMetadata] = useState<{ duration: string | null; dimensions: string | null }>({
    duration: null,
    dimensions: null,
  });

  useEffect(() => setStreamMetadata({ duration: null, dimensions: null }), [preview?.path]);

  useEffect(() => {
    if (!directoryPath) {
      setDirectoryStatistics({ status: "idle", value: null, error: null });
      return;
    }
    let cancelled = false;
    setDirectoryStatistics({ status: "loading", value: null, error: null });
    const promise = directoryStatisticsRequest.current?.path === directoryPath
      ? directoryStatisticsRequest.current.promise
      : loadDirectoryStatistics(directoryPath);
    directoryStatisticsRequest.current = { path: directoryPath, promise };
    void promise
      .then((value) => {
        if (!cancelled) setDirectoryStatistics({ status: "ready", value, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDirectoryStatistics({
          status: "error",
          value: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [directoryPath]);

  const captureStreamMetadata = (event: SyntheticEvent<HTMLMediaElement>) => {
    const media = event.currentTarget;
    const duration = Number.isFinite(media.duration) ? formatMediaDuration(media.duration) : null;
    const video = media instanceof HTMLVideoElement ? media : null;
    setStreamMetadata({
      duration,
      dimensions: video && video.videoWidth > 0 && video.videoHeight > 0
        ? `${video.videoWidth} x ${video.videoHeight} px`
        : null,
    });
  };

  const autoplayWhenReady = (event: SyntheticEvent<HTMLMediaElement>) => {
    if (!mediaAutoplay) return;
    void event.currentTarget.play().catch(() => {
      // Native media policies may still require an explicit user gesture.
    });
  };

  return (
    <aside className="preview-panel" aria-label={t("filePreview")}>
      <div className="preview-heading">
        <span>{t("preview")}</span>
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
          <button className="icon-button" type="button" aria-label={t("closePreview")} onClick={onClose}>
            <X size={15} />
          </button>
        </span>
      </div>
      {!entry ? (
        <div className="preview-empty"><File size={24} /><span>{t("selectFilePreview")}</span></div>
      ) : entry.kind === "directory" ? (
        <div className="preview-folder">
          <div className="preview-file-heading" title={displayPath(entry.path)}>
            <Folder size={18} />
            <span><strong>{entry.name}</strong><small>{t("folder")}</small></span>
          </div>
          <div className="preview-folder__visual"><Folder size={42} /></div>
          <dl className="preview-metadata">
            <div>
              <dt>{t("size")}</dt>
              <dd>{directoryStatistics.status === "loading"
                ? t("calculating")
                : directoryStatistics.value
                  ? formatBytes(directoryStatistics.value.recursiveSize)
                  : "-"}</dd>
            </div>
            <div>
              <dt>{t("childFolders")}</dt>
              <dd>{directoryStatistics.status === "loading"
                ? t("calculating")
                : directoryStatistics.value
                  ? formatNumber(directoryStatistics.value.childDirectoryCount)
                  : "-"}</dd>
            </div>
            <div>
              <dt>{t("childFiles")}</dt>
              <dd>{directoryStatistics.status === "loading"
                ? t("calculating")
                : directoryStatistics.value
                  ? formatNumber(directoryStatistics.value.childFileCount)
                  : "-"}</dd>
            </div>
            <div><dt>{t("modified")}</dt><dd>{entry.modifiedUnixMs === null ? t("unknown") : formatDate(entry.modifiedUnixMs, { dateStyle: "short", timeStyle: "medium" })}</dd></div>
            <div><dt>{t("path")}</dt><dd title={displayPath(entry.path)}>{displayPath(entry.path)}</dd></div>
          </dl>
          {directoryStatistics.error ? <div className="preview-meta is-error" role="alert">{directoryStatistics.error}</div> : null}
        </div>
      ) : shellPreviewEntry ? (
        shellVisual.status === "loading" ? (
          <div className="preview-empty"><LoaderCircle className="spin" size={22} /><span>{t("loadingPreview")}</span></div>
        ) : shellVisual.error ? (
          <div className="preview-empty is-error">
            {pptxEntry ? <Presentation size={24} /> : <FileImage size={24} />}
            <strong>{t("previewUnavailable")}</strong><span>{shellVisual.error}</span>
          </div>
        ) : shellVisual.visual ? (
          <>
            <div className="preview-file-heading" title={displayPath(shellPreviewEntry.path)}>
              {pptxEntry ? <Presentation size={17} /> : <FileImage size={17} />}
              <span><strong>{shellPreviewEntry.name}</strong><small>{formatBytes(shellPreviewEntry.size)}</small></span>
            </div>
            <div className="preview-content">
              <img src={shellVisual.visual.dataUrl} alt={shellPreviewEntry.name} />
            </div>
            <div className="preview-meta"><span>{t("bytesLoaded", { bytes: formatBytes(shellVisual.visual.dataUrl.length) })}</span></div>
            <dl className="preview-metadata">
              <div><dt>{t("dimensions")}</dt><dd>{shellVisual.visual.width} x {shellVisual.visual.height} px</dd></div>
              <div><dt>{t("size")}</dt><dd>{formatBytes(shellVisual.visual.sourceBytes)}</dd></div>
              <div><dt>{t("modified")}</dt><dd>{shellVisual.visual.modifiedUnixMs === null ? t("unknown") : formatDate(shellVisual.visual.modifiedUnixMs, { dateStyle: "short", timeStyle: "medium" })}</dd></div>
              <div><dt>{t("path")}</dt><dd title={displayPath(shellPreviewEntry.path)}>{displayPath(shellPreviewEntry.path)}</dd></div>
            </dl>
          </>
        ) : (
          <div className="preview-empty">{pptxEntry ? <Presentation size={24} /> : <FileImage size={24} />}<span>{t("noPreview")}</span></div>
        )
      ) : state.status === "loading" ? (
        <div className="preview-empty"><LoaderCircle className="spin" size={22} /><span>{t("loadingPreview")}</span></div>
      ) : state.error ? (
        <div className="preview-empty is-error"><File size={24} /><strong>{t("previewUnavailable")}</strong><span>{state.error}</span></div>
      ) : preview ? (
        <>
          <div className="preview-file-heading" title={displayPath(preview.path)}>
            {preview.kind === "image" ? <FileImage size={17} /> : preview.kind === "text" ? <FileText size={17} /> : <File size={17} />}
            <span><strong>{preview.name}</strong><small>{formatBytes(preview.fileSize)}</small></span>
          </div>
          <div className="preview-content">
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
                {preview.artworkDataUrl ? <img src={preview.artworkDataUrl} alt="" /> : null}
                <audio autoPlay={mediaAutoplay} controls preload="metadata" src={convertFileSrc(preview.path)} onLoadedMetadata={captureStreamMetadata} onCanPlay={autoplayWhenReady} />
              </div>
            ) : preview.kind === "video" ? (
              <video autoPlay={mediaAutoplay} controls preload="metadata" src={convertFileSrc(preview.path)} onLoadedMetadata={captureStreamMetadata} onCanPlay={autoplayWhenReady} />
            ) : preview.kind === "text" && preview.text !== null ? (
              <pre>{preview.text}</pre>
            ) : (
              <div className="preview-empty"><File size={28} /><span>{preview.message ?? t("noInlinePreview")}</span></div>
            )}
          </div>
          <div className="preview-meta">
            <span>{preview.kind === "audio" || preview.kind === "video" ? t("streamedOnDemand") : t("bytesLoaded", { bytes: formatBytes(preview.bytesLoaded) })}</span>
            {preview.truncated ? <span>{t("previewTruncated")}</span> : null}
          </div>
          <dl className="preview-metadata">
            <div><dt>{t("created")}</dt><dd>{preview.createdUnixMs === null ? t("unknown") : formatDate(preview.createdUnixMs, { dateStyle: "short", timeStyle: "medium" })}</dd></div>
            <div><dt>{t("modified")}</dt><dd>{preview.modifiedUnixMs === null ? t("unknown") : formatDate(preview.modifiedUnixMs, { dateStyle: "short", timeStyle: "medium" })}</dd></div>
            <div><dt>{t("accessed")}</dt><dd>{preview.accessedUnixMs === null ? t("unknown") : formatDate(preview.accessedUnixMs, { dateStyle: "short", timeStyle: "medium" })}</dd></div>
            {streamMetadata.duration && !preview.metadata.some((field) => field.label === "Duration") ? <div><dt>{t("duration")}</dt><dd>{streamMetadata.duration}</dd></div> : null}
            {streamMetadata.dimensions && !preview.metadata.some((field) => field.label === "Dimensions") ? <div><dt>{t("dimensions")}</dt><dd>{streamMetadata.dimensions}</dd></div> : null}
            {preview.metadata.map((field) => (
              <div key={`${field.label}-${field.value}`}>
                <dt>{translateMetadataLabel(field.label, t)}</dt><dd title={field.label === "Path" ? displayPath(field.value) : field.value}>{field.label === "Path" ? displayPath(field.value) : field.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <div className="preview-empty"><File size={24} /><span>{t("noPreview")}</span></div>
      )}
    </aside>
  );
}

function translateMetadataLabel(label: string, t: (key: TranslationKey) => string): string {
  const keys: Record<string, TranslationKey> = {
    Accessed: "accessed",
    Created: "created",
    Dimensions: "dimensions",
    Duration: "duration",
    Modified: "modified",
    Path: "path",
    Size: "size",
    Type: "type",
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
