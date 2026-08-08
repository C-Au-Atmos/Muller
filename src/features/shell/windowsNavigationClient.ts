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
