import type { DuplicateGroup } from "./types";

export type DuplicateDecision = "keep" | "duplicate";
export type DuplicateDecisionMap = ReadonlyMap<string, DuplicateDecision>;

export interface DecisionUpdate {
  decisions: Map<string, DuplicateDecision>;
  error: string | null;
}

export function applyDuplicateDecision(
  groups: readonly DuplicateGroup[],
  current: DuplicateDecisionMap,
  selectedPaths: ReadonlySet<string>,
  decision: DuplicateDecision,
): DecisionUpdate {
  const next = new Map(current);
  for (const path of selectedPaths) next.set(path, decision);

  if (decision === "duplicate") {
    for (const group of groups) {
      if (group.files.every((file) => next.get(file.path) === "duplicate")) {
        return {
          decisions: new Map(current),
          error: "Each duplicate group must retain at least one file.",
        };
      }
    }
  }
  return { decisions: next, error: null };
}

export function adoptDuplicateSuggestions(
  groups: readonly DuplicateGroup[],
): Map<string, DuplicateDecision> {
  const decisions = new Map<string, DuplicateDecision>();
  for (const group of groups) {
    group.files.forEach((file, index) => {
      decisions.set(file.path, index === group.suggested_keep ? "keep" : "duplicate");
    });
  }
  return decisions;
}

export function confirmedDuplicatePaths(
  groups: readonly DuplicateGroup[],
  decisions: DuplicateDecisionMap,
): Set<string> {
  return new Set(
    groups.flatMap((group) =>
      group.files.flatMap((file) =>
        decisions.get(file.path) === "duplicate" ? [file.path] : [],
      ),
    ),
  );
}
