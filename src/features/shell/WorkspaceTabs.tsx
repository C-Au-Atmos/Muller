import { Folder, HardDrive, Plus, X } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { SpecularButton } from "../../ui/react-bits/SpecularButton/SpecularButton";
import type { WorkspaceTab } from "../../workspace/workspaceModel";

interface WorkspaceTabsProps {
  tabs: readonly WorkspaceTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
}

function tabLabel(tab: WorkspaceTab): string {
  const trimmed = tab.path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || tab.path;
}

function isDriveRoot(path: string): boolean {
  return /^[a-z]:[\\/]?$/i.test(path.trim());
}

export function WorkspaceTabs({ tabs, activeId, onActivate, onAdd, onClose, onMove }: WorkspaceTabsProps) {
  const { t } = useAppI18n();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const handleDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    const from = tabs.findIndex((tab) => tab.id === draggedId);
    const to = tabs.findIndex((tab) => tab.id === targetId);
    if (from < 0 || to < 0) return;
    const direction = from < to ? 1 : -1;
    for (let index = from; index !== to; index += direction) onMove(draggedId, direction);
    setDraggedId(null);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    onMove(id, event.key === "ArrowLeft" ? -1 : 1);
  };

  return (
    <div className="workspace-tabs" role="tablist" aria-label={t("workspaces")}>
      <div className="workspace-tabs__track">
        {tabs.map((tab) => (
          <div
            className={`workspace-tab-shell${isDriveRoot(tab.path) ? " is-drive" : ""}`}
            draggable
            key={tab.id}
            onDragStart={() => setDraggedId(tab.id)}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, tab.id)}
          >
            <SpecularButton
              className={activeId === tab.id ? "workspace-tab is-active" : "workspace-tab"}
              role="tab"
              aria-selected={activeId === tab.id}
              title={tab.path}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
            >
              {isDriveRoot(tab.path) ? <HardDrive size={17} /> : <Folder size={14} />}
              <span>{tabLabel(tab)}</span>
            </SpecularButton>
            {tabs.length > 1 ? (
              <button className="workspace-tab__close" type="button" aria-label={t("closeWorkspace", { name: tabLabel(tab) })} onClick={() => onClose(tab.id)}>
                <X size={11} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <SpecularButton compact className="workspace-tab-add" aria-label={t("newWorkspaceTab")} title={t("newWorkspaceTab")} onClick={onAdd}>
        <Plus size={14} />
      </SpecularButton>
    </div>
  );
}
