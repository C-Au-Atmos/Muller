import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ShellLocation {
  id: string;
  label: string;
  path: string;
}

export interface LogicalDrive {
  path: string;
  label: string;
  fileSystem: string | null;
  driveType: string;
  totalBytes: number | null;
  freeBytes: number | null;
}

const INITIAL_LOCATION_ORDER = ["profile", "documents", "desktop"] as const;
const INITIAL_DRIVE_TYPES = new Set(["fixed", "removable"]);

export function selectInitialDirectory(
  locations: ShellLocation[],
  drives: LogicalDrive[],
): string {
  for (const id of INITIAL_LOCATION_ORDER) {
    const path = locations.find((location) => location.id === id)?.path.trim();
    if (path) return path;
  }

  return drives.find((drive) =>
    INITIAL_DRIVE_TYPES.has(drive.driveType.toLowerCase()) && drive.path.trim().length > 0
  )?.path.trim() ?? "";
}

export function shouldCompleteDirectoryPath(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  return !/^\\\\[^\\/]+$/.test(trimmed);
}

export async function getShellLocations(): Promise<ShellLocation[]> {
  if (!isTauri()) return [];
  const response = await invoke<unknown>("get_shell_locations");
  return Array.isArray(response) ? response as ShellLocation[] : [];
}

export async function completeDirectoryPath(input: string): Promise<string[]> {
  if (!isTauri() || !shouldCompleteDirectoryPath(input)) return [];
  const response = await invoke<unknown>("complete_directory_path", { input });
  return Array.isArray(response) ? response.filter((value): value is string => typeof value === "string") : [];
}

export async function listLogicalDrives(): Promise<LogicalDrive[]> {
  if (!isTauri()) return [];
  const response = await invoke<unknown>("list_logical_drives");
  return Array.isArray(response) ? response as LogicalDrive[] : [];
}

export async function resolveInitialDirectory(): Promise<string> {
  if (!isTauri()) {
    const environment = (import.meta as unknown as {
      env?: { VITE_MULLER_TEST_INITIAL_PATH?: string };
    }).env;
    return environment?.VITE_MULLER_TEST_INITIAL_PATH?.trim() ?? "";
  }

  const [locations, drives] = await Promise.all([
    getShellLocations().catch(() => []),
    listLogicalDrives().catch(() => []),
  ]);
  return selectInitialDirectory(locations, drives);
}
