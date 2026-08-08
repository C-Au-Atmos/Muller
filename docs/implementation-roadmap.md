# Muller implementation roadmap

This roadmap converts `Muller-设计文档.md` into independently verifiable
delivery stages. A stage is complete only when its exit criteria are measured;
code presence alone is not completion.

## Current status

| Stage | Status | Evidence / remaining gate |
|---|---|---|
| 0 - repository baseline | Complete | Locked npm/Cargo dependency graphs, strict build, lint, unit tests, Tauri debug executable |
| 1 - flow-border spike | Automated gate complete | Worker WebGL2, edge-only pixel probe, desktop/mobile screenshots, fallback path, and pressure fixture pass in Edge |
| 1 - hardware acceptance | Pending manual run | 144Hz physical display with WebView2 + Windows DWM/Mica cannot be established by headless automation |
| 2 - deduplication core | Complete | Pure Rust library/CLI, bounded hashing funnel, Clippy, warm-cache Criterion baselines, workspace/Tauri regression |
| 3 - desktop scan slice | Complete | Cancellable blocking-task bridge, typed Tauri Channel events, stale-task isolation, real result virtualization, and keyboard registry |
| 3.1 - explorer navigation | Complete | Native paged directory sessions, active-pane address/history, single/split real virtual lists, stale-session cleanup |
| 4 - read-only comparison | Complete | Folder/content diff, UTF-8/GBK/UTF-16 routing, paged Myers text rows, binary ranges, backend difference navigation |
| 5 - safe mutation | Complete | Confirmed recycle-bin deletion, lazy editable merge, atomic writes, encoding/newline preservation, conflict and rollback coverage |
| 5.1 - Browse foundation | Complete | Real default Browse workspace, shared pane navigation, context menu, protected copy/cut/paste/rename/recycle, conflicts and cancellation |
| 6 - operating model and preview | Complete | Tray/global summon, keyboard command mode, bounded cancellable previews/cache, rate-limited audio, success feedback, and hidden suspension |
| 6.1 - desktop interaction corrections | Complete | Windows Open with fallback, explicit chooser, pane arrow focus, and Muller-owned paged directory/result search |
| 7 - workspace UI rearchitecture | Automated gates complete | V5 shell, versioned tabs, three resizable boundaries, UI scale, official rail modes, filters, Home, Cubes/Folder, Album, native query filtering, and 12 Edge scenarios |
| 7 - hardware acceptance | Pending manual run | Physical 144Hz WebView2 + Windows DWM trace, GPU/memory sampling, and real large image-folder soak cannot be established by headless automation |
| 7.9 - Windows workflow hardening | Automated and local release gates complete | Explorer-style selection/navigation, Duplicate review, Windows locations, filters, media preview, scoped visual state, and native release launch are verified; physical hardware/media matrix remains manual |
| 7.10 - Explorer UX productization | Preview scope automated gates complete | Explorer layout/navigation, global search, drag/drop, Shell visuals, context operations, localization, theme JSON, Platinum, developer/RAW/GIF/PPTX preview, glass appearance, and capsule controls pass automated acceptance; real-device matrix remains manual |
| 8 - privileged indexer | Planned | Separately installed read-only MFT/USN service, authenticated named-pipe protocol, and traversal fallback |

Last automated verification: 2026-08-08. The current preview passed 100 Rust
workspace tests, 55 frontend unit tests, all 74 Edge scenarios, strict
Clippy/lint/build gates, and focused dark/light/Platinum glass screenshots at
desktop and 760px widths. Headless Edge proves containment, rendering
continuity, task ownership, and input behavior; it does not replace the physical
Windows acceptance lines below.

Stage 2 implementation details and benchmark context are recorded in
[`stage-2-report.md`](stage-2-report.md).

Stage 3 event, cancellation, and frontend isolation details are recorded in
[`stage-3-report.md`](stage-3-report.md).

Stage 4 explorer, folder/text/binary diff, paging, and known boundaries are
recorded in [`stage-4-report.md`](stage-4-report.md).

Stage 5 mutation policy, atomic replacement, rollback, recycling, and editable
merge details are recorded in [`stage-5-report.md`](stage-5-report.md).

