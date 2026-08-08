export type DirectoryListColumn = "name" | "type" | "size" | "modified";

export const DEFAULT_DIRECTORY_COLUMNS: readonly DirectoryListColumn[] = [
  "name",
  "size",
  "modified",
];

const COLUMN_TRACKS: Record<DirectoryListColumn, string> = {
  name: "minmax(150px, 1.4fr)",
  type: "minmax(82px, 0.38fr)",
  size: "minmax(78px, 0.3fr)",
  modified: "minmax(138px, 0.55fr)",
};

export function directoryColumnTemplate(columns: readonly DirectoryListColumn[]): string {
  return columns.map((column) => COLUMN_TRACKS[column]).join(" ");
}
