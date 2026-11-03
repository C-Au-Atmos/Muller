import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArchiveRestore, File, Folder, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useAppI18n } from "../../i18n/i18n";
import { isImeCompositionEvent } from "../../input/imeInput";
import { recycleBinClient, type RecycleBinEntry } from "./recycleBinClient";
import { RECYCLE_PAGE_SIZE, filterRecycleEntries, sortRecycleEntries, selectRecycleRange, type RecycleSort } from "./recycleBinModel";
import "./RecycleBinWorkspace.css";

const WORDS = {
  "en-US": { title: "Recycle Bin", subtitle: "Windows Recycle Bin", restore: "Restore selected", restoreAll: "Restore all", remove: "Delete permanently", empty: "Empty Recycle Bin", refresh: "Refresh", search: "Search Recycle Bin", name: "Name", originalParent: "Original location", deletedMs: "Date deleted", size: "Size", typeLabel: "Type", loading: "Reading Recycle Bin…", working: "Working…", emptyList: "Your Recycle Bin is empty", noMatches: "No matching items", items: "items", selected: "selected", previous: "Previous page", next: "Next page", page: "Page", cancel: "Cancel", confirmDelete: "Permanently delete these items?", confirmRestore: "Restore all items?", deleteNotice: "This cannot be undone. These items will be permanently removed from Windows Recycle Bin.", restoreNotice: "Windows will restore each item to its original location and handle any name conflicts.", scope: "This includes all listed items, even those hidden by search or on other pages.", cancelled: "The Windows operation was cancelled.", done: "items completed", failures: "Some items could not be processed", loadFailed: "Could not read Recycle Bin", operationFailed: "The operation could not be completed", dismiss: "Dismiss message", list: "Recycled items", unknown: "—", folder: "Folder", file: "File", total: "Total", selection: "Selection", unavailable: "Not available" },
  "zh-CN": { title: "回收站", subtitle: "Windows 回收站", restore: "还原选中项", restoreAll: "全部还原", remove: "永久删除", empty: "清空回收站", refresh: "刷新", search: "搜索回收站", name: "名称", originalParent: "原位置", deletedMs: "删除时间", size: "大小", typeLabel: "类型", loading: "正在读取回收站…", working: "正在处理…", emptyList: "回收站为空", noMatches: "没有匹配的项目", items: "项", selected: "已选中", previous: "上一页", next: "下一页", page: "页", cancel: "取消", confirmDelete: "永久删除这些项目？", confirmRestore: "还原全部项目？", deleteNotice: "此操作无法撤销。这些项目将从 Windows 回收站中永久删除。", restoreNotice: "Windows 会将各项目还原到原位置，并处理重名冲突。", scope: "包含所有已列出的项目，包括搜索隐藏项和其他分页中的项目。", cancelled: "Windows 操作已取消。", done: "项处理完成", failures: "部分项目未能完成操作", loadFailed: "无法读取回收站", operationFailed: "操作未能完成", dismiss: "关闭提示", list: "回收站项目", unknown: "—", folder: "文件夹", file: "文件", total: "全部", selection: "选中", unavailable: "不可用" },
} as const;
type PendingAction = { kind: "delete" | "restore"; ids: string[]; all: boolean };
interface Props { onSoundEvent?: (event: "select" | "success" | "error") => void; }
const columns: RecycleSort[] = ["name", "originalParent", "deletedMs", "size", "typeLabel"];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function sizeText(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  const exponent = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** exponent).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][exponent]}`;
}

export function RecycleBinWorkspace({ onSoundEvent }: Props) {
  const { locale } = useAppI18n(); const words = WORDS[locale];
  const [entries, setEntries] = useState<RecycleBinEntry[]>([]);
  const [busy, setBusy] = useState<"load" | "operation" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [query, setQuery] = useState(""); const [draft, setDraft] = useState("");
  const [sort, setSort] = useState<RecycleSort>("deletedMs"); const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLElement>(null); const list = useRef<HTMLDivElement>(null); const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null); const cancel = useRef<HTMLButtonElement>(null);
  const contextMenu = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null); const composing = useRef(false);
  const locked = useRef(false); const sequence = useRef(0); const mounted = useRef(false);
  const sound = useRef(onSoundEvent); sound.current = onSoundEvent;
  const wordsRef = useRef(words); wordsRef.current = words;
  const sorted = useMemo(() => sortRecycleEntries(entries, sort, descending), [entries, sort, descending]);
  const ordered = useMemo(() => filterRecycleEntries(sorted, query), [sorted, query]);
  const lastPage = Math.max(0, Math.ceil(ordered.length / RECYCLE_PAGE_SIZE) - 1);
  const actualPage = Math.min(page, lastPage);
  const visible = ordered.slice(actualPage * RECYCLE_PAGE_SIZE, (actualPage + 1) * RECYCLE_PAGE_SIZE);
  const selectedEntries = useMemo(() => entries.filter((entry) => selected.has(entry.id)), [entries, selected]);
  const totals = useMemo(() => ({ all: entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0), selected: selectedEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0) }), [entries, selectedEntries]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);

  const refresh = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; const ticket = ++sequence.current;
    setBusy("load"); setMenu(null); setNotice(null);
    try {
      const response = await recycleBinClient.list();
      if (!mounted.current || ticket !== sequence.current) return;
      setEntries(response.entries); setLoaded(true);
      const ids = new Set(response.entries.map((entry) => entry.id));
      setSelected((previous) => new Set([...previous].filter((id) => ids.has(id))));
      setFocused((previous) => previous && ids.has(previous) ? previous : null);
    } catch (error) {
      if (mounted.current && ticket === sequence.current) setNotice({ error: true, text: `${wordsRef.current.loadFailed}: ${errorText(error)}` });
    } finally {
      if (mounted.current && ticket === sequence.current) { locked.current = false; setBusy(null); }
    }
  }, []);

  useEffect(() => {
    mounted.current = true; locked.current = false; void refresh(); list.current?.focus();
    return () => { mounted.current = false; sequence.current += 1; };
  }, [refresh]);
  useLayoutEffect(() => {
    const element = list.current; if (!element) return;
    const update = () => root.current?.style.setProperty("--recycle-scrollbar", `${element.offsetWidth - element.clientWidth}px`);
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (pending) cancel.current?.focus(); }, [pending]);
  useEffect(() => {
    if (!menu) return;
    contextMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: PointerEvent) => { if (!contextMenu.current?.contains(event.target as Node)) setMenu(null); };
    const resize = () => setMenu(null);
    window.addEventListener("pointerdown", close); window.addEventListener("resize", resize);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("resize", resize); };
  }, [menu]);

  async function operate(action: PendingAction) {
    if (locked.current || action.ids.length === 0) return;
    locked.current = true; const ticket = ++sequence.current;
    setPending(null); setMenu(null); setBusy("operation"); setNotice(null);
    try {
      const result = action.kind === "restore" ? await recycleBinClient.restore(action.ids) : await recycleBinClient.permanentlyDelete(action.ids);
      if (!mounted.current || ticket !== sequence.current) return;
      const succeeded = new Set(result.succeededIds);
      setEntries((previous) => previous.filter((entry) => !succeeded.has(entry.id)));
      setSelected((previous) => new Set([...previous].filter((id) => !succeeded.has(id))));
      setFocused((previous) => previous && succeeded.has(previous) ? null : previous);
      const names = new Map(entries.map((entry) => [entry.id, entry.name]));
      const failures = result.failures.slice(0, 50).map((failure) => `${names.get(failure.id) ?? words.unavailable}: ${failure.message}`);
      if (result.failures.length > 50) failures.push(`… ${result.failures.length - 50} ${words.items}`);
      setNotice({ error: failures.length > 0, text: [result.succeededIds.length ? `${result.succeededIds.length} ${words.done}` : "", result.cancelled ? words.cancelled : "", failures.length ? `${words.failures}:\n${failures.join("\n")}` : ""].filter(Boolean).join("\n") });
      if (failures.length) sound.current?.("error"); else if (succeeded.size) sound.current?.("success");
    } catch (error) {
      if (mounted.current && ticket === sequence.current) { setNotice({ error: true, text: `${words.operationFailed}: ${errorText(error)}` }); sound.current?.("error"); }
    } finally {
      if (mounted.current && ticket === sequence.current) { locked.current = false; setBusy(null); list.current?.focus(); }
    }
  }

  function requestAction(kind: PendingAction["kind"], all = false) {
    if (locked.current) return;
    const ids = (all ? entries : selectedEntries).map((entry) => entry.id);
    if (ids.length === 0) return;
    const action = { kind, ids, all }; setMenu(null);
    if (kind === "delete" || all) setPending(action); else void operate(action);
  }
  function choose(entry: RecycleBinEntry, event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) {
    if (locked.current) return;
    setFocused(entry.id); list.current?.focus();
    if (event.shiftKey) setSelected((previous) => selectRecycleRange(ordered, anchor.current, entry.id, previous, event.ctrlKey || event.metaKey));
    else {
      anchor.current = entry.id;
      setSelected((previous) => {
        if (!event.ctrlKey && !event.metaKey) return new Set([entry.id]);
        const next = new Set(previous); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next;
      });
    }
  }
  function changeQuery(value: string) { setQuery(value); setPage(0); setSelected(new Set()); anchor.current = null; setFocused(null); }
  function closeDialog() { setPending(null); list.current?.focus(); }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (isImeCompositionEvent(event.nativeEvent) || composing.current) return;
    if (pending) {
      if (event.key === "F5") event.preventDefault();
      if (event.key === "Escape") { event.preventDefault(); closeDialog(); }
      if (event.key === "Tab") {
        const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const first = buttons[0]; const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      return;
    }
    const target = event.target as HTMLElement;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); search.current?.focus(); search.current?.select(); return; }
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (menu) {
      if (event.key === "Tab") setMenu(null);
      if (event.key === "Escape") { event.preventDefault(); setMenu(null); list.current?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); const buttons = [...contextMenu.current!.querySelectorAll<HTMLButtonElement>("button")];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(current + (event.key === "ArrowUp" ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
      return;
    }
    if (busy) { if (["Delete", "F5", "Enter", " "].includes(event.key)) event.preventDefault(); return; }
    if (event.key === "F5") { event.preventDefault(); void refresh(); return; }
    // Toolbar Enter/Space/arrow keys retain native button navigation.
    if (!list.current?.contains(target)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelected(new Set(ordered.map((entry) => entry.id))); return; }
    if (event.key === "Delete") { event.preventDefault(); requestAction("delete"); return; }
    if (event.key === "Escape") { event.preventDefault(); setSelected(new Set()); return; }
    if (event.key === " " && focused) { event.preventDefault(); const item = ordered.find((entry) => entry.id === focused); if (item) choose(item, { ctrlKey: true, metaKey: false, shiftKey: false }); return; }
    const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : event.key === "PageDown" ? RECYCLE_PAGE_SIZE : event.key === "PageUp" ? -RECYCLE_PAGE_SIZE : null;
    if (offset === null && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault(); const current = ordered.findIndex((entry) => entry.id === focused);
    const index = event.key === "Home" ? 0 : event.key === "End" ? ordered.length - 1 : Math.max(0, Math.min(ordered.length - 1, (current < 0 ? -1 : current) + (offset ?? 0)));
    const item = ordered[index]; if (!item) return;
    if (event.ctrlKey && !event.shiftKey) setFocused(item.id); else choose(item, event);
    setPage(Math.floor(index / RECYCLE_PAGE_SIZE)); sound.current?.("select");
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  return <section className="recycle-bin-workspace" aria-label="Recycle Bin" ref={root} onKeyDown={onKeyDown}>
    <header className="recycle-bin__header"><div className="recycle-bin__identity"><Trash2 size={26} /><div><h1>{words.title}</h1><span>{words.subtitle}</span></div></div><button type="button" disabled={!!busy} onClick={() => { void refresh(); }} title={`${words.refresh} · F5`}><RefreshCw size={15} />{words.refresh}</button></header>
    <div className="recycle-bin__toolbar" aria-label={words.title}>
      <button type="button" disabled={!!busy || selectedEntries.length === 0} onClick={() => requestAction("restore")}><ArchiveRestore size={15} />{words.restore}</button>
      <button type="button" disabled={!!busy || selectedEntries.length === 0} onClick={() => requestAction("delete")}><Trash2 size={15} />{words.remove}</button>
      <span className="recycle-bin__toolbar-divider" />
      <button type="button" disabled={!!busy || entries.length === 0} onClick={() => requestAction("restore", true)}>{words.restoreAll}</button>
      <button type="button" disabled={!!busy || entries.length === 0} onClick={() => requestAction("delete", true)}>{words.empty}</button>
      <label className="recycle-bin__search"><Search size={15} /><input ref={search} type="search" value={draft} placeholder={words.search} aria-label={words.search} disabled={!!busy} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; changeQuery(event.currentTarget.value); }} onChange={(event) => { setDraft(event.currentTarget.value); if (!composing.current && !isImeCompositionEvent(event.nativeEvent)) changeQuery(event.currentTarget.value); }} /></label>
    </div>
    {notice?.text && <div className={`recycle-bin__notice${notice.error ? " is-error" : ""}`} role={notice.error ? "alert" : "status"}><span>{notice.text}</span><button type="button" aria-label={words.dismiss} onClick={() => setNotice(null)}><X size={14} /></button></div>}
    <div className="recycle-bin__table" role="grid" aria-label={words.list} aria-multiselectable="true" aria-rowcount={ordered.length + 1} aria-colcount={5} aria-busy={!!busy}>
      <div className="recycle-bin__columns" role="row">{columns.map((column) => <div key={column} role="columnheader" aria-sort={sort === column ? descending ? "descending" : "ascending" : "none"}><button type="button" disabled={!!busy} onClick={() => { setSort(column); setDescending(sort === column ? !descending : column === "deletedMs"); setPage(0); }}>{words[column]}{sort === column && <span aria-hidden="true">{descending ? "↓" : "↑"}</span>}</button></div>)}</div>
      <div className="recycle-bin__list" ref={list} role="rowgroup" tabIndex={0} aria-label={words.list} onContextMenu={(event) => event.preventDefault()}>
        {visible.map((entry, index) => <div className={`recycle-bin__row${selected.has(entry.id) ? " is-selected" : ""}${focused === entry.id ? " is-focused" : ""}`} role="row" aria-selected={selected.has(entry.id)} aria-rowindex={actualPage * RECYCLE_PAGE_SIZE + index + 2} key={entry.id} data-id={entry.id} data-selection-item="true" data-index={actualPage * RECYCLE_PAGE_SIZE + index} onClick={(event) => choose(entry, event)} onContextMenu={(event) => {
          event.preventDefault(); if (busy) return;
          if (!selected.has(entry.id)) { setSelected(new Set([entry.id])); anchor.current = entry.id; } setFocused(entry.id);
          const bounds = root.current!.getBoundingClientRect(); setMenu({ x: Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 232)), y: Math.max(8, Math.min(event.clientY - bounds.top, bounds.height - 108)) });
        }}>
          <div role="gridcell" className="recycle-bin__name" title={entry.name}>{entry.kind === "folder" ? <Folder size={16} /> : <File size={16} />}<span>{entry.name}</span></div>
          <div role="gridcell" title={entry.originalPath}>{entry.originalParent}</div>
          <div role="gridcell">{entry.deletedMs !== null && Number.isFinite(new Date(entry.deletedMs).getTime()) ? dateFormat.format(entry.deletedMs) : words.unknown}</div>
          <div role="gridcell" className="recycle-bin__size">{sizeText(entry.size)}</div>
          <div role="gridcell" title={entry.typeLabel}>{entry.typeLabel || (entry.kind === "folder" ? words.folder : words.file)}</div>
        </div>)}
        {visible.length === 0 && <div className="recycle-bin__empty"><Trash2 size={35} /><p>{busy === "load" ? words.loading : !loaded ? words.loadFailed : entries.length ? words.noMatches : words.emptyList}</p></div>}
      </div>
    </div>
    <footer className="recycle-bin__footer"><span role="status">{busy ? busy === "load" ? words.loading : words.working : `${entries.length} ${words.items} · ${sizeText(totals.all)}${selectedEntries.length ? ` · ${selectedEntries.length} ${words.selected} (${sizeText(totals.selected)})` : ""}`}</span><div><button type="button" aria-label={words.previous} disabled={!!busy || actualPage === 0} onClick={() => setPage(actualPage - 1)}>‹</button><span>{words.page} {actualPage + 1} / {lastPage + 1}</span><button type="button" aria-label={words.next} disabled={!!busy || actualPage >= lastPage} onClick={() => setPage(actualPage + 1)}>›</button></div></footer>
    {menu && <div role="menu" className="recycle-bin__context" ref={contextMenu} style={{ left: menu.x, top: menu.y }}><button type="button" role="menuitem" onClick={() => requestAction("restore")}><ArchiveRestore size={15} />{words.restore}</button><button type="button" role="menuitem" onClick={() => requestAction("delete")}><Trash2 size={15} />{words.remove}</button></div>}
    {pending && <div className="recycle-bin__overlay"><div role="dialog" aria-modal="true" aria-labelledby="recycle-confirm-title" aria-describedby="recycle-confirm-description" className="recycle-bin__dialog" ref={dialog}>
      <span className="recycle-bin__dialog-icon">{pending.kind === "delete" ? <Trash2 size={23} /> : <ArchiveRestore size={23} />}</span><h2 id="recycle-confirm-title">{pending.kind === "delete" ? words.confirmDelete : words.confirmRestore}</h2>
      <div className="recycle-bin__confirm-count">{pending.ids.length} <span>{words.items}</span></div><p id="recycle-confirm-description">{pending.kind === "delete" ? words.deleteNotice : words.restoreNotice}</p>{pending.all && <p>{words.scope}</p>}
      <ul className="recycle-bin__confirm-items">{pending.ids.slice(0, 4).map((id) => { const entry = entries.find((item) => item.id === id); return <li key={id} title={entry?.originalPath}>{entry?.name ?? words.unavailable}</li>; })}{pending.ids.length > 4 && <li>… {pending.ids.length - 4} {words.items}</li>}</ul>
      <div className="recycle-bin__dialog-actions"><button type="button" ref={cancel} onClick={closeDialog}>{words.cancel}</button><button type="button" className={pending.kind === "delete" ? "is-danger" : ""} onClick={() => { void operate(pending); }}>{pending.kind === "delete" ? words.remove : words.restoreAll}</button></div>
    </div></div>}
  </section>;
}
