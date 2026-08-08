import { describe, expect, it } from "vitest";

import {
  buildDuplicateRows,
  filterDuplicateGroups,
  formatBytes,
} from "./duplicateListModel";
import type { DuplicateGroup } from "./types";

const GROUP: DuplicateGroup = {
  full_hash: "a".repeat(64),
  size: 4,
  files: [
    {
      path: "D:\\data\\a.bin",
      size: 4,
      created_unix_ms: null,
      modified_unix_ms: null,
      head_tail: null,
      full_hash: "a".repeat(64),
      hard_link_count: 1,
      locked: false,
    },
    {
      path: "D:\\data\\b.bin",
      size: 4,
      created_unix_ms: null,
      modified_unix_ms: null,
      head_tail: null,
      full_hash: "a".repeat(64),
      hard_link_count: 1,
      locked: false,
    },
  ],
  suggested_keep: 0,
};

describe("duplicate list model", () => {
  it("places one group row before its file rows", () => {
    const rows = buildDuplicateRows([GROUP]);

    expect(rows.map((row) => row.kind)).toEqual(["group", "file", "file"]);
    expect(rows[2]).toMatchObject({ groupIndex: 0, fileIndex: 1 });
  });

  it("formats byte values with stable decimal units", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1_250_000)).toBe("1.3 MB");
  });

  it("filters whole groups by any case-insensitive file path match", () => {
    const otherGroup: DuplicateGroup = {
      ...GROUP,
      full_hash: "b".repeat(64),
      files: GROUP.files.map((file) => ({
        ...file,
        path: file.path.replace("data", "archive"),
      })),
    };

    expect(filterDuplicateGroups([GROUP, otherGroup], "DATA\\A.BIN")).toEqual([
      GROUP,
    ]);
    expect(filterDuplicateGroups([GROUP, otherGroup], "  ")).toEqual([
      GROUP,
      otherGroup,
    ]);
  });
});
