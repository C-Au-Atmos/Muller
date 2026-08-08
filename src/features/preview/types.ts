export type PreviewKind = "image" | "audio" | "video" | "text" | "unsupported";

export interface PreviewMetadata {
  label: string;
  value: string;
}

export interface FilePreview {
  path: string;
  name: string;
  kind: PreviewKind;
  mime: string | null;
  text: string | null;
  dataUrl: string | null;
  artworkDataUrl: string | null;
  message: string | null;
  fileSize: number;
  bytesLoaded: number;
  createdUnixMs: number | null;
  modifiedUnixMs: number | null;
  accessedUnixMs: number | null;
  extension: string | null;
  metadata: PreviewMetadata[];
  truncated: boolean;
}

export type PreviewEvent =
  | { type: "started"; taskId: number }
  | { type: "ready"; taskId: number; preview: FilePreview }
  | { type: "cancelled"; taskId: number }
  | { type: "error"; taskId: number; message: string };

export type PreviewStatus = "idle" | "loading" | "ready" | "cancelled" | "error";
