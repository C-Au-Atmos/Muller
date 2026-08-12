# Muller UI rearchitecture and post-Stage 4 delivery plan

Status: Stage 7 implemented through automated acceptance on 2026-07-23. Physical
144Hz WebView2/DWM acceptance and the Stage 8 privileged indexer remain pending.

Delivery note: the Stage 3.1 explorer foundation and Stage 4 read-only Compare
slice described here were completed on 2026-07-21. The safe mutation boundary
was completed on 2026-07-22 against that stable read-only path. UI-R0/UI-R1 and
the React Bits visual integration stages are now implemented through Stage 7.

## 1. Decision summary

The requested change is a medium-to-large frontend rearchitecture, not a CSS
reskin. The tested Rust duplicate engine and its cancellation model remain
intact. The work is concentrated in four new boundaries:

1. An application shell that owns the header, toolbar, global visual stage, and
   workspace routing.
2. A paged filesystem explorer with independent navigation state per pane.
3. A view registry separating product mode, pane layout, item presentation,
   directory rail style, and filters.
4. An adaptive visual runtime for React Bits effects with explicit GPU, DOM,
   and motion budgets.

The current `App.tsx` (765 lines) and `app.css` (1,345 lines) combine shell,
navigation placeholders, duplicate scanning, performance diagnostics, keyboard
handling, and all responsive rules. Adding the requested modes to those files
would create state combinations that cannot be tested or reasoned about. They
must be decomposed before introducing the new UI.

| Area | Change size | Decision |
|---|---|---|
| Rust duplicate funnel | Low | Keep algorithms, cancellation, tests, and result contract |
| Existing Tauri scan bridge | Low | Rehost in the new shell; preserve task/generation semantics |
| React application shell/state | High | Replace monolithic ownership with reducer, panes, and view registry |
| Filesystem explorer/thumbnail IPC | High, new capability | Add paged, cancellable, per-pane services |
| Visual runtime and responsive CSS | High, high performance risk | Introduce governed React Bits adapters and split styles by ownership |
| Stage 4 diff engine/workspace | High, new capability | Build on the explorer rather than creating separate navigation |

This proposal treats the eleven components named in the request as required:
Color Bends, Cubes, Folder, Specular Button, Option Wheel, Line Sidebar, Magic
Bento, Spotlight Card, Masonry, Counter, and GradientText. Components subsequently added to
the React Bits homepage do not enter scope automatically.

## 2. Product layout contract

The operational shell will use this hierarchy:

```text
+-----------------------------------------------------------------------+
| HEADER: Muller | Back Forward | editable active-pane path | Split     |
| target 20dvh, clamped to 84-148px                                    |
+-----------------------------------------------------------------------+
| TOOLBAR: Browse | Duplicates | Compare | Album | Filters | View       |
| target 10dvh, clamped to 48-76px                                     |
+----------------+--------------------------+---------------------------+
| DIRECTORY RAIL | ACTIVE PANE              | OPTIONAL SECOND PANE      |
| Option Wheel   | list / cubes strip /     | independent path/history  |
| or Line Sidebar| cubes grid / masonry     | and selection             |
+----------------+--------------------------+---------------------------+
| task/progress/status                                                    |
+-----------------------------------------------------------------------+
| Color Bends visual stage behind the shell; Flow Border above the edge |
+-----------------------------------------------------------------------+
```

The percentages are design targets, not unconditional viewport percentages.
Literal `20vh + 10vh` would consume excessive space on a 4K screen and leave
too little content at the Tauri minimum height. CSS `clamp()` preserves the
requested hierarchy while keeping the workspace usable from 760x520 upward.

Header behavior:

- The Muller mark and editable address field are borderless. Focus uses a
  bottom highlight and caret, not a rounded input outline.
- Back and Forward use standard arrow icons and operate on the active pane.
- The split button uses the familiar two-column icon and toggles one/two panes.
- Each pane owns its own history. Clicking a pane makes it active and binds the
  global address field and navigation buttons to that pane.
- The path remains editable, but also exposes clickable breadcrumb segments
  when it is not being edited. Breadcrumb navigation replaces a dedicated Up
  button without losing parent navigation.

Toolbar behavior:

- `Browse`: ordinary filesystem browsing.
- `Duplicates`: scans the active pane root and presents real duplicate groups.
- `Compare`: requires two panes and consumes their current roots or selected
  files.
- `Album`: lists only image entries in the active directory and uses a bounded
  Masonry preview surface.
- `Filters`: opens extension and date controls without changing product mode.
- `View`: chooses list, horizontal cubes, or cube grid presentation.

