# Repository development rules

These rules apply to every change in this repository.

## Version branch flow

For a version `X.Y.Z`, development must move in this order:

`req/X.Y.Z` -> `feat/X.Y.Z` -> `release/X.Y.Z` -> `master`

- `req/X.Y.Z` is the source of truth for requirements, scope, acceptance
  criteria, and delivery plans. Read its version-specific documents before
  changing product code. Requirement and planning changes belong here.
- `feat/X.Y.Z` is the only branch for normal implementation, refactoring, and
  feature tests. Merge the current `req/X.Y.Z` into it before development and
  whenever approved requirements change.
- `release/X.Y.Z` is for integration, verification, version metadata,
  changelog updates, and release-blocking fixes. Do not begin unrelated feature
  work here. Promote the tested `feat/X.Y.Z` branch into it.
- `master` is the stable integration branch. Update it only from a verified
  `release/X.Y.Z` branch at an explicit milestone. Never merge `req/*` or
  `feat/*` directly into `master`.

## Required working procedure

1. Fetch and prune `origin`, verify the worktree, and identify the target
   version before editing. Preserve unrelated user changes.
2. Read the target version's requirements on `req/X.Y.Z` before planning or
   implementing work.
3. Use the same item ID across `docs/VX.Y.Z/01-original-input.md`,
   `02-review.md`, and `03-execution.md`. Only reviewed and accepted items may
   enter implementation.
4. Make product changes on `feat/X.Y.Z`, with tests that cover the changed
   behavior. Keep requirement documents synchronized through `req/X.Y.Z`.
5. Before promotion to `release/X.Y.Z`, run the repository's relevant quality
   gates. For a full milestone, run lint, frontend tests, production build,
   Rust formatting/tests/clippy, and Edge E2E tests.
6. Stabilize on `release/X.Y.Z`. Any release-only code fix must be merged back
   into `feat/X.Y.Z` before further feature development.
7. Merge `release/X.Y.Z` into `master` only when the milestone is coherent,
   documented, and verified. Push each updated long-lived branch so the remote
   branch topology reflects the local promotion path.

Use non-force pushes. Do not bypass a stage because two branch tips currently
point to the same commit. See `docs/development-workflow.md` for commands and
promotion gates.

## Performance requirements

- Treat memory use and interaction latency as acceptance criteria, alongside
  correctness. A functional pass does not excuse a navigation freeze or an
  unbounded cache/history. Record regressions under the target version's item ID.
- For scans, searches and large visualizations, bound retained data and derived
  caches; cancel superseded work and reject late results. Avoid repeated full-tree
  copies or traversals on the UI thread during selection and navigation.
- Validate performance changes with representative large fixtures and repeat
  navigation. Record dataset size, timings and retained-data limits; for native
  memory samples, report the main process, helper and WebView roles separately
  with the memory metric named. Do not add shared working sets and call the sum
  unique physical RAM, or claim improvements from incomparable workloads.
- Preserve exact results, USN correctness and file-operation safety when optimizing.
  Add a regression check for the measured cause before shipping its fix.
