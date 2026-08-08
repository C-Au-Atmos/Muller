import { Info, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { formatBytes } from "../dedup/duplicateListModel";
import { loadDirectoryStatistics, type DirectoryStatistics } from "./fileOperationsClient";
import { displayPath } from "./pathDisplay";
import type { DirectoryEntry } from "./types";

export function MenuButton({
  icon,
  children,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}>
      {icon}<span>{children}</span>
    </button>
  );
}

export function DialogShell({
  title,
  icon,
  children,
  onClose,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useAppI18n();
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="explorer-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="explorer-dialog-heading">
          {icon}<h2>{title}</h2>
          <button className="icon-button" type="button" aria-label={t("close")} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function EntryPropertiesDialog({
  entry,
  onClose,
}: {
  entry: DirectoryEntry;
  onClose: () => void;
}) {
  const { t, formatDate, formatNumber } = useAppI18n();
  const [statistics, setStatistics] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    value: DirectoryStatistics | null;
  }>({ status: "idle", value: null });
  const statisticsRequest = useRef<{
    path: string;
    promise: Promise<DirectoryStatistics>;
  } | null>(null);

  useEffect(() => {
    if (entry.kind !== "directory") {
      setStatistics({ status: "idle", value: null });
      return;
    }
    let active = true;
    setStatistics({ status: "loading", value: null });
    const promise = statisticsRequest.current?.path === entry.path
      ? statisticsRequest.current.promise
      : loadDirectoryStatistics(entry.path);
    statisticsRequest.current = { path: entry.path, promise };
    void promise.then((value) => {
      if (active) setStatistics({ status: "ready", value });
    }).catch(() => {
      if (active) setStatistics({ status: "error", value: null });
    });
    return () => {
      active = false;
    };
  }, [entry]);

  return (
    <DialogShell title={t("properties")} icon={<Info size={17} />} onClose={onClose}>
      <dl className="properties-grid">
        <div><dt>{t("name")}</dt><dd>{entry.name}</dd></div>
        <div><dt>{t("type")}</dt><dd>{t(entry.kind === "directory" ? "folder" : entry.kind === "symlink" ? "link" : "file")}</dd></div>
        <div><dt>{t("size")}</dt><dd>{entry.kind === "file" ? formatBytes(entry.size) : statistics.status === "loading" ? t("calculating") : statistics.status === "ready" && statistics.value ? formatBytes(statistics.value.recursiveSize) : "-"}</dd></div>
        <div><dt>{t("modified")}</dt><dd>{entry.modifiedUnixMs === null ? "-" : formatDate(entry.modifiedUnixMs, { dateStyle: "short", timeStyle: "medium" })}</dd></div>
        {entry.kind === "directory" ? <div><dt>{t("childFiles")}</dt><dd>{statistics.status === "ready" && statistics.value ? formatNumber(statistics.value.childFileCount) : statistics.status === "loading" ? t("calculating") : "-"}</dd></div> : null}
        {entry.kind === "directory" ? <div><dt>{t("childFolders")}</dt><dd>{statistics.status === "ready" && statistics.value ? formatNumber(statistics.value.childDirectoryCount) : statistics.status === "loading" ? t("calculating") : "-"}</dd></div> : null}
        <div className="is-wide"><dt>{t("path")}</dt><dd>{displayPath(entry.path)}</dd></div>
      </dl>
    </DialogShell>
  );
}
