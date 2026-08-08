import { Database, Disc3, HardDrive, Network, Usb, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { formatBytes } from "../dedup/duplicateListModel";
import { useAppI18n } from "../../i18n/i18n";
import { displayPath } from "./pathDisplay";
import { listLogicalDrives, type LogicalDrive } from "../shell/windowsNavigationClient";

interface ThisPcWorkspaceProps {
  onOpenDrive: (path: string) => void;
}

const DRIVE_ICONS: Record<string, LucideIcon> = {
  removable: Usb,
  network: Network,
  optical: Disc3,
  ramdisk: Database,
  fixed: HardDrive,
  unknown: HardDrive,
};

export function ThisPcWorkspace({ onOpenDrive }: ThisPcWorkspaceProps) {
  const { t, formatNumber } = useAppI18n();
  const [drives, setDrives] = useState<LogicalDrive[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    void listLogicalDrives()
      .then((next) => {
        if (current) setDrives(next);
      })
      .catch((reason) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, []);

  return (
    <section className="this-pc-workspace" aria-label={t("thisPc")}>
      <div className="this-pc-heading">
        <div><HardDrive size={18} /><strong>{t("thisPc")}</strong></div>
        <span>{t("driveCount", { count: formatNumber(drives.length) })}</span>
      </div>
      {loading ? <div className="this-pc-message">{t("loadingDrives")}</div> : null}
      {error ? <div className="this-pc-message is-error" role="alert">{error}</div> : null}
      {!loading && !error && drives.length === 0 ? (
        <div className="this-pc-message">{t("noDrives")}</div>
      ) : null}
      <div className="drive-grid">
        {drives.map((drive) => {
          const Icon = DRIVE_ICONS[drive.driveType] ?? HardDrive;
          const usedRatio = drive.totalBytes && drive.freeBytes !== null
            ? Math.max(0, Math.min(1, (drive.totalBytes - drive.freeBytes) / drive.totalBytes))
            : null;
          return (
            <button className="drive-item" type="button" key={drive.path} onDoubleClick={() => onOpenDrive(drive.path)} onKeyDown={(event) => {
              if (event.key === "Enter") onOpenDrive(drive.path);
            }}>
              <Icon size={24} aria-hidden="true" />
              <span className="drive-item__copy">
                <strong>{drive.label || t("localDisk")} ({displayPath(drive.path).replace("\\", "")})</strong>
                <small>{drive.fileSystem ?? drive.driveType}</small>
                {usedRatio !== null ? (
                  <span className="drive-capacity" aria-label={t("percentUsed", { count: formatNumber(Math.round(usedRatio * 100)) })}>
                    <i style={{ width: `${usedRatio * 100}%` }} />
                  </span>
                ) : null}
                <small>{drive.freeBytes !== null && drive.totalBytes !== null ? t("freeOf", { free: formatBytes(drive.freeBytes), total: formatBytes(drive.totalBytes) }) : t("capacityUnavailable")}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
