import { ArrowLeftRight, ChevronRight, Edit3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { displayPath } from "../explorer/pathDisplay";
import { completeDirectoryPath, shouldCompleteDirectoryPath } from "./windowsNavigationClient";

interface ExplorerAddressBarProps {
  paneLabel: string;
  value: string;
  onChange: (value: string) => void;
  onNavigate: (path: string) => void;
  onNavigateThisPc: () => void;
  onPaneToggle: () => void;
}

export function ExplorerAddressBar({ paneLabel, value, onChange, onNavigate, onNavigateThisPc, onPaneToggle }: ExplorerAddressBarProps) {
  const { t } = useAppI18n();
  const requestRevision = useRef(0);
  const completionTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const displayValue = displayPath(value);
  const breadcrumbs = useMemo(() => {
    const root = { label: t("thisPc"), path: "this-pc", virtual: true as const };
    if (/^\\\\/.test(displayValue)) {
      const parts = displayValue.slice(2).split("\\").filter(Boolean);
      return [root, ...parts.map((label, index) => ({ label: index === 0 ? `\\\\${label}` : label, path: `\\\\${parts.slice(0, index + 1).join("\\")}`, virtual: false as const }))];
    }
    const normalized = displayValue.replaceAll("/", "\\");
    const parts = normalized.split("\\").filter(Boolean);
    return [root, ...parts.map((label, index) => ({ label, path: `${parts.slice(0, index + 1).join("\\")}${index === 0 && /^[a-z]:$/i.test(label) ? "\\" : ""}`, virtual: false as const }))];
  }, [displayValue, t]);

  const beginEditing = useCallback(() => {
    setEditing(true);
    window.requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, []);

  useEffect(() => {
    const handleEdit = () => beginEditing();
    window.addEventListener("muller:edit-address", handleEdit);
    return () => window.removeEventListener("muller:edit-address", handleEdit);
  }, [beginEditing]);

  const loadCandidates = useCallback(async (input: string) => {
    const revision = ++requestRevision.current;
    if (!shouldCompleteDirectoryPath(input)) {
      setCandidates([]);
      setActiveIndex(-1);
      setOpen(false);
      return [];
    }
    try {
      const next = await completeDirectoryPath(input);
      if (revision !== requestRevision.current) return [];
      setCandidates(next);
      setActiveIndex(-1);
      setOpen(next.length > 0);
      return next;
    } catch {
      if (revision === requestRevision.current) {
        setCandidates([]);
        setActiveIndex(-1);
        setOpen(false);
      }
      return [];
    }
  }, []);

  useEffect(() => () => {
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
  }, []);

  const scheduleCandidates = useCallback((input: string) => {
    if (completionTimer.current !== null) {
      window.clearTimeout(completionTimer.current);
      completionTimer.current = null;
    }
    if (!shouldCompleteDirectoryPath(input)) {
      requestRevision.current += 1;
      setCandidates([]);
      setActiveIndex(-1);
      setOpen(false);
      return;
    }
    completionTimer.current = window.setTimeout(() => {
      completionTimer.current = null;
      void loadCandidates(input);
    }, 220);
  }, [loadCandidates]);

  const complete = useCallback(async (reverse: boolean) => {
    const available = candidates.length > 0 ? candidates : await loadCandidates(value);
    if (available.length === 0) return;
    const current = candidates.length > 0 ? activeIndex : -1;
    const next = reverse
      ? (current <= 0 ? available.length - 1 : current - 1)
      : (current + 1) % available.length;
    setActiveIndex(next);
    setOpen(true);
    onChange(available[next] ?? value);
  }, [activeIndex, candidates, loadCandidates, onChange, value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      void complete(event.shiftKey);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      requestRevision.current += 1;
      setOpen(false);
      setCandidates([]);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      requestRevision.current += 1;
      setOpen(false);
      setCandidates([]);
      setActiveIndex(-1);
      onNavigate(value);
      setEditing(false);
    }
  };

  return editing ? (
    <div className="compare-address-field address-combobox is-editing">
      <button className="address-pane-toggle" type="button" aria-label={t("switchPane")} title={`${t("switchPane")} (${paneLabel})`} onPointerDown={(event) => event.preventDefault()} onClick={onPaneToggle}>
        <ArrowLeftRight size={14} />
      </button>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={t("currentDirectory")}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="address-completion-list"
        aria-activedescendant={activeIndex >= 0 ? `address-completion-${activeIndex}` : undefined}
        value={displayValue}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          scheduleCandidates(next);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => window.setTimeout(() => { setOpen(false); setEditing(false); }, 100)}
        onKeyDown={handleKeyDown}
      />
      {open ? (
        <div id="address-completion-list" className="address-completion-list" role="listbox">
          {candidates.map((candidate, index) => (
            <button
              id={`address-completion-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              key={candidate}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(candidate);
                setOpen(false);
                onNavigate(candidate);
              }}
            >
              {displayPath(candidate)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  ) : (
    <div className="compare-address-field breadcrumb-address" aria-label={paneLabel}>
      <button className="address-pane-toggle" type="button" aria-label={t("switchPane")} title={`${t("switchPane")} (${paneLabel})`} onClick={onPaneToggle}>
        <ArrowLeftRight size={14} />
      </button>
      <div className="breadcrumb-address__segments">
        {breadcrumbs.map((crumb, index) => (
          <span className="breadcrumb-address__segment" key={crumb.path}>
            {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
            <button
              type="button"
              title={crumb.virtual ? t("thisPc") : crumb.path}
              data-drop-directory={crumb.virtual ? undefined : crumb.path}
              onClick={() => crumb.virtual ? onNavigateThisPc() : onNavigate(crumb.path)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
        <button className="breadcrumb-address__blank" type="button" aria-label={t("editAddress")} onClick={beginEditing} />
      </div>
      <button className="breadcrumb-address__edit" type="button" aria-label={t("editAddress")} title={t("editAddressShortcut")} onClick={beginEditing}><Edit3 size={13} /></button>
    </div>
  );
}
