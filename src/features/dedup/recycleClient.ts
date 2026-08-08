import { invoke, isTauri } from "@tauri-apps/api/core";

export interface RecycleCandidate {
  path: string;
  expectedSize: number;
  expectedBlake3: string;
}

export interface RecycleFailure {
  path: string;
  message: string;
}

export interface RecycleReport {
  recycled: string[];
  failures: RecycleFailure[];
}

export async function recycleDuplicates(
  candidates: readonly RecycleCandidate[],
): Promise<RecycleReport> {
  if (!isTauri()) throw new Error("Recycle operations require the Muller desktop runtime");
  return invoke("recycle_duplicates", {
    request: {
      confirmed: true,
      candidates,
    },
  });
}
