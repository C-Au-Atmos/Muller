import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatSpaceBytes, spaceSnifferClient, SpaceTree, type SpaceScanEvent } from "./spaceSnifferClient";
import type { SpaceScanProgressCallback } from "./types";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
  channels: [] as Array<(event: SpaceScanEvent) => void>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: tauri.isTauri,
  Channel: class {
    constructor(callback: (event: SpaceScanEvent) => void) { tauri.channels.push(callback); }
  },
}));

function item(path: string, bytes: number, kind: "file" | "directory" = "file", scanning = false): NonNullable<SpaceScanEvent["items"]>[number] {
  const separator = path.lastIndexOf("\\");
  return {
    path,
    parent: separator === 2 ? path.slice(0, 3) : path.slice(0, separator),
    name: path.slice(separator + 1),
    kind,
    bytes,
    depth: path.split("\\").length - 2,
    childCount: 0,
    partial: false,
    scanning,
  };
}

function send(event: SpaceScanEvent, channel = 0) {
  const callback = tauri.channels[channel];
  if (!callback) throw new Error("Expected scan event channel");
  callback(event);
}

beforeEach(() => {
  tauri.invoke.mockReset().mockResolvedValue({ taskId: 7 });
  tauri.isTauri.mockReturnValue(false);
  tauri.channels.length = 0;
});

afterEach(() => { vi.useRealTimers(); });