The Home surface is an operational dashboard, not a marketing landing page. It
uses Magic Bento as the layout and Spotlight Card as each actual tile; there is
no card nested inside another visual card. Tiles open recent directories,
Browse, Duplicates, Compare, Album, or a recent task.

## 3. State architecture

One `activeTool` union cannot represent the requested combinations. The new
workspace state must keep independent dimensions:

| Dimension | Values / responsibility |
|---|---|
| `productMode` | `home`, `browse`, `duplicates`, `compare`, `album` |
| `paneLayout` | `single`, `split` |
| `activePaneId` | selects which pane owns the global address/navigation |
| `pane[id].location` | current canonical path and paged directory query |
| `pane[id].history` | back/forward stacks, selection, scroll anchor |
| `presentation` | `list`, `cubes-strip`, `cubes-grid`, `masonry` |
| `railVariant` | `option-wheel`, `line-sidebar`, `hidden` |
| `filters` | extension set plus optional before/after date boundary |
| `tasks` | explorer, duplicate, thumbnail, and diff task generations |
| `visualMode` | home/full, workspace/subdued, hidden/suspended |

A reducer and focused contexts are sufficient; no external state library is
required. High-frequency scroll/pointer values stay in refs or Workers and do
not enter application state.

Proposed frontend boundaries:

```text
src/app/
  AppShell.tsx
  WorkspaceProvider.tsx
  workspaceReducer.ts
  viewRegistry.ts
src/components/shell/
  MullerHeader.tsx
  ToolRibbon.tsx
  PaneLayout.tsx
  TaskStatusBar.tsx
src/features/explorer/
  explorerClient.ts
  explorerState.ts
  DirectoryPane.tsx
  DirectoryList.tsx
  CubesStripView.tsx
  CubesGridView.tsx
src/features/filters/
  ExtensionWheel.tsx
  DateCounterFilter.tsx
src/features/album/
  AlbumView.tsx
  thumbnailClient.ts
src/features/compare/
  CompareWorkspace.tsx
  FolderDiffView.tsx
  TextDiffView.tsx
  HexDiffView.tsx
src/features/home/
  HomeDashboard.tsx
src/ui/react-bits/
  ColorBends/
  Cubes/
  Folder/
  SpecularButton/
  OptionWheel/
  LineSidebar/
  GradientText/
  MagicBento/
  SpotlightCard/
  Masonry/
  Counter/
src/visual/
  VisualStage.tsx
  visualGovernor.ts
src/styles/
  tokens.css
  shell.css
  explorer.css
  responsive.css
```

Duplicate scanning remains under `features/dedup`; only its host view and root
selection change. Existing Channel task/generation isolation becomes the model
for explorer, thumbnail, and diff tasks.

## 4. React Bits integration rules

