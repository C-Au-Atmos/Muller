import type { DuplicateFileEntry, DuplicateGroup } from "./types";

export type DuplicateListRow =
  | { kind: "group"; groupIndex: number; group: DuplicateGroup }
  | {
      kind: "file";
      groupIndex: number;
      fileIndex: number;
      group: DuplicateGroup;
      file: DuplicateFileEntry;
    };

export function buildDuplicateRows(
  groups: readonly DuplicateGroup[],
): DuplicateListRow[] {
  return groups.flatMap((group, groupIndex) => [
    { kind: "group" as const, groupIndex, group },
    ...group.files.map((file, fileIndex) => ({
      kind: "file" as const,
      groupIndex,
      fileIndex,
      group,
      file,
    })),
  ]);
}

export function filterDuplicateGroups(
  groups: readonly DuplicateGroup[],
  query: string,
): DuplicateGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...groups];
  return groups.filter((group) =>
    group.files.some((file) =>
      file.path.toLowerCase().includes(normalizedQuery),
    ),
  );
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}