describe("space sniffer client helpers", () => {
  it("retains only the visible three levels while deep files still contribute measured ancestor totals", () => {
    const tree = new SpaceTree("D:\\Deep\\Address\\Target");
    const root = "D:\\Deep\\Address\\Target";
    tree.upsert({ ...item(`${root}\\one`, 100_000, "directory"), childCount: 1 });
    tree.upsert({ ...item(`${root}\\one\\two`, 100_000, "directory"), childCount: 1 });
    tree.upsert({ ...item(`${root}\\one\\two\\three`, 100_000, "directory"), childCount: 100_000 });
    for (let index = 0; index < 100_000; index += 1) {
      tree.upsert(item(`${root}\\one\\two\\three\\file-${index}.bin`, 1));
    }
    tree.updateRoot(100_000, true);
    const snapshot = tree.snapshot();
    expect(tree.retainedNodeCount).toBe(4);
    expect(snapshot.bytes).toBe(100_000);
    const boundary = snapshot.children?.[0]?.children?.[0]?.children?.[0];
    expect(boundary).toMatchObject({ bytes: 100_000, childCount: 100_000, children: [], childrenComplete: false });
    tree.clear();
    expect(tree.retainedNodeCount).toBe(0);
    expect(boundary?.bytes).toBe(100_000);
    expect(snapshot.children).toHaveLength(1);
  });

  it("formats scanner byte counts for the details panel", () => {
    expect(formatSpaceBytes(0)).toBe("0 B");
    expect(formatSpaceBytes(1024)).toBe("1.0 KB");
    expect(formatSpaceBytes(1024 ** 2 * 2.5)).toBe("2.5 MB");
  });

  it("honors cancellation before starting a scan", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(spaceSnifferClient.scan("C:\\", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("native space scan stream", () => {
  beforeEach(() => {
    tauri.isTauri.mockReturnValue(true);
    vi.useFakeTimers();
  });

  it("preserves native file and directory timestamps for guarded recycle operations", async () => {
    const promise = spaceSnifferClient.scan("D:\\", undefined);
    send({ type: "batch", taskId: 7, items: [
      { ...item("D:\\Old", 1024, "directory"), modifiedUnixMs: 1_758_345_600_123 },
      { ...item("D:\\Old\\響喜乱舞.zip", 1024), modifiedUnixMs: 1_758_345_600_456 },
      { ...item("D:\\unknown.txt", 1), modifiedUnixMs: null },
    ], totalBytes: 1025 });
    send({ type: "done", taskId: 7, totalBytes: 1025 });
    const root = await promise;
    expect(root.children?.[0]).toMatchObject({ kind: "folder", bytes: 1024, modifiedAt: 1_758_345_600_123 });
    expect(root.children?.[0]?.children?.[0]).toMatchObject({ name: "響喜乱舞.zip", modifiedAt: 1_758_345_600_456 });
    expect(root.children?.[1]?.modifiedAt).toBeUndefined();
  });

  it("publishes growing directory snapshots before done and keeps previous snapshots immutable", async () => {
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", undefined, onProgress);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0]?.[0]?.children).toEqual([]);
    send({ type: "started", taskId: 7, root: "D:\\" });
    send({
      type: "batch", taskId: 7,
      items: [item("D:\\Projects", 10, "directory", true), item("D:\\Projects\\a.txt", 10), item("D:\\Media", 4, "directory")],
      totalBytes: 14, fileCount: 1, directoryCount: 2, skippedCount: 0,
    });
    await vi.advanceTimersByTimeAsync(100);
    const first = onProgress.mock.calls[1]?.[0];
    expect(first?.bytes).toBe(14);
    expect(first?.children?.[0]?.bytes).toBe(10);
    expect(onProgress.mock.calls[1]?.[1]).toMatchObject({ phase: "scanning", scanned: 3, total: null });

    send({
      type: "batch", taskId: 7,
      items: [item("D:\\Projects\\b.txt", 30), item("D:\\Projects", 40, "directory", true)],
      totalBytes: 44, fileCount: 2, directoryCount: 2,
    });
    await vi.advanceTimersByTimeAsync(100);
    const second = onProgress.mock.calls[2]?.[0];
    expect(second?.children?.[0]?.bytes).toBe(40);
    expect(second?.children?.[0]?.children).toHaveLength(2);
    expect(second?.children?.[1]).toBe(first?.children?.[1]);
    expect(first?.children?.[0]?.bytes).toBe(10);
    expect(first?.children?.[0]?.children).toHaveLength(1);
    send({ type: "done", taskId: 7, totalBytes: 44, fileCount: 2, directoryCount: 2 });
    expect(await promise).toMatchObject({ bytes: 44, scanning: false });
    expect(onProgress.mock.lastCall?.[1]).toMatchObject({ phase: "complete", total: 4 });
  });

  it("coalesces bursts, upserts repeated nodes without duplicates and flushes completion immediately", async () => {
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\Fixture\\", undefined, onProgress);
    for (let index = 1; index <= 50; index += 1) {
      send({ type: "batch", taskId: 7, items: [item("D:\\Fixture\\a.txt", index)], totalBytes: index });
    }
    expect(onProgress).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(onProgress).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.lastCall?.[0]?.children).toHaveLength(1);
    expect(onProgress.mock.lastCall?.[0]?.children?.[0]?.bytes).toBe(50);
    send({ type: "batch", taskId: 7, items: [item("D:\\Fixture\\a.txt", 100)], totalBytes: 100 });
    send({ type: "done", taskId: 7, totalBytes: 100 });
    expect((await promise).children?.[0]?.bytes).toBe(100);
    expect(onProgress).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("shows cached chunks immediately while verifying separately and replaces deleted records at Done", async () => {
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", undefined, onProgress);
    send({ type: "cached", taskId: 7, items: [item("D:\\Projects", 30, "directory"), item("D:\\Projects\\deleted.txt", 30)], totalBytes: 40 });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ bytes: 40, scanning: true });
    expect(onProgress.mock.lastCall?.[1]).toMatchObject({ phase: "scanning", cachePreview: true, totalBytes: 40 });
    send({ type: "cached", taskId: 7, items: [item("D:\\old.txt", 10)], totalBytes: 40 });
    send({ type: "started", taskId: 7, root: "D:\\" });
    send({ type: "batch", taskId: 7, items: [item("D:\\Projects", 5, "directory", true), item("D:\\Projects\\new.txt", 5)], totalBytes: 5, fileCount: 1, directoryCount: 1 });
    await vi.advanceTimersByTimeAsync(100);
    const cachedSnapshot = onProgress.mock.lastCall?.[0];
    expect(cachedSnapshot?.children?.map((node) => node.name)).toEqual(["Projects", "old.txt"]);
    expect(cachedSnapshot?.children?.[0]?.children?.map((node) => node.name)).toEqual(["deleted.txt"]);
    expect(onProgress.mock.lastCall?.[1]).toMatchObject({ cachePreview: true, scanned: 2, totalBytes: 40 });
    send({ type: "done", taskId: 7, totalBytes: 5, fileCount: 1, directoryCount: 1 });
    const fresh = await promise;
    expect(fresh.children?.map((node) => node.name)).toEqual(["Projects"]);
    expect(fresh.children?.[0]?.children?.map((node) => node.name)).toEqual(["new.txt"]);
    expect(cachedSnapshot?.children?.[0]?.children?.map((node) => node.name)).toEqual(["deleted.txt"]);
    expect(onProgress.mock.lastCall?.[1]).toMatchObject({ phase: "complete", cachePreview: false, totalBytes: 5 });
    send({ type: "cached", taskId: 7, items: [item("D:\\late.txt", 900)], totalBytes: 900 });
    await vi.advanceTimersByTimeAsync(200);
    expect(onProgress.mock.lastCall?.[0]).toBe(fresh);
  });

  it("replaces a cached directory with an empty verified tree and ignores cache after live batches", async () => {
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", undefined, onProgress);
    send({ type: "cached", taskId: 7, items: [item("D:\\removed.txt", 10)], totalBytes: 10 });
    send({ type: "done", taskId: 7, totalBytes: 0, fileCount: 0, directoryCount: 0 });
    expect((await promise).children).toEqual([]);
    expect(onProgress.mock.lastCall?.[1]).toMatchObject({ cachePreview: false, totalBytes: 0 });

    const next = spaceSnifferClient.scan("E:\\", undefined, onProgress);
    send({ type: "batch", taskId: 7, items: [item("E:\\fresh.txt", 20)], totalBytes: 20 }, 1);
    send({ type: "cached", taskId: 7, items: [item("E:\\obsolete.txt", 30)], totalBytes: 30 }, 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(onProgress.mock.lastCall?.[0].children?.map((node) => node.name)).toEqual(["fresh.txt"]);
    expect(onProgress.mock.lastCall?.[1].cachePreview).toBe(false);
    send({ type: "done", taskId: 7, totalBytes: 20 }, 1);
    await next;
  });

  it("cancels cached verification without publishing buffered or late cached and fresh events", async () => {
    const controller = new AbortController();
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", controller.signal, onProgress);
    const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    send({ type: "cached", taskId: 7, items: [item("D:\\cached.txt", 10)], totalBytes: 10 });
    const visible = onProgress.mock.lastCall?.[0];
    send({ type: "cached", taskId: 7, items: [item("D:\\buffered.txt", 20)], totalBytes: 30 });
    send({ type: "batch", taskId: 7, items: [item("D:\\fresh.txt", 1)], totalBytes: 1 });
    controller.abort();
    await rejected;
    send({ type: "cached", taskId: 7, items: [item("D:\\late.txt", 100)], totalBytes: 100 });
    send({ type: "done", taskId: 7, totalBytes: 1 });
    await vi.advanceTimersByTimeAsync(200);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.lastCall?.[0]).toBe(visible);
    expect(tauri.invoke).toHaveBeenLastCalledWith("cancel_space_scan", { taskId: 7 });
  });

  it("isolates cached snapshots, task IDs and fresh results across concurrent scan sessions", async () => {
    tauri.invoke.mockResolvedValueOnce({ taskId: 7 }).mockResolvedValueOnce({ taskId: 8 });
    const firstProgress = vi.fn<SpaceScanProgressCallback>();
    const secondProgress = vi.fn<SpaceScanProgressCallback>();
    const first = spaceSnifferClient.scan("D:\\", undefined, firstProgress);
    const second = spaceSnifferClient.scan("E:\\", undefined, secondProgress);
    send({ type: "started", taskId: 7, root: "D:\\" }, 0);
    send({ type: "started", taskId: 8, root: "E:\\" }, 1);
    send({ type: "cached", taskId: 7, items: [item("D:\\old-d.txt", 10)], totalBytes: 10 }, 0);
    send({ type: "cached", taskId: 8, items: [item("E:\\old-e.txt", 20)], totalBytes: 20 }, 1);
    send({ type: "cached", taskId: 7, items: [item("E:\\wrong-task.txt", 500)], totalBytes: 500 }, 1);
    expect(secondProgress.mock.lastCall?.[0].children?.map((node) => node.name)).toEqual(["old-e.txt"]);
    send({ type: "batch", taskId: 7, items: [item("D:\\new-d.txt", 5)], totalBytes: 5 }, 0);
    send({ type: "done", taskId: 7, totalBytes: 5 }, 0);
    send({ type: "batch", taskId: 8, items: [item("E:\\new-e.txt", 6)], totalBytes: 6 }, 1);
    send({ type: "done", taskId: 8, totalBytes: 6 }, 1);
    expect((await first).children?.map((node) => node.path)).toEqual(["D:\\new-d.txt"]);
    expect((await second).children?.map((node) => node.path)).toEqual(["E:\\new-e.txt"]);
  });

  it("links out-of-order descendants by parent and preserves scan and incomplete flags", async () => {
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", undefined, onProgress);
    send({ type: "batch", taskId: 7, items: [item("D:\\Nested\\file.bin", 16)], totalBytes: 16 });
    send({ type: "batch", taskId: 7, items: [{ ...item("D:\\Nested", 16, "directory"), partial: true }], totalBytes: 16 });
    send({ type: "done", taskId: 7, totalBytes: 16, root: { ...item("D:\\", 16, "directory"), parent: null, partial: true } });
    const root = await promise;
    expect(root.children).toHaveLength(1);
    expect(root.children?.[0]).toMatchObject({ path: "D:\\Nested", bytes: 16, scanning: false, partial: true });
    expect(root.children?.[0]?.children?.[0]?.path).toBe("D:\\Nested\\file.bin");
    expect(root.partial).toBe(true);
  });

  it("preserves distinct names in case-sensitive directories while normalizing root separators", async () => {
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:/Fixture/", undefined, onProgress);
    send({
      type: "batch", taskId: 7,
      items: [item("D:\\Fixture\\Report.txt", 10), item("D:\\Fixture\\report.txt", 30)],
      totalBytes: 40, fileCount: 2,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(onProgress.mock.lastCall?.[0].children?.map((node) => [node.name, node.bytes])).toEqual([["Report.txt", 10], ["report.txt", 30]]);
    send({ type: "batch", taskId: 7, items: [item("D:\\Fixture\\Report.txt", 20)], totalBytes: 50, fileCount: 2 });
    send({ type: "done", taskId: 7, totalBytes: 50, fileCount: 2 });
    const root = await promise;
    expect(root.children?.map((node) => [node.name, node.bytes])).toEqual([["Report.txt", 20], ["report.txt", 30]]);
    expect(root.children?.reduce((bytes, node) => bytes + (node.bytes ?? 0), 0)).toBe(root.bytes);
  });

  it("settles abort while start is still pending and cancels its late task ID exactly once", async () => {
    let finishStart: ((response: { taskId: number }) => void) | undefined;
    tauri.invoke.mockImplementation((command: string) => command === "start_space_scan"
      ? new Promise<{ taskId: number }>((resolve) => { finishStart = resolve; })
      : Promise.resolve({ cancelled: true }));
    const controller = new AbortController();
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", controller.signal, onProgress);
    const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    finishStart?.({ taskId: 19 });
    await Promise.resolve();
    send({ type: "started", taskId: 19, root: "D:\\" });
    send({ type: "done", taskId: 19, totalBytes: 999 });
    await vi.advanceTimersByTimeAsync(200);
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
    expect(tauri.invoke).toHaveBeenLastCalledWith("cancel_space_scan", { taskId: 19 });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("drops cancelled buffered updates and ignores another task on the same channel", async () => {
    const controller = new AbortController();
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", controller.signal, onProgress);
    const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    send({ type: "started", taskId: 7, root: "D:\\" });
    send({ type: "done", taskId: 88, totalBytes: 999 });
    send({ type: "batch", taskId: 7, items: [item("D:\\file.txt", 10)], totalBytes: 10 });
    controller.abort();
    await rejected;
    send({ type: "done", taskId: 7, totalBytes: 10 });
    await vi.advanceTimersByTimeAsync(200);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenLastCalledWith("cancel_space_scan", { taskId: 7 });
  });

  it("cleans buffered updates when native scanning fails", async () => {
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", undefined, onProgress);
    const rejected = expect(promise).rejects.toThrow("unreadable folder");
    send({ type: "batch", taskId: 7, items: [item("D:\\file.txt", 10)], totalBytes: 10 });
    send({ type: "error", taskId: 7, message: "unreadable folder" });
    await rejected;
    await vi.advanceTimersByTimeAsync(200);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("reports rejected start commands and accepts streaming callbacks during drill-down", async () => {
    tauri.invoke.mockRejectedValueOnce(new Error("cannot inspect folder"));
    await expect(spaceSnifferClient.scan("D:\\Missing")).rejects.toThrow("cannot inspect folder");
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.openFolder?.({ id: "D:\\Nested", path: "D:\\Nested", name: "Nested", kind: "folder" }, undefined, onProgress);
    send({ type: "done", taskId: 7, totalBytes: 12 }, 1);
    expect(await promise).toMatchObject({ path: "D:\\Nested", bytes: 12 });
    expect(onProgress.mock.lastCall?.[1].phase).toBe("complete");
  });

  it("assembles a wide directory in batches and updates existing entries without rebuilding sibling subtrees", async () => {
    const onProgress = vi.fn<SpaceScanProgressCallback>();
    const promise = spaceSnifferClient.scan("D:\\", undefined, onProgress);
    for (let batch = 0; batch < 40; batch += 1) {
      send({
        type: "batch", taskId: 7,
        items: Array.from({ length: 250 }, (_, offset) => item(`D:\\file-${batch * 250 + offset}.bin`, 1)),
        totalBytes: (batch + 1) * 250, fileCount: (batch + 1) * 250,
      });
    }
    await vi.advanceTimersByTimeAsync(100);
    const initial = onProgress.mock.lastCall?.[0];
    expect(initial?.children).toHaveLength(10_000);
    send({ type: "batch", taskId: 7, items: [item("D:\\file-123.bin", 21)], totalBytes: 10_020, fileCount: 10_000 });
    send({ type: "done", taskId: 7, totalBytes: 10_020, fileCount: 10_000, directoryCount: 0 });
    const final = await promise;
    expect(final.children).toHaveLength(10_000);
    expect(final.children?.[123]?.bytes).toBe(21);
    expect(final.children?.[124]).toBe(initial?.children?.[124]);
    expect(initial?.children?.[123]?.bytes).toBe(1);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });
});