Use the TypeScript + CSS source variants rather than migrating Muller to
Tailwind. Source the adapters from
[`DavidHDev/react-bits`](https://github.com/DavidHDev/react-bits), and pin and
record the upstream source revision
`8d1c5fa9ebee6e077e70c9e5c63b44e87dbeaecc` before adapting it. The upstream
license is MIT plus the Commons Clause: application use and modification are
allowed, but the components cannot be sold or redistributed as a component
bundle. Preserve the copyright/license notice and document local changes.

| Component | Product placement | Required adaptation |
|---|---|---|
| Color Bends | full global background | Upstream uses Three.js and a main-thread RAF. Port it behind `VisualStage`, cap DPR, throttle workspace FPS, pause while hidden, and reduce both opacity and compute rate outside Home. Opacity alone does not save GPU work. |
| GradientText | `Muller` brand wordmark | Use `#5227FF`, `#FF9FFC`, and `#B497CF` in the supplied 8-second horizontal yoyo animation. Disable its border and hover pause, pause it while hidden, and retain a static gradient under reduced motion. Do not apply these colors to the subtitle or the shell. |
| Cubes | horizontal directory strip and tile grid | Upstream is a GSAP DOM animation, not a data grid. Apply the effect only to the virtualized visible window; never create one cube for every file in a large directory. |
| Folder | folder representation in cube/tile modes | Keep its CSS interaction, add real selection/focus semantics, and render only for visible directory entries. |
| Specular Button | every toolbar, navigation, tab, icon, menu, and primary command | The supplied source creates one OGL/WebGL context and RAF per button, which cannot scale to the required control count. Preserve its exact rounded-rectangle SDF, dark base edge, symmetric laser shader, pointer direction, and proximity fade by registering button bounds with the shared edge/specular Worker instead of changing its visual contract. |
| Option Wheel | default directory rail and extension filtering | Directory rail remains single-select. Extend the filter wheel with a separate selected `Set<string>`, check markers, Space/click toggling, and Clear/All commands so extensions can be multi-selected. |
| Line Sidebar | alternate directory rail | Treat it as a preference over the same quick-location model; switching rails must not reset pane location, filters, or history. |
| Magic Bento | Home dashboard layout | Replace demo content with recent locations, modes, and task summaries. Disable particle/magnet effects while reduced motion is active or GPU pressure is high. |
| Spotlight Card | each actionable Home tile | Add button/link semantics, keyboard focus, and deterministic focus-visible treatment. It is the tile surface inside the unframed Bento layout. |
| Masonry | Album mode | Upstream Masonry animates a complete item array. Add paging, viewport windowing, lazy image decode, thumbnail cancellation, and a bounded cache before using it on real directories. |
| Counter | before/after date filter | Counter is a number animation, not a date input. Compose year/month/day counters with steppers/wheel input, a Before/After segmented control, date validation, and an accessible native-input fallback. |

New direct dependencies should be limited to `three`, `gsap`, and `ogl`; Motion
already exists. Each imported source component gets a local adapter rather than
allowing React Bits demo props to leak into product state.

## 5. Filesystem and IPC foundation (Stage 3.1)

Add a read-only explorer bridge before visual integration:

```rust
DirectoryQuery {
    path,
    cursor,
    page_size,
    sort,
    extensions,
    modified_before,
    modified_after,
}

DirectoryEntry {
    path,
    name,
    kind,
    extension,
    size,
    modified_unix_ms,
    hidden,
}
```

Tauri commands/events:

- `start_directory_query(request, on_event) -> taskId`
- `cancel_directory_query(taskId)`
- `resolve_path(path)` for editable address validation/canonicalization
- `directoryStarted`, `directoryPage`, `directoryDone`, `cancelled`, `error`

Requirements:

- Directory enumeration runs outside async workers when it blocks.
- Pages are stable and deterministic under the selected sort.
- Each pane has generation plus task-id stale-event isolation.
- The frontend never owns a recursive directory tree.
- Symbolic links/reparse points are not followed implicitly.
- Protected paths may be browsed read-only only if policy allows; scan and
  mutation policies remain stricter and separate.
- Browser mode uses deterministic fixtures and displays the native boundary;
  it never pretends fixtures are a real filesystem.

## 6. Album and thumbnail foundation

Album mode depends on the directory bridge but not on Stage 4. Initially route
common raster formats (`jpg`, `jpeg`, `png`, `webp`, `gif`, `bmp`) and make the
format list data-driven.

- Generate thumbnails in cancellable blocking work with an explicit pixel and
  byte ceiling.
- Deliver image bytes through a scoped Tauri custom protocol rather than JSON
  or base64.
- Cancel requests when tiles leave the window or the directory changes.
- Bound decoded thumbnails by both count and bytes; start with 200 entries and
  128MB as a measurement ceiling, then tune from traces.
- Keep original files unloaded until the user opens a focused preview.
- Preserve aspect ratio so Masonry column calculations are stable before image
  decode and do not cause layout jumps.

## 7. Stage 4 read-only comparison

Stage 4 consumes the same two-pane navigation model; it must not build a second
directory browser.

Backend boundary:

- Add a runtime-independent diff crate/module for folder classification, text
  sniffing, encoding detection, newline analysis, paged Myers diff, and
  on-demand binary ranges.
- Reuse the existing cancellation and bounded BLAKE3 behavior through a small
  documented shared API; do not duplicate full-file unbounded reads.
- Folder comparison keys entries by relative path and classifies left-only,
  right-only, content-different, equal, and equal-content/different-mtime.
- `mtime` remains informational unless the user enables the explicit strict
  timestamp option.
- Text routing covers UTF-8, GBK, UTF-16 BOM, CRLF/LF, malformed text, large
  files, and binary fallback.
- All result streams carry a diff session/task id and support cancellation.

Frontend boundary:

- Compare automatically enables split layout.
- Folder rows align by relative path without requiring both panes to retain a
  complete recursive tree.
- Selecting a changed file opens a read-only text or Hex comparison tab.
- Text and Hex views virtualize visible rows/ranges and synchronize scrolling.
- `Alt+Down`/`Alt+Up` move between differences through the command registry.
- No apply, edit, save, delete, or merge command is enabled in Stage 4.

## 8. Delivery sequence and gates

### UI-R0 - visual and performance spikes

Deliver isolated prototypes for Color Bends plus Flow Border, multiple specular
buttons, a 10,000-entry virtual cube fixture, and a 5,000-image paged Masonry
fixture.

Exit gates:

- No blank canvas or WebGL context loss.
- Color Bends is visibly nonblank on Home and subdued in work modes.
- Context count and RAF ownership are measured, not inferred.
- Reduced motion, software/CSS fallback, and WebView2 behavior are defined.

### UI-R1 - shell decomposition without behavior changes

Split `App.tsx`, global CSS, keyboard dispatch, and view selection into the
module boundaries above. Preserve current duplicate scan behavior and all Stage
1-3 tests.

Exit gates:

- Existing Rust, unit, Edge, and Tauri build gates remain green.
- Shell state transitions have reducer tests.
- No feature depends on the DOM structure of another feature.

### Stage 3.1 - real explorer and navigation

Implement paged directory IPC, editable address, breadcrumb, back/forward,
single/split panes, active-pane semantics, ordinary list view, and keyboard
navigation.

Exit gates:

- Both panes navigate independently and reject stale pages.
- Back/forward and editable paths work after cancellation and rapid navigation.
- At least 100,000 fixture entries remain bounded in DOM and memory.
- Protected/reparse/unreadable path behavior has Rust integration tests.

### Stage 3.2 - visual shell and operational Home

Integrate Color Bends, Muller header, Specular controls, Tool Ribbon, Magic
Bento/Spotlight Home, and selectable Option Wheel/Line Sidebar rails.

Exit gates:

- Home and work modes meet contrast and keyboard-focus requirements.
- Rail switching preserves navigation state.
- Header/toolbar clamps preserve usable content at 760x520, 1360x840, 1440x900,
  and wide/4K viewports.

### Stage 3.3 - explorer presentations and filters

Add list, horizontal cubes, cube grid, Folder tiles, multi-extension wheel, and
before/after Counter date filtering. Filters execute in the paged backend query,
not by loading the entire directory into JavaScript.

Exit gates:

- Changing presentation preserves selection, filters, and scroll anchor where
  representable.
- Multi-extension and date boundaries have serialization and timezone tests.
- Visible-node budgets hold for every presentation.

### Stage 3.4 - Album mode

Add thumbnail service/custom protocol, bounded cache, cancellable requests, and
virtualized Masonry integration.

Exit gates:

- Rapid directory/mode changes cannot display stale thumbnails.
- Broken, locked, huge, animated, and unsupported images fail per item.
- Thumbnail memory returns near baseline after leaving Album mode.

### Stage 4 - read-only comparison

Implement folder, text, and binary comparison on the completed explorer shell,
with the boundaries in section 7.

Exit gates are the existing encoding/line-ending/large-file matrix plus
two-pane navigation, difference jumping, cancellation, and bounded frontend
retention.

### Stage 4.1 - integration and visual hardening

Unify recent locations/tasks on Home, restore workspaces across launches, tune
background intensity by mode, and run the complete navigation + scan + diff +
album workload under WebView2.

Exit gates:

- No stale task crosses a pane, tab, mode, or restored session.
- Color Bends, Flow Border, virtual lists, thumbnails, and diff can coexist
  without context loss or incoherent overlap.
- A physical 144Hz acceptance run records frame, GPU, and memory traces.

### Stage 5 - safe mutation

Only after Stage 4.1: recycle-bin deletion, CodeMirror merge/edit mode, one-way
hunk application, external-change detection, encoding/newline preservation,
atomic replacement, backup, and rollback. React Bits surfaces may style these
commands, but destructive confirmation remains restrained and explicit.

Implementation note: this safety boundary was delivered after the automated
Stage 4 gates and before the proposed visual Stage 4.1 work. It does not mark
Stage 4.1 or any React Bits integration item complete.

### Stage 5.1 - Browse foundation

The corrective Browse foundation was completed on 2026-07-22. It promoted the
real paged explorer to the default workspace and added the protected file-
management loop, context menu, keyboard commands, conflict handling, and
transfer cancellation. This changes the original sequencing: baseline file
operations are no longer deferred to Stage 6.

### Stage 6 - operating model and preview

Completed on 2026-07-22: tray residence, best-effort global summon, command mode,
bounded cancellable Browse previews, rate-limited audio, success effects, and
hidden resource suspension are integrated. The assumed Album thumbnail service
did not yet exist, so Stage 6 established the reusable preview task/cache
boundary. Native thumbnail encoding and a scoped custom protocol remain part of
the future Album implementation.

### Stage 6.1 - desktop interaction corrections

Completed on 2026-07-22: Windows now routes missing file associations to the
native Open with chooser and exposes that chooser explicitly in the Browse
context menu. Left/Right focus the corresponding split pane without stealing
caret movement from editable controls. `Ctrl+F` is captured before WebView2 and
opens a per-pane, session-backed current-directory search; Duplicates filters
complete groups by path. Search is deliberately non-recursive and Compare diff
rows retain their existing editor-specific behavior.

### Stage 7 - workspace UI rearchitecture

Deliver the UI program in bounded subphases: first split shell state and layout
ownership, then add persistent tabs, resizable pane/preview/inspector boundaries
and adjustable UI scale, then integrate the revised 20% identity/address region
and 10% tool region, selectable Option Wheel/Line Sidebar rails, Magic Bento
Home, Cubes/Folder directory modes, filters, and virtualized Masonry Album mode.
Each subphase retains the native paging, task-generation, and mutation safety
contracts already completed. The percentages are design targets with responsive
min/max clamps, not fixed heights that may starve the file surface.

The revised component contract adds Pill Nav workspace tabs, mutually exclusive
official Option Wheel and Line Sidebar location-rail modes, a conditional
Staggered Menu for extension/date filters, the native Specular Button laser
appearance under shared rendering ownership, and exactly four fast long-trail
perimeter runners. Detailed Stage 7.0-7.8 delivery gates are maintained in
[`stage-7-design-guidance.md`](stage-7-design-guidance.md).

### Stage 8 - privileged indexer

Add the separately installed read-only MFT/USN service and named-pipe ACLs.
Explorer queries keep their existing paged contract, allowing the source to
switch from traversal fallback to the index without rebuilding the UI.

## 9. Non-negotiable performance and UX budgets

- Keep at most two long-lived WebGL contexts: the shared edge/specular Worker
  and the global background. Specular controls register bounds with that Worker
  and must never allocate a context or RAF per button.
- Home may run Color Bends at full configured intensity. Workspace modes use a
  low-opacity, low-DPR, reduced-FPS profile; scrolling/scanning may freeze it to
  the latest frame. Hidden/minimized means zero RAF work.
- Flow Border remains in its Worker and retains direction/state semantics.
- Target fewer than 200 mounted list rows, 300 cube tiles, and 150 Masonry
  images; tune by measurement rather than raising limits casually.
- Keep main-thread input/scroll work below 3ms p95 so it fits inside the 6.94ms
  144Hz frame budget with compositor time remaining.
- Dynamic text cannot resize fixed controls or overlap adjacent chrome.
- Every clickable shell control uses the same 8px radius and Specular base/laser
  border. Tabs retain Pill Nav behavior without an elliptical silhouette; no
  control introduces a separate square, pill, floating-card, or shadow language.
- All view switches, wheels, counters, rails, and cards remain fully keyboard
  operable and expose semantic roles. Reduced motion changes behavior, not just
  animation duration.
- Use the approved V5 shell palette only: `#1B1722`, `#201531`, `#A855F7`,
  `#c4c4c4`, and `#6c6c6c`, plus alpha variants. Reserve additional semantic
  danger color for explicit destructive confirmation states. `#5227FF`,
  `#FF9FFC`, and `#B497CF` are permitted only inside the `Muller` GradientText
  wordmark. Color Bends stays low-opacity so the violet family does not reduce
  file-row scanability.

## 10. Verification matrix

Every stage retains:

- Rust format, Clippy with warnings denied, workspace tests, and no-default-
  features core check.
- TypeScript strict build, ESLint with zero warnings, and reducer/model tests.
- Playwright screenshots at 760x520, 1360x840, 1440x900, 390x844, and a wide
  desktop viewport.
- Canvas pixel checks for nonblank Color Bends, edge-only Flow Border, correct
  stacking, and transparent/solid fallback behavior.
- Automated checks for horizontal overflow, buttons outside the viewport,
  focus traversal, stale events, layout shifts, mounted-node ceilings, and
  unhandled console errors.
- Tauri debug builds plus manual WebView2 checks for native directory, thumbnail,
  scan, and diff Channels.

Stage 3.1 is the dependency root. Visual work can be prototyped in UI-R0 in
parallel conceptually, but it should not be integrated ahead of the shell and
navigation state boundaries. Stage 4 starts only after two-pane navigation is
real. The Stage 5 safety boundary is now complete against Stage 4; proposed
Stage 4.1 visual hardening remains independent and incomplete.
