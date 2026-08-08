import { Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAppI18n } from "../../i18n/i18n";

export interface CommandPaletteItem {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  icon: ReactNode;
  disabled?: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  items: readonly CommandPaletteItem[];
  onClose: () => void;
}

export function CommandPalette({ open, items, onClose }: CommandPaletteProps) {
  const { t } = useAppI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? items.filter((item) =>
          `${item.label} ${item.detail}`.toLocaleLowerCase().includes(needle),
        )
      : items;
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(visibleItems.length - 1, 0)));
  }, [visibleItems.length]);

  if (!open) return null;

  const run = (item: CommandPaletteItem | undefined) => {
    if (!item || item.disabled) return;
    item.run();
    onClose();
  };

  return (
    <div
      className="command-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("commandPalette")}
      >
        <div className="command-search">
          <Search size={17} />
          <input
            ref={inputRef}
            aria-label={t("searchCommands")}
            value={query}
            placeholder={t("searchActions")}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) =>
                  Math.min(current + 1, Math.max(visibleItems.length - 1, 0)),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(visibleItems[selected]);
              }
            }}
          />
          <button
            className="icon-button"
            type="button"
            aria-label={t("closeCommandPalette")}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="command-results" role="listbox" aria-label={t("availableCommands")}>
          {visibleItems.map((item, index) => (
            <button
              className={index === selected ? "command-result is-selected" : "command-result"}
              type="button"
              role="option"
              aria-selected={index === selected}
              disabled={item.disabled}
              key={item.id}
              onPointerMove={() => setSelected(index)}
              onClick={() => run(item)}
            >
              <span className="command-result-icon">{item.icon}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
            </button>
          ))}
          {visibleItems.length === 0 ? (
            <div className="command-empty" role="status">{t("noMatchingCommands")}</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
