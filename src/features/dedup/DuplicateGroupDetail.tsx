import { ArrowLeft, Copy, Files, Link2, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { springTransition } from "../../animation/springPresets";
import { useAppI18n } from "../../i18n/i18n";
import { displayPath } from "../explorer/pathDisplay";
import type { DuplicateDecision, DuplicateDecisionMap } from "./duplicateDecisionModel";
import { formatBytes } from "./duplicateListModel";
import type { DuplicateGroup } from "./types";

interface DuplicateGroupDetailProps {
  group: DuplicateGroup;
  ordinal: number;
  decisions: DuplicateDecisionMap;
  error: string | null;
  onDecision: (path: string, decision: DuplicateDecision) => void;
  onBack: () => void;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

export function DuplicateGroupDetail({
  group,
  ordinal,
  decisions,
  error,
  onDecision,
  onBack,
}: DuplicateGroupDetailProps) {
  const { t, formatDate, formatNumber } = useAppI18n();
  const reducedMotion = useReducedMotion();
  return (
    <section className="duplicate-group-detail" aria-label={t("duplicateGroupDetail", { count: formatNumber(ordinal) })}>
      <header className="duplicate-group-detail__heading">
        <button className="icon-button" type="button" aria-label={t("backToDuplicateGroups")} title={t("backToDuplicateGroups")} onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <Files size={17} />
        <span>
          <strong>{t("group", { count: formatNumber(ordinal) })}</strong>
          <small>{t("itemCount", { count: formatNumber(group.files.length) })} · {formatBytes(group.size)}</small>
        </span>
        <code>{group.full_hash}</code>
      </header>
      <div className="duplicate-group-detail__legend">
        <span className="decision-keep"><ShieldCheck size={13} />{t("leftClickKeep")}</span>
        <span className="decision-duplicate"><Copy size={13} />{t("rightClickDiscard")}</span>
        {error ? <strong role="alert">{error}</strong> : null}
      </div>
      <div className="duplicate-group-detail__list">
        {group.files.map((file, index) => {
          const decision = decisions.get(file.path);
          return (
            <motion.button
              className={`duplicate-group-file${decision === "keep" ? " is-keep" : decision === "duplicate" ? " is-discard" : ""}`}
              type="button"
              data-selection-item="true"
              key={file.path}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reducedMotion ? { duration: 0 } : { ...springTransition("snappy", "subtle"), delay: Math.min(index, 10) * 0.018 }}
              title={displayPath(file.path)}
              onClick={() => onDecision(file.path, "keep")}
              onContextMenu={(event) => {
                event.preventDefault();
                onDecision(file.path, "duplicate");
              }}
            >
              <span className="duplicate-group-file__state">
                {decision === "keep" ? <ShieldCheck size={20} /> : <Copy size={20} />}
              </span>
              <span className="duplicate-group-file__identity">
                <strong>{fileName(file.path)}</strong>
                <small>{displayPath(file.path)}</small>
              </span>
              <span><small>{t("modified")}</small><strong>{file.modified_unix_ms === null ? t("unknown") : formatDate(file.modified_unix_ms, { dateStyle: "medium", timeStyle: "medium" })}</strong></span>
              <span><small>{t("size")}</small><strong>{formatBytes(file.size)}</strong></span>
              <span><small>{t("physicalLinks", { count: formatNumber(file.hard_link_count) })}</small>{file.hard_link_count > 1 ? <Link2 size={14} /> : null}</span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
