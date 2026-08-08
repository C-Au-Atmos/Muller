import { describe, expect, it } from "vitest";

import type { DuplicateGroup } from "./types";
import {
  adoptDuplicateSuggestions,
  applyDuplicateDecision,
  confirmedDuplicatePaths,
} from "./duplicateDecisionModel";

const GROUP: DuplicateGroup = {
  full_hash: "a".repeat(64),
  size: 4,
  files: ["a", "b", "c"].map((name) => ({
    path: `D:\\${name}.bin`,
    size: 4,
    created_unix_ms: null,
    modified_unix_ms: null,
    head_tail: null,
    full_hash: "a".repeat(64),
    hard_link_count: 1,
    locked: false,
  })),
  suggested_keep: 1,
};

describe("duplicate decisions", () => {
  it("keeps scanner suggestions separate until adopted", () => {
    const decisions = adoptDuplicateSuggestions([GROUP]);
    expect(decisions.get("D:\\b.bin")).toBe("keep");
    expect(confirmedDuplicatePaths([GROUP], decisions)).toEqual(
      new Set(["D:\\a.bin", "D:\\c.bin"]),
    );
  });

  it("rejects an atomic update that would mark an entire group duplicate", () => {
    const current = new Map([["D:\\a.bin", "duplicate" as const]]);
    const update = applyDuplicateDecision(
      [GROUP],
      current,
      new Set(["D:\\b.bin", "D:\\c.bin"]),
      "duplicate",
    );
    expect(update.error).not.toBeNull();
    expect(update.decisions).toEqual(current);
  });

  it("supports keeping multiple files in one group", () => {
    const update = applyDuplicateDecision(
      [GROUP],
      new Map(),
      new Set(["D:\\a.bin", "D:\\b.bin"]),
      "keep",
    );
    expect([...update.decisions.values()]).toEqual(["keep", "keep"]);
  });
});
