import { isImeCompositionEvent, type ImeEventDescriptor } from "../input/imeInput";

export type AppCommandId =
  | "openCommandPalette"
  | "openDuplicates"
  | "openCompare"
  | "openBrowse"
  | "openSettings"
  | "newTab"
  | "editAddress"
  | "cancelScan"
  | "moveNext"
  | "movePrevious"
  | "moveLeft"
  | "moveRight"
  | "movePageNext"
  | "movePagePrevious"
  | "openSelection"
  | "nextDifference"
  | "previousDifference"
  | "copySelection"
  | "cutSelection"
  | "paste"
  | "renameSelection"
  | "recycleSelection"
  | "goUp"
  | "refresh"
  | "togglePreview"
  | "findInDirectory"
  | "selectAll"
  | "activateLeftPane"
  | "activateRightPane";

interface KeyDescriptor extends ImeEventDescriptor {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
}

interface CommandBinding extends KeyDescriptor {
  command: AppCommandId;
}

const APP_KEYMAP: readonly CommandBinding[] = [
  { command: "openCommandPalette", key: "k", ctrlKey: true },
  { command: "openSettings", key: ",", ctrlKey: true },
  { command: "newTab", key: "t", ctrlKey: true },
  { command: "editAddress", key: "l", ctrlKey: true },
  { command: "findInDirectory", key: "f", ctrlKey: true },
  { command: "openBrowse", key: "1", ctrlKey: true },
  { command: "openDuplicates", key: "2", ctrlKey: true },
  { command: "openCompare", key: "3", ctrlKey: true },
  { command: "cancelScan", key: "Escape" },
  { command: "nextDifference", key: "ArrowDown", altKey: true },
  { command: "previousDifference", key: "ArrowUp", altKey: true },
  { command: "moveNext", key: "ArrowDown" },
  { command: "movePrevious", key: "ArrowUp" },
  { command: "moveLeft", key: "ArrowLeft" },
  { command: "moveRight", key: "ArrowRight" },
  { command: "activateLeftPane", key: "ArrowLeft", ctrlKey: true },
  { command: "activateRightPane", key: "ArrowRight", ctrlKey: true },
  { command: "movePageNext", key: "PageDown" },
  { command: "movePagePrevious", key: "PageUp" },
  { command: "openSelection", key: "Enter" },
  { command: "copySelection", key: "c", ctrlKey: true },
  { command: "cutSelection", key: "x", ctrlKey: true },
  { command: "paste", key: "v", ctrlKey: true },
  { command: "renameSelection", key: "F2" },
  { command: "recycleSelection", key: "Delete" },
  { command: "goUp", key: "Backspace" },
  { command: "refresh", key: "F5" },
  { command: "togglePreview", key: " " },
  { command: "selectAll", key: "a", ctrlKey: true },
];

export function resolveAppCommand(event: KeyDescriptor): AppCommandId | null {
  if (isImeCompositionEvent(event)) return null;
  const normalizedKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const binding = APP_KEYMAP.find(
    (candidate) =>
      candidate.key === normalizedKey &&
      Boolean(candidate.ctrlKey) === Boolean(event.ctrlKey) &&
      Boolean(candidate.altKey) === Boolean(event.altKey),
  );
  return binding?.command ?? null;
}
