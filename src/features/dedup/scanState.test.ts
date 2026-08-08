import { describe, expect, it } from "vitest";

import { createInitialScanState, scanStateReducer } from "./scanState";
import type { DesktopScanEvent, DuplicateGroup, ScanStats } from "./types";

const GROUP: DuplicateGroup = {
  full_hash: "a".repeat(64),
  size: 4,
  files: [
    {
      path: "D:\\data\\a.bin",
      size: 4,
      created_unix_ms: 1,
      modified_unix_ms: 1,
      head_tail: "1".repeat(16),
      full_hash: "a".repeat(64),
      hard_link_count: 1,
      locked: false,
    },
    {
      path: "D:\\data\\b.bin",
      size: 4,
      created_unix_ms: 2,
      modified_unix_ms: 2,
      head_tail: "1".repeat(16),
      full_hash: "a".repeat(64),
      hard_link_count: 1,
      locked: false,
    },
  ],
  suggested_keep: 0,
};

const STATS: ScanStats = {
  files_seen: 2,
  files_below_min_size: 0,
  unique_size_files: 0,
  size_candidate_files: 2,
  head_tail_candidate_files: 2,
  fully_hashed_files: 2,
  physical_duplicates_skipped: 0,
  blacklisted_entries_skipped: 0,
  symlinks_skipped: 0,
  bytes_read: 16,
};

describe("dedup scan state", () => {
  it("streams indexed groups and final summary", () => {
    let state = scanStateReducer(createInitialScanState(), { type: "start" });
    state = scanStateReducer(state, {
      type: "event",
      event: { type: "started", taskId: 7 },
    });
    state = scanStateReducer(state, {
      type: "event",
      event: { type: "groupFound", taskId: 7, groupIndex: 0, group: GROUP },
    });
    state = scanStateReducer(state, {
      type: "event",
      event: {
        type: "done",
        taskId: 7,
        groupCount: 1,
        groupOrder: [GROUP.full_hash],
        reclaimableBytes: 4,
        skipped: [],
        stats: STATS,
      },
    });

    expect(state.status).toBe("done");
    expect(state.groups).toEqual([GROUP]);
    expect(state.reclaimableBytes).toBe(4);
    expect(state.stats).toEqual(STATS);
  });

  it("ignores an event from a stale task id", () => {
    const bound = scanStateReducer(createInitialScanState(), {
      type: "bindTask",
      taskId: 9,
    });
    const stale: DesktopScanEvent = {
      type: "groupFound",
      taskId: 8,
      groupIndex: 0,
      group: GROUP,
    };

    expect(scanStateReducer(bound, { type: "event", event: stale })).toBe(bound);
  });

  it("clears progress when locally cancelled", () => {
    const scanning = scanStateReducer(
      {
        ...createInitialScanState(),
        status: "scanning",
        taskId: 3,
        progress: {
          phase: "discovering",
          processed: 10,
          total: null,
          candidate_files: 0,
          bytes_read: 0,
        },
      },
      { type: "localCancel" },
    );

    expect(scanning.status).toBe("cancelled");
    expect(scanning.progress).toBeNull();
  });
});