Stage 5.1 Browse navigation, clipboard operations, context menus, transfer
safety, and known boundaries are recorded in
[`stage-5.1-report.md`](stage-5.1-report.md).

Stage 6 tray residence, global summon, command mode, previews, feedback, resource
suspension, and known boundaries are recorded in
[`stage-6-report.md`](stage-6-report.md).

Stage 6.1 Open with behavior, pane keyboard focus, native directory search, and
remaining UI boundaries are recorded in
[`stage-6.1-report.md`](stage-6.1-report.md).

Stage 7 workspace state, visual/runtime integration, native filter protocol,
cross-viewport evidence, and remaining physical acceptance are recorded in
[`stage-7-report.md`](stage-7-report.md).

The delivered Explorer interaction, Duplicate workflow, Windows navigation,
preview, and animation hardening program before Stage 8 is recorded in
[`stage-7.9-plan.md`](stage-7.9-plan.md).

The Explorer UX productization scope converts the 2026-08-06 user feedback into
acceptance-testable requirements in
[`stage-7.10-ux-requirements.md`](stage-7.10-ux-requirements.md). Its technical
architecture, dependency order, risk spikes, and 68-103 person-day estimate are
defined in
[`stage-7.10-design-and-delivery-plan.md`](stage-7.10-design-and-delivery-plan.md).

A staged Explorer/UI rearchitecture and the revised delivery sequence from
Stage 3.1 through Stage 8 are recorded in
[`ui-rearchitecture-roadmap.md`](ui-rearchitecture-roadmap.md). Stage 7 is now
implemented through automated acceptance; Stage 8 remains planned.

## Stage 0 - repository baseline

Scope: Git, React/Vite/Tauri skeleton, strict TypeScript, lint, unit tests,
repeatable build commands, and architectural boundaries.

Exit criteria:

- `npm run lint`, `npm test`, and `npm run build` pass.
- The Tauri shell can be checked once MSVC Build Tools are installed.
- Generated artifacts and local state are excluded from Git.

## Stage 1 - flow-border technical spike

Scope: an OffscreenCanvas transferred to a dedicated Worker, a WebGL2
screen-space ribbon, scroll velocity input, clockwise/counter-clockwise
navigation pulses, semantic states, capability fallback, and live telemetry.

Exit criteria:

- Main-thread traffic is target/event based and scroll messages are capped at
  one per animation frame.
- The Worker owns phase integration and spring smoothing.
- GPU work is scissored to four edge ribbons rather than shading the full
  viewport.
- WebGL2 and CSS fallback paths both preserve direction semantics.
- Desktop and narrow viewport screenshots have no overlap or clipping.
- The canvas is nonblank and Worker telemetry reports sustained rendering.

## Stage 2 - deduplication core

Scope: a pure Rust crate and CLI implementing size buckets, bounded head/tail
fingerprints, streaming BLAKE3, bounded parallelism, blacklist enforcement, and
deterministic duplicate groups.

Exit criteria:

- Unit tests cover boundary-size reads, same-size false positives, exact
  duplicates, hard links, unreadable files, and blacklisted roots.
- Integration fixtures prove deterministic grouping and reclaimable-byte math.
- Criterion benchmarks establish the funnel cost on small-file and large-file
  workloads without unbounded memory growth.

## Stage 3 - desktop scan slice

Scope: Tauri commands, cancellable scans, `ipc::Channel` progress, paged result
consumption, a real virtual list, and the command/keymap registry.

Exit criteria:

- Scans can be started, cancelled, and restarted without stale events.
- Hashing never runs on Tokio async workers.
- Keyboard repeat and type-to-locate remain responsive during scanning.

## Stage 4 - read-only comparison

Scope: folder diff, text sniffing and encoding detection, paged Myers text diff,
on-demand binary ranges, and difference navigation.

Exit criteria: GBK, UTF-8, UTF-16 BOM, CRLF/LF, large text, and binary fixtures
all route correctly without whole-file frontend retention.

## Stage 5 - safe mutation

Scope: recycle-bin deletion, editable CodeMirror merge, one-sided hunk apply,
and protected atomic writes preserving encoding and line endings.

