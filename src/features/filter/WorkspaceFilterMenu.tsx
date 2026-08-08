import { CheckCheck, ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import { useEffect, type CSSProperties, type WheelEvent } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { SpecularButton } from "../../ui/react-bits/SpecularButton/SpecularButton";
import type { DateFilter, WorkspaceFilter } from "../../workspace/workspaceModel";

export interface ExtensionOption {
  extension: string;
  count: number;
}

interface CounterFieldProps {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}

function CounterField({ label, value, minimum, maximum, onChange }: CounterFieldProps) {
  const { t } = useAppI18n();
  const commit = (next: number) => onChange(Math.min(Math.max(next, minimum), maximum));
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    commit(value + (event.deltaY < 0 ? 1 : -1));
  };
  return (
    <div className="date-counter" onWheel={handleWheel}>
      <span>{label}</span>
      <SpecularButton compact aria-label={t("increase", { label })} onClick={() => commit(value + 1)}><ChevronUp size={12} /></SpecularButton>
      <input aria-label={label} type="number" min={minimum} max={maximum} value={value} onChange={(event) => commit(Number(event.target.value))} />
      <SpecularButton compact aria-label={t("decrease", { label })} onClick={() => commit(value - 1)}><ChevronDown size={12} /></SpecularButton>
    </div>
  );
}

interface WorkspaceFilterMenuProps {
  filter: WorkspaceFilter;
  extensionOptions: readonly ExtensionOption[];
  extensionsLoading?: boolean;
  onChange: (filter: WorkspaceFilter) => void;
  onClose: () => void;
}

export function WorkspaceFilterMenu({ filter, extensionOptions, extensionsLoading = false, onChange, onClose }: WorkspaceFilterMenuProps) {
  const { t, formatNumber } = useAppI18n();
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const now = new Date();
  const date: DateFilter = filter.date ?? {
    mode: "after",
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
  const updateDate = (patch: Partial<DateFilter>) => {
    const next = { ...date, ...patch };
    const lastDay = new Date(next.year, next.month, 0).getDate();
    next.day = Math.min(next.day, lastDay);
    onChange({ ...filter, date: next });
  };
  const toggleExtension = (extension: string) => {
    const extensions = filter.extensions.includes(extension)
      ? filter.extensions.filter((item) => item !== extension)
      : [...filter.extensions, extension];
    onChange({ ...filter, extensions });
  };
  return (
    <aside id="workspace-filter-menu" className="workspace-filter-menu" aria-label={t("filters")}>
      <div className="filter-menu__heading">
        <span>{t("filters")}</span>
        <SpecularButton compact aria-label={t("closeFilters")} title={t("closeFilters")} onClick={onClose}><X size={14} /></SpecularButton>
      </div>
      <section className="filter-section" style={{ "--stagger-index": 0 } as CSSProperties}>
        <div className="filter-section__title"><span>{t("extensions")}</span><small>{extensionsLoading ? t("scanning") : t("fileTypes", { count: formatNumber(extensionOptions.length) })}</small></div>
        <div className="extension-actions">
          <SpecularButton radius={5} onClick={() => onChange({ ...filter, extensions: extensionOptions.map((option) => option.extension) })}><CheckCheck size={14} /><span>{t("selectAll")}</span></SpecularButton>
          <SpecularButton radius={5} onClick={() => onChange({ ...filter, extensions: [] })}><X size={14} /><span>{t("clear")}</span></SpecularButton>
        </div>
        <div className="extension-wheel" role="group" aria-label={t("fileExtensions")}>
          {extensionOptions.map(({ extension, count }) => (
            <SpecularButton
              radius={5}
              key={extension}
              className={filter.extensions.includes(extension) ? "extension-option is-active" : "extension-option"}
              aria-pressed={filter.extensions.includes(extension)}
              onClick={() => toggleExtension(extension)}
            >
              <span>.{extension}</span><small>{formatNumber(count)}</small>
            </SpecularButton>
          ))}
          {!extensionsLoading && extensionOptions.length === 0 ? <span className="extension-empty">{t("noExtensions")}</span> : null}
        </div>
      </section>
      <section className="filter-section" style={{ "--stagger-index": 1 } as CSSProperties}>
        <div className="filter-section__title"><span>{t("modifiedDate")}</span><label><input type="checkbox" checked={filter.date !== null} onChange={(event) => onChange({ ...filter, date: event.target.checked ? date : null })} /><span>{t("enabled")}</span></label></div>
        <div className="date-mode" role="group" aria-label={t("dateBoundary")}>
          {(["before", "after"] as const).map((mode) => (
            <SpecularButton compact key={mode} className={date.mode === mode ? "is-active" : ""} aria-pressed={date.mode === mode} disabled={filter.date === null} onClick={() => updateDate({ mode })}>{t(mode)}</SpecularButton>
          ))}
        </div>
        <div className="date-counters" aria-disabled={filter.date === null}>
          <CounterField label={t("year")} value={date.year} minimum={1970} maximum={9999} onChange={(year) => updateDate({ year })} />
          <CounterField label={t("month")} value={date.month} minimum={1} maximum={12} onChange={(month) => updateDate({ month })} />
          <CounterField label={t("day")} value={date.day} minimum={1} maximum={new Date(date.year, date.month, 0).getDate()} onChange={(day) => updateDate({ day })} />
        </div>
      </section>
      <div className="filter-menu__footer" style={{ "--stagger-index": 2 } as CSSProperties}>
        <SpecularButton disabled={filter.extensions.length === 0 && filter.date === null} onClick={() => onChange({ extensions: [], date: null })}><RotateCcw size={13} /><span>{t("clear")}</span></SpecularButton>
      </div>
    </aside>
  );
}
