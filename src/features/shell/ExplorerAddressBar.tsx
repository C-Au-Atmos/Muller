import { ArrowLeftRight, ChevronRight, Edit3 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { isImeCompositionEvent } from "../../input/imeInput";
import { displayPath } from "../explorer/pathDisplay";
import { completeDirectoryPath, shouldCompleteDirectoryPath } from "./windowsNavigationClient";

interface ExplorerAddressBarProps {
  paneLabel: string;
  value: string;
  /** Actual navigation path; value may contain an unsubmitted editing draft. */
  committedValue: string;
  onChange: (value: string) => void;
  onNavigate: (path: string) => void;
  onNavigateThisPc: () => void;
  onPaneToggle: () => void;
  showPaneToggle?: boolean;
}

export function ExplorerAddressBar({ paneLabel, value, committedValue, onChange, onNavigate, onNavigateThisPc, onPaneToggle, showPaneToggle = true }: ExplorerAddressBarProps) {
  const { t } = useAppI18n();
  const requestRevision = useRef(0);
  const completionTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editingSessionRef = useRef(false);
  const displayValue = displayPath(committedValue);
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

  const closeSuggestions = useCallback(() => {
    requestRevision.current += 1;
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
    completionTimer.current = null;
    setOpen(false);
    setCandidates([]);
    setActiveIndex(-1);
  }, []);

  const beginEditing = useCallback(() => {
    closeSuggestions();
    onChange(committedValue);
    editingSessionRef.current = true;
    setEditing(true);
    // Repeated Ctrl+L selects the mounted input; first entry focuses in its ref.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [closeSuggestions, committedValue, onChange]);

  const attachInput = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    if (input) { input.focus(); input.select(); }
  }, []);

  const cancelEditing = useCallback(() => {
    if (!editingSessionRef.current) return;
    editingSessionRef.current = false;
    closeSuggestions();
    onChange(committedValue);
    setEditing(false);
  }, [closeSuggestions, committedValue, onChange]);

  const commitEditing = useCallback((path: string) => {
    editingSessionRef.current = false;
    closeSuggestions();
    setEditing(false);
    onNavigate(path);
  }, [closeSuggestions, onNavigate]);

  useLayoutEffect(() => {
    // A real navigation or pane change invalidates the previous edit session.
    editingSessionRef.current = false;
    closeSuggestions();
    setEditing(false);
  }, [closeSuggestions, committedValue]);

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
    requestRevision.current += 1;
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
  }, []);

  const scheduleCandidates = useCallback((input: string) => {
    // Invalidate in-flight responses immediately, before the new debounce starts.
    closeSuggestions();
    if (!shouldCompleteDirectoryPath(input)) return;
    completionTimer.current = window.setTimeout(() => {
      completionTimer.current = null;
      void loadCandidates(input);
    }, 220);
  }, [closeSuggestions, loadCandidates]);

  const complete = useCallback(async (reverse: boolean) => {
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
    completionTimer.current = null;
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
    if (event.defaultPrevented || isImeCompositionEvent(event.nativeEvent) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Tab") {
      event.preventDefault();
      void complete(event.shiftKey);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeSuggestions();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEditing();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitEditing(value);
    }
  };

  return editing ? (
    <div className="compare-address-field address-combobox is-editing">
      {showPaneToggle ? <button className="address-pane-toggle" type="button" aria-label={t("switchPane")} title={`${t("switchPane")} (${paneLabel})`} onPointerDown={(event) => event.preventDefault()} onClick={onPaneToggle}>
        <ArrowLeftRight size={14} />
      </button> : null}
      <input
        ref={attachInput}
        role="combobox"
        aria-label={t("currentDirectory")}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="address-completion-list"
        aria-activedescendant={activeIndex >= 0 ? `address-completion-${activeIndex}` : undefined}
        value={displayPath(value)}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          scheduleCandidates(next);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={cancelEditing}
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
                commitEditing(candidate);
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
      {showPaneToggle ? <button className="address-pane-toggle" type="button" aria-label={t("switchPane")} title={`${t("switchPane")} (${paneLabel})`} onClick={onPaneToggle}>
        <ArrowLeftRight size={14} />
      </button> : null}
      <div className="breadcrumb-address__segments">
        {breadcrumbs.map((crumb, index) => (
          <span className="breadcrumb-address__segment" key={crumb.path}>
            {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
            <button
              type="button"
              title={crumb.virtual ? t("thisPc") : crumb.path}
              data-drop-directory={crumb.virtual ? undefined : crumb.path}
              aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
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
