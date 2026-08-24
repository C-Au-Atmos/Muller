import { LoaderCircle, Search, X } from "lucide-react";
import { forwardRef, type KeyboardEvent } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { ImeAwareSearchInput } from "./ImeAwareSearchInput";

interface DirectorySearchBarProps {
  label: string;
  placeholder?: string;
  query: string;
  status: "idle" | "loading" | "ready" | "error";
  resultCount: number;
  totalCount: number;
  onQueryChange: (query: string) => void;
  onCommit: () => void;
  onClose: () => void;
}

export const DirectorySearchBar = forwardRef<
  HTMLInputElement,
  DirectorySearchBarProps
>(function DirectorySearchBar(
  {
    label,
    placeholder,
    query,
    status,
    resultCount,
    totalCount,
    onQueryChange,
    onCommit,
    onClose,
  },
  ref,
) {
  const { t, formatNumber } = useAppI18n();
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
    }
  };

  return (
    <div className="directory-search-bar" role="search">
      {status === "loading" ? (
        <LoaderCircle className="spin" size={14} />
      ) : (
        <Search size={14} />
      )}
      <ImeAwareSearchInput
        ref={ref}
        aria-label={label}
        diagnosticSource="shared"
        value={query}
        onValueChange={onQueryChange}
        placeholder={placeholder ?? t("searchThisFolder")}
        spellCheck={false}
        onKeyDown={handleKeyDown}
      />
      <output title={t("resultCount", { result: formatNumber(resultCount), total: formatNumber(totalCount) })}>
        {query.trim() ? `${formatNumber(resultCount)}/${formatNumber(totalCount)}` : formatNumber(totalCount)}
      </output>
      <button className="icon-button" type="button" aria-label={t("closeSearch")} onClick={onClose}>
        <X size={13} />
      </button>
    </div>
  );
});
