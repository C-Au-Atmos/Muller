import { invoke, isTauri } from "@tauri-apps/api/core";

export interface RecycleBinEntry {
  id: string;
  name: string;
  originalPath: string;
  originalParent: string;
  kind: "file" | "folder" | "other";
  size: number | null;
  deletedMs: number | null;
  typeLabel: string;
}
export interface RecycleBinListing {
  entries: RecycleBinEntry[];
  totalCount: number;
  totalBytes: number;
}
export interface RecycleBinResult {
  succeededIds: string[];
  failures: { id: string; message: string }[];
  cancelled: boolean;
}

let listingRequest: Promise<RecycleBinListing> | null = null;

export const recycleBinClient = {
  list(): Promise<RecycleBinListing> {
    if (!isTauri()) return Promise.reject(new Error("Windows Recycle Bin is available in the desktop app."));
    // Mount replay and rapid workspace switches share only an in-flight read.
    // Settled snapshots are never reused by an explicit refresh.
    if (listingRequest) return listingRequest;
    listingRequest = invoke<RecycleBinListing>("list_recycle_bin");
    void listingRequest.then(() => { listingRequest = null; }, () => { listingRequest = null; });
    return listingRequest;
  },
  restore(ids: string[]): Promise<RecycleBinResult> {
    return invoke("restore_recycle_bin_items", { request: { ids } });
  },
  permanentlyDelete(ids: string[]): Promise<RecycleBinResult> {
    return invoke("delete_recycle_bin_items", { request: { ids, confirmed: true } });
  },
};
