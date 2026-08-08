export type FileKind = "code" | "document" | "image" | "archive" | "audio";

export interface FileRowData {
  id: number;
  name: string;
  extension: string;
  folder: string;
  size: string;
  modified: string;
  kind: FileKind;
  duplicateCount: number;
}

const STEMS = [
  "renderer",
  "workspace",
  "quarterly-report",
  "product-grid",
  "archive-snapshot",
  "interface-notes",
  "release-candidate",
  "field-recording",
] as const;

const FALLBACK_EXTENSION = { extension: "tsx", kind: "code" } as const;

const EXTENSIONS: ReadonlyArray<{ extension: string; kind: FileKind }> = [
  { extension: "tsx", kind: "code" },
  { extension: "rs", kind: "code" },
  { extension: "md", kind: "document" },
  { extension: "pdf", kind: "document" },
  { extension: "png", kind: "image" },
  { extension: "zip", kind: "archive" },
  { extension: "wav", kind: "audio" },
];

const FOLDERS = ["src", "documents", "assets", "backups", "captures"] as const;

export function fileAt(index: number): FileRowData {
  const stem = STEMS[index % STEMS.length] ?? "file";
  const extension =
    EXTENSIONS[(index * 5 + Math.floor(index / 7)) % EXTENSIONS.length] ??
    FALLBACK_EXTENSION;
  const rawBytes = ((index * 7919) % 28_000_000) + 1280;
  const size =
    rawBytes > 1_000_000
      ? `${(rawBytes / 1_000_000).toFixed(1)} MB`
      : `${Math.round(rawBytes / 1000)} KB`;
  const day = (index % 28) + 1;
  const hour = (index * 7) % 24;
  const minute = (index * 13) % 60;

  return {
    id: index,
    name: `${stem}-${String(index + 1).padStart(5, "0")}.${extension.extension}`,
    extension: extension.extension,
    folder: FOLDERS[index % FOLDERS.length] ?? "src",
    size,
    modified: `2026-07-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    kind: extension.kind,
    duplicateCount: index % 19 === 0 ? (index % 4) + 2 : 0,
  };
}