Exit criteria: path blacklist, pre-save fingerprint validation, temp-file
flush/replace, backup/rollback, external-change conflict, and failed-write tests
all pass. This stage may not begin before the read-only path is stable.

## Stage 5.1 - Browse foundation

Scope: promote the real paged explorer to the default Browse workspace and add
the recoverable file-management loop: open, copy, cut, paste, rename, conflict
handling, refresh, properties, and Recycle Bin.

Exit criteria: protected/reparse paths are rejected, directory copies are
staged and content-verified, same-volume moves are atomic, conflicts are
explicit, transfers are cancellable before commit, and failure tests leave no
staging residue.

## Stage 6 - operating model and preview

Scope: tray residence, global summon, modal command system, audio engine,
previews, and success particles.

Exit criteria: hidden-state resource suspension, audio rate limiting, preview
cancellation, bounded cache behavior, and keyboard-complete workflows pass.

## Stage 6.1 - desktop interaction corrections

Scope: route missing Windows file associations to Open with, expose an explicit
Open with context command, switch split panes with Left/Right, and replace the
WebView2 find surface with Muller-owned directory and duplicate-result search.

Exit criteria: chooser cancellation is not reported as an error, directory
search covers unloaded native pages without retraversal, rapid query changes
cannot apply stale pages, text editors retain their native search, and keyboard
focus is deterministic across both panes.

## Stage 7 - workspace UI rearchitecture

Scope: decompose the current shell, introduce multi-tab workspaces, resizable
pane/preview/inspector boundaries, adjustable UI scale, revised header/tool
proportions, selectable directory rails, and the planned React Bits dashboard,
directory, filter, and Album presentations.

Exit criteria: tabs isolate history/task generations, size and scale settings
persist, drag boundaries remain keyboard accessible, all presentations retain
virtualization budgets, and desktop/mobile/4K screenshots have no overlap or
unreachable controls.

The binding component inventory, visual runtime budgets, dial/audio contract,
Filter behavior, and Stage 7.0-7.8 delivery gates are recorded in
[`stage-7-design-guidance.md`](stage-7-design-guidance.md).

## Stage 7.9 - Windows workflow and Duplicate hardening

Scope: replace single-index selection with Explorer-style stable multi-selection,
add presentation-aware Masonry/Grid/List navigation and marquee selection,
measure and optimize the 46,000-file duplicate funnel, add explicit KEEP/DUP
decisions with a reviewed batch Recycle Bin workflow, integrate Windows folder
pickers/known folders/This PC/path completion, derive filters from real directory
extensions, and extend preview to bounded streaming media with professional
metadata. The stage also scopes Flow Border state to the visible owner workspace,
moves it outside the content box, enlarges pointer targets, and closes animation
lifecycle coverage across all views.

Exit criteria and the binding 7.9.0-7.9.7 delivery order are defined in
[`stage-7.9-plan.md`](stage-7.9-plan.md). Stage 7.9 does not depend on or absorb
the privileged Stage 8 indexer.

## Stage 7.10 - Explorer UX productization

Status: preview scope implemented and automated gates complete; the physical
Windows acceptance matrix remains open. Scope: correct non-overlapping Preview/Filter layout and
sidebar navigation behavior; separate Home/Settings from workspace tabs; add
Explorer-style breadcrumbs, visible directory search, type-ahead locate,
classic navigation, file drag/drop, localized settings, semantic dark/light
themes, unified selection motion, Windows Shell icons/thumbnails, and expanded
safe context-menu operations.

The binding product requirements and acceptance criteria are recorded in
[`stage-7.10-ux-requirements.md`](stage-7.10-ux-requirements.md). The technical
design and delivery plan are recorded in
[`stage-7.10-design-and-delivery-plan.md`](stage-7.10-design-and-delivery-plan.md).
Stage 7.10 retains Stage 8 as a separate privileged-indexer milestone.

## Stage 8 - privileged indexer milestone

Scope: a separately installed Windows service for MFT enumeration and USN
updates, a read-only named-pipe protocol, explicit ACLs, and traversal fallback.

Exit criteria: the GUI never runs elevated, service absence preserves function,
the pipe rejects unauthorized clients and all mutating requests, and index
recovery from USN discontinuities is tested.
