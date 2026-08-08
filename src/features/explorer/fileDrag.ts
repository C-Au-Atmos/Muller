import type { TransferMode } from "./types";

export const INTERNAL_FILE_DRAG_MIME = "application/x-muller-directory-entries";

export interface InternalFileDrag {
  version: 1;
  sourceSessionId: number;
  sourcePane: "left" | "right";
  query: string;
  positions: number[];
}

function userPath(path: string): string {
  const normalized = path.trim().replaceAll("/", "\\");
  if (/^\\\\\?\\UNC\\/i.test(normalized)) return `\\\\${normalized.slice(8)}`;
  if (/^\\\\\?\\/i.test(normalized)) return normalized.slice(4);
  return normalized;
}

export function pathIdentity(path: string): string {
  const normalized = userPath(path).replace(/\\+$/, "");
  return normalized.toLocaleLowerCase("en-US");
}

export function pathsMatch(left: string, right: string): boolean {
  return pathIdentity(left) === pathIdentity(right);
}

export function pathVolume(path: string): string | null {
  const normalized = userPath(path);
  const drive = /^([a-z]):(?:\\|$)/i.exec(normalized);
  if (drive?.[1]) return `drive:${drive[1].toLocaleLowerCase("en-US")}`;
  const unc = /^\\\\([^\\]+)\\([^\\]+)/.exec(normalized);
  if (unc?.[1] && unc[2]) {
    return `unc:${unc[1].toLocaleLowerCase("en-US")}\\${unc[2].toLocaleLowerCase("en-US")}`;
  }
  return null;
}

export function transferModeForDrop(
  source: string,
  destination: string,
  modifiers: { ctrlKey: boolean; shiftKey: boolean },
): TransferMode {
  if (modifiers.ctrlKey) return "copy";
  if (modifiers.shiftKey) return "move";
  const sourceVolume = pathVolume(source);
  const destinationVolume = pathVolume(destination);
  return sourceVolume !== null && sourceVolume === destinationVolume ? "move" : "copy";
}

export function parseInternalFileDrag(value: string): InternalFileDrag | null {
  try {
    const candidate = JSON.parse(value) as Partial<InternalFileDrag>;
    if (
      candidate.version !== 1
      || !Number.isSafeInteger(candidate.sourceSessionId)
      || (candidate.sourceSessionId ?? 0) <= 0
      || (candidate.sourcePane !== "left" && candidate.sourcePane !== "right")
      || typeof candidate.query !== "string"
      || !Array.isArray(candidate.positions)
      || candidate.positions.length === 0
      || candidate.positions.some((position) => !Number.isSafeInteger(position) || position < 0)
    ) return null;
    return {
      version: 1,
      sourceSessionId: candidate.sourceSessionId as number,
      sourcePane: candidate.sourcePane,
      query: candidate.query,
      positions: [...new Set(candidate.positions)],
    };
  } catch {
    return null;
  }
}
