import { ClipboardCopy, Columns2, Copy, CopyCheck, FolderOpen, Images, Info, LoaderCircle, Scissors, Search, Settings2, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";

import { springTransition } from "../../animation/springPresets";
import { useAppI18n, type TranslationKey } from "../../i18n/i18n";
import { SpecularButton } from "../../ui/react-bits/SpecularButton/SpecularButton";
import type { WorkspaceMode } from "../../workspace/workspaceModel";
import { formatBytes } from "../dedup/duplicateListModel";
import { EntryPropertiesDialog, MenuButton } from "../explorer/ExplorerOverlays";
import { displayPath } from "../explorer/pathDisplay";
import type { DirectoryEntry, FileClipboardState, TransferMode } from "../explorer/types";
import { useDirectoryPane } from "../explorer/useDirectoryPane";

interface HomeDashboardProps {
  currentPath: string;
  scanStatus: string;
  tabCount: number;
  searchRoots: readonly string[];
  onOpen: (mode: WorkspaceMode) => void;
  onOpenSearchResult: (entry: DirectoryEntry) => void;
  onClipboardChange: (clipboard: FileClipboardState) => void;
  onSuccess: (message: string) => void;
}

const ACTIONS = [
  { mode: "browse", title: "browse", detail: "openActiveLocation", icon: FolderOpen },
  { mode: "duplicates", title: "duplicates", detail: "findIdenticalContent", icon: CopyCheck },
  { mode: "compare", title: "compare", detail: "inspectTwoLocations", icon: Columns2 },
  { mode: "album", title: "album", detail: "viewDirectoryImages", icon: Images },
] as const;

const SEARCH_ROW_HEIGHT = 46;
const SEARCH_OVERSCAN = 8;

function HomeSearchResults({
  totalEntries,
  status,
  entryAt,
  onNeedRange,
  onOpen,
  onContextMenu,
}: {
  totalEntries: number;
  status: "idle" | "loading" | "ready" | "cancelled" | "error";
  entryAt: (position: number) => DirectoryEntry | undefined;
  onNeedRange: (start: number, end: number) => void;
  onOpen: (entry: DirectoryEntry) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, entry: DirectoryEntry, position: number) => void;
}) {
  const { t, formatDate } = useAppI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(360);
  const [selected, setSelected] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / SEARCH_ROW_HEIGHT) - SEARCH_OVERSCAN);
  const end = Math.min(
    totalEntries,
    start + Math.ceil(viewportHeight / SEARCH_ROW_HEIGHT) + SEARCH_OVERSCAN * 2,
  );
  useEffect(() => {
    if (end > start) onNeedRange(start, end);
  }, [end, onNeedRange, start]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop);
  return (
    <div className="home-search-results" ref={viewportRef} role="listbox" aria-label={t("globalSearchResults")} onScroll={handleScroll}>
      <div className="home-search-results__spacer" style={{ height: Math.max(viewportHeight, totalEntries * SEARCH_ROW_HEIGHT) }}>
        {totalEntries === 0 ? (
          <div className="empty-result" role="status">
            {status === "loading" ? <LoaderCircle className="spin" size={16} /> : null}
            <span>{status === "loading" ? t("searchingAllDrives") : t("noMatchingItems")}</span>
          </div>
        ) : null}
        {Array.from({ length: end - start }, (_, offset) => start + offset).map((position) => {
          const entry = entryAt(position);
          return (
            <motion.button
              className={`home-search-result${position === selected ? " is-selected" : ""}${entry ? "" : " is-placeholder"}`}
              type="button"
              role="option"
              aria-selected={position === selected}
              data-selection-item="true"
              key={entry?.path ?? `search-placeholder-${position}`}
              style={{ top: position * SEARCH_ROW_HEIGHT }}
              initial={reducedMotion ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={reducedMotion ? { duration: 0 } : springTransition("snappy", "subtle")}
              title={entry?.path}
              onClick={() => setSelected(position)}
              onDoubleClick={() => entry && onOpen(entry)}
              onContextMenu={(event) => {
                if (!entry) return;
                setSelected(position);
                onContextMenu(event, entry, position);
              }}
            >
              <FolderOpen size={15} />
              <span><strong>{entry?.name ?? t("loading")}</strong><small>{entry?.path ?? ""}</small></span>
              <span>{entry?.modifiedUnixMs === null || entry?.modifiedUnixMs === undefined
                ? t("unknown")
                : formatDate(entry.modifiedUnixMs, { dateStyle: "short", timeStyle: "short" })}</span>
              <span>{entry?.kind === "file" ? formatBytes(entry.size) : t("folder")}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export function HomeDashboard({
  currentPath,
  scanStatus,
  tabCount,
  searchRoots,
  onOpen,
  onOpenSearchResult,
  onClipboardChange,
  onSuccess,
}: HomeDashboardProps) {
  const { t, formatNumber } = useAppI18n();
  const search = useDirectoryPane(currentPath, undefined, searchRoots);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: DirectoryEntry } | null>(null);
  const [propertiesTarget, setPropertiesTarget] = useState<DirectoryEntry | null>(null);
  useEffect(() => search.setSearchMode("global"), [search.setSearchMode]);
  const queryActive = Boolean(search.search.query.trim());

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    const menu = contextMenuRef.current;
    if (!menu || !contextMenu) return;
    const bounds = menu.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const x = Math.min(Math.max(contextMenu.x, left + 8), Math.max(left + 8, right - bounds.width - 8));
    const y = Math.min(Math.max(contextMenu.y, top + 8), Math.max(top + 8, bottom - bounds.height - 8));
    if (x === contextMenu.x && y === contextMenu.y) return;
    setContextMenu((current) => current ? { ...current, x, y } : null);
  }, [contextMenu]);

  const placeOnClipboard = (mode: TransferMode, entry: DirectoryEntry) => {
    if (entry.kind !== "file" && entry.kind !== "directory") return;
    onClipboardChange({ mode, entries: [entry] });
    onSuccess(t("clipboardEntry", {
      operation: t(mode === "copy" ? "copied" : "cut"),
      name: entry.name,
    }));
    setContextMenu(null);
  };

  const copyText = async (value: string, message: string) => {
    setContextMenu(null);
    try {
      await navigator.clipboard.writeText(value);
      onSuccess(message);
    } catch (error) {
      console.error("Unable to copy global search result text", error);
    }
  };

  return (
    <section className={`home-dashboard${queryActive ? " has-global-search" : ""}`} aria-label={t("homeDashboard")}>
      <div className="home-global-search" role="search">
        {search.search.status === "loading" ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
        <input
          aria-label={t("globalSearch")}
          placeholder={t("searchAllDrives")}
          value={search.search.query}
          spellCheck={false}
          onChange={(event) => search.setSearchQuery(event.target.value)}
        />
        {queryActive ? <output>{formatNumber(search.visibleTotalEntries)}</output> : null}
        <button type="button" className="icon-button" aria-label={t("closeSearch")} disabled={!queryActive} onClick={() => search.setSearchQuery("")}><X size={14} /></button>
      </div>
      {queryActive ? (
        <section className="home-global-search-panel" aria-label={t("globalSearchResults")}>
          <header><strong>{t("globalSearchResults")}</strong><span>{t("itemCount", { count: formatNumber(search.visibleTotalEntries) })}</span></header>
          {search.visibleError ? <div className="pane-error" role="alert">{search.visibleError}</div> : null}
          <HomeSearchResults
            totalEntries={search.visibleTotalEntries}
            status={search.visibleStatus}
            entryAt={search.entryAt}
            onNeedRange={search.ensureRange}
            onOpen={onOpenSearchResult}
            onContextMenu={(event, entry) => {
              event.preventDefault();
              setContextMenu({ x: event.clientX, y: event.clientY, entry });
            }}
          />
        </section>
      ) : (
        <div className="magic-bento">
          <section className="bento-summary bento-summary--wide">
            <span>{t("currentWorkspace")}</span>
            <strong title={currentPath}>{currentPath}</strong>
            <small>{t("openTabs", { count: formatNumber(tabCount) })}</small>
          </section>
          <section className="bento-summary">
            <span>{t("duplicateTask")}</span>
            <strong>{scanStatus}</strong>
            <small>{t("contentSafeHashing")}</small>
          </section>
          {ACTIONS.map(({ mode, title, detail, icon: Icon }) => (
            <SpecularButton key={mode} className="spotlight-card" onClick={() => onOpen(mode)}>
              <Icon size={18} />
              <span><strong>{t(title as TranslationKey)}</strong><small>{t(detail as TranslationKey)}</small></span>
            </SpecularButton>
          ))}
          <section className="bento-summary bento-summary--wide home-status-row">
            <span><Search size={14} /> {t("globalSearch")}</span>
            <span><Settings2 size={14} /> {t("preferencesSaved")}</span>
          </section>
        </div>
      )}
      {contextMenu ? createPortal((
        <div ref={contextMenuRef} className="explorer-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <MenuButton icon={<FolderOpen size={14} />} onClick={() => { onOpenSearchResult(contextMenu.entry); setContextMenu(null); }}>{t("open")}</MenuButton>
          <span className="menu-separator" />
          <MenuButton icon={<Copy size={14} />} disabled={contextMenu.entry.kind !== "file" && contextMenu.entry.kind !== "directory"} onClick={() => placeOnClipboard("copy", contextMenu.entry)}>{t("copy")}</MenuButton>
          <MenuButton icon={<Scissors size={14} />} disabled={contextMenu.entry.kind !== "file" && contextMenu.entry.kind !== "directory"} onClick={() => placeOnClipboard("move", contextMenu.entry)}>{t("cut")}</MenuButton>
          <MenuButton icon={<ClipboardCopy size={14} />} onClick={() => void copyText(contextMenu.entry.name, t("copiedName", { name: contextMenu.entry.name }))}>{t("copyFileName")}</MenuButton>
          <MenuButton icon={<ClipboardCopy size={14} />} onClick={() => void copyText(displayPath(contextMenu.entry.path), t("copiedPath"))}>{t("copyFullPath")}</MenuButton>
          <span className="menu-separator" />
          <MenuButton icon={<Info size={14} />} onClick={() => { setPropertiesTarget(contextMenu.entry); setContextMenu(null); }}>{t("properties")}</MenuButton>
        </div>
      ), document.body) : null}
      {propertiesTarget ? <EntryPropertiesDialog entry={propertiesTarget} onClose={() => setPropertiesTarget(null)} /> : null}
    </section>
  );
}
