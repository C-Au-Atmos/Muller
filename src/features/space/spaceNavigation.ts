import { displayPath } from "../explorer/pathDisplay";

/** Scan real directories only: drive and UNC share roots have no scannable parent. */
export function spaceParentPath(path: string): string | null {
  const normalized = displayPath(path).replaceAll("/", "\\").replace(/\\+$/, "");
  if (normalized.startsWith("\\\\")) {
    const parts = normalized.slice(2).split("\\").filter(Boolean);
    return parts.length > 2 ? `\\\\${parts.slice(0, -1).join("\\")}` : null;
  }
  if (!/^[a-z]:\\/i.test(normalized)) return null;
  const separator = normalized.lastIndexOf("\\");
  return separator === 2 ? normalized.slice(0, 3) : normalized.slice(0, separator);
}
