export interface ImageThumbnail {
  path: string;
  dataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  sourceBytes: number;
  modifiedUnixMs: number | null;
}

export type ThumbnailEvent =
  | { type: "started"; taskId: number }
  | { type: "ready"; taskId: number; thumbnail: ImageThumbnail }
  | { type: "cancelled"; taskId: number }
  | { type: "error"; taskId: number; message: string };

export type ThumbnailStatus = "idle" | "loading" | "ready" | "cancelled" | "error";
