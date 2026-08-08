import { MergeView } from "@codemirror/merge";
import { ArrowLeft, ArrowRight, RotateCcw, Save, X } from "lucide-react";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, useState } from "react";

import { useAppI18n } from "../../i18n/i18n";
import { formatBytes } from "../dedup/duplicateListModel";
import type { EditSide } from "./types";
import type { EditableSideState } from "./useEditSession";

type MergeDirection = "a-to-b" | "b-to-a";

interface EditableMergeViewProps {
  left: EditableSideState;
  right: EditableSideState;
  busySide: EditSide | null;
  error: string | null;
  conflict: boolean;
  onChange: (side: EditSide, text: string) => void;
  onSave: (side: EditSide) => void;
  onRollback: (side: EditSide) => void;
  onClose: () => void;
}

const EDITOR_THEME = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--text-secondary)",
    backgroundColor: "var(--surface-1)",
    fontSize: "11px",
  },
  ".cm-content": {
    caretColor: "var(--info)",
    fontFamily: '"Cascadia Mono", Consolas, monospace',
  },
  ".cm-cursor": { borderLeftColor: "var(--info)" },
  ".cm-gutters": {
    color: "var(--text-muted)",
    backgroundColor: "var(--surface-0)",
    borderRight: "1px solid var(--border-subtle)",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface-row-hover)" },
  "&.cm-focused": { outline: "none" },
});

function makeRevertControl(direction: MergeDirection, title: string): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "merge-hunk-button";
  button.textContent = direction === "a-to-b" ? "\u2192" : "\u2190";
  button.title = title;
  button.setAttribute("aria-label", button.title);
  return button;
}

function replaceDocument(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

function sideName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

export default function EditableMergeView({
  left,
  right,
  busySide,
  error,
  conflict,
  onChange,
  onSave,
  onRollback,
  onClose,
}: EditableMergeViewProps) {
  const { t } = useAppI18n();
  const mountRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const initialRef = useRef({ left: left.text, right: right.text });
  const changeRef = useRef(onChange);
  const labelsRef = useRef({
    applyLeftToRight: t("applyLeftToRight"),
    editLeftFile: t("editLeftFile"),
    editRightFile: t("editRightFile"),
  });
  const [direction, setDirection] = useState<MergeDirection>("a-to-b");

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    const merge = new MergeView({
      a: {
        doc: initialRef.current.left,
        extensions: [
          basicSetup,
          EDITOR_THEME,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeRef.current("left", update.state.doc.toString());
          }),
        ],
      },
      b: {
        doc: initialRef.current.right,
        extensions: [
          basicSetup,
          EDITOR_THEME,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeRef.current("right", update.state.doc.toString());
          }),
        ],
      },
      parent,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 8 },
      revertControls: "a-to-b",
      renderRevertControl: () => makeRevertControl("a-to-b", labelsRef.current.applyLeftToRight),
      diffConfig: { scanLimit: 1_500, timeout: 1_000 },
    });
    merge.a.contentDOM.setAttribute("aria-label", labelsRef.current.editLeftFile);
    merge.b.contentDOM.setAttribute("aria-label", labelsRef.current.editRightFile);
    mergeRef.current = merge;
    return () => {
      merge.destroy();
      mergeRef.current = null;
    };
  }, []);

  useEffect(() => {
    labelsRef.current = {
      applyLeftToRight: t("applyLeftToRight"),
      editLeftFile: t("editLeftFile"),
      editRightFile: t("editRightFile"),
    };
    mergeRef.current?.a.contentDOM.setAttribute("aria-label", t("editLeftFile"));
    mergeRef.current?.b.contentDOM.setAttribute("aria-label", t("editRightFile"));
  }, [t]);

  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge) return;
    merge.reconfigure({
      revertControls: direction,
      renderRevertControl: () => makeRevertControl(direction, t(direction === "a-to-b" ? "applyLeftToRight" : "applyRightToLeft")),
    });
  }, [direction, t]);

  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge) return;
    replaceDocument(merge.a, left.text);
    replaceDocument(merge.b, right.text);
  }, [left.text, right.text]);

  const busy = busySide !== null;
  return (
    <div className="editable-merge-shell">
      <div className="editable-merge-toolbar">
        <div className="merge-side-actions">
          <span title={left.path}>
            <strong>LEFT</strong> {sideName(left.path)}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label={t("saveLeftFile")}
            title={t("saveLeftFile")}
            disabled={busy || !left.dirty}
            onClick={() => onSave("left")}
          >
            <Save size={14} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label={t("rollbackLeftFile")}
            title={t("rollbackLeftFile")}
            disabled={busy || !left.canRollback}
            onClick={() => onRollback("left")}
          >
            <RotateCcw size={14} />
          </button>
          <small>{left.encoding} / {formatBytes(left.byteLen)}</small>
        </div>

        <div className="merge-direction" role="group" aria-label={t("mergeDirection")}>
          <button
            className={direction === "a-to-b" ? "is-active" : undefined}
            type="button"
            title={t("applyLeftToRight")}
            aria-label={t("applyLeftToRight")}
            aria-pressed={direction === "a-to-b"}
            onClick={() => setDirection("a-to-b")}
          >
            <ArrowRight size={15} />
          </button>
          <button
            className={direction === "b-to-a" ? "is-active" : undefined}
            type="button"
            title={t("applyRightToLeft")}
            aria-label={t("applyRightToLeft")}
            aria-pressed={direction === "b-to-a"}
            onClick={() => setDirection("b-to-a")}
          >
            <ArrowLeft size={15} />
          </button>
        </div>

        <div className="merge-side-actions is-right">
          <small>{right.encoding} / {formatBytes(right.byteLen)}</small>
          <button
            className="icon-button"
            type="button"
            aria-label={t("rollbackRightFile")}
            title={t("rollbackRightFile")}
            disabled={busy || !right.canRollback}
            onClick={() => onRollback("right")}
          >
            <RotateCcw size={14} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label={t("saveRightFile")}
            title={t("saveRightFile")}
            disabled={busy || !right.dirty}
            onClick={() => onSave("right")}
          >
            <Save size={14} />
          </button>
          <span title={right.path}>
            {sideName(right.path)} <strong>RIGHT</strong>
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label={t("closeEditMode")}
            title={t("closeEditMode")}
            disabled={busy}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {error ? (
        <div className={conflict ? "mutation-notice is-conflict" : "mutation-notice"} role="alert">
          {error}
        </div>
      ) : null}
      <div className="editable-merge-mount" ref={mountRef} />
    </div>
  );
}
