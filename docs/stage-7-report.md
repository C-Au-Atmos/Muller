# Stage 7 workspace UI rearchitecture report

Date: 2026-07-23

Status: automated implementation and acceptance complete. Physical 144Hz
WebView2/Windows DWM acceptance remains pending.

## Delivered scope

### 7.0 - component provenance and visual runtime

- Pinned React Bits to
  `DavidHDev/react-bits@8d1c5fa9ebee6e077e70c9e5c63b44e87dbeaecc` and recorded
  the MIT + Commons Clause notice in [`third-party/react-bits.md`](third-party/react-bits.md).
- Integrated the official Three.js ColorBends shader with Home/workspace
  profiles, bounded DPR/FPS, hidden suspension, reduced-motion static rendering,
  pointer influence, disposal, and a separate lazy-loaded bundle.
- Kept two long-lived graphics contexts: ColorBends and the existing shared
  Flow Border Worker. Specular controls use one uniform pointer-directed
  software contract and never allocate a WebGL context or RAF per button.
- Reduced Flow Border to exactly four long-trail runners and moved normal states
  to the V5 shell palette.

### 7.1 - state decomposition

- Added a versioned workspace reducer, persistence parser, corruption fallback,
  tab identity, mode/path/presentation/filter/pane state, UI scale, and three
  persisted resize values under `src/workspace`.
- A pinned Home tab and independent operational tabs retain their own path,
  filter, presentation, split, active pane, and scroll-anchor model.
- Duplicate scan results are visible only in their owner tab. Starting another
  tab's scan replaces the native single scan safely; closing the owner cancels
  it so events cannot appear in a different workspace.

### 7.2-7.3 - V5 shell, tabs, scale, and layout

- Replaced the Stage 6 shell with the approved 108px header, 58px tool ribbon,
  26px status bar, 210px location rail, editable active-pane address, and
  compact responsive clamps.
- Integrated the `Muller` GradientText wordmark with only `#5227FF`, `#FF9FFC`,
  and `#B497CF`; the subtitle and shell remain in the approved five-color set.
- Added real workspace tabs with add/close/activate/reorder/overflow and Alt +
  Left/Right keyboard reordering.
- Pane ratio, Preview width, Inspector width, and UI scale are pointer and
  keyboard adjustable, clamped, persisted, and safely collapsed at small sizes.

### 7.4 - official location rails

- Added mutually exclusive Option Wheel and Line Sidebar renderers over one
  quick-location model and a fixed rail width.
- Option Wheel retains curve/tilt, smoothing, blur/fade, pointer drag, wheel,
  arrow/Home/End keys, non-looping bounds, and a 70ms tick limit.
- Line Sidebar retains indexed items, marker and intermediate ticks, smooth
  proximity falloff, active state, and click-only navigation.

### 7.5 - native filters and Counter

- Added a conditional Staggered Filter surface that is absent from layout while
  closed, supports Escape closure, and exposes an active-count badge.
- Added multi-select extensions and a validated local Before/After date composed
  from bounded year/month/day counters.
- Extended the Tauri directory query request with extension, date, and files-only
  predicates. Filtering occurs before session paging, so result totals and page
  generations remain correct and stale pages stay isolated.

### 7.6-7.7 - Home, Cubes/Folder, and Album

- Added an operational Magic Bento Home with current workspace, duplicate task,
  mode actions, and real semantic Spotlight buttons.
- Added virtualized Cubes strip/grid surfaces and interactive Folder objects
  without changing selection, open, context-menu, or mutation contracts.
- Added a shortest-column virtualized Masonry surface and a dedicated native
  cancellable thumbnail channel. Rust validates regular files, caps sources at
  64MiB/80 megapixels, decodes off the async runtime, preserves aspect ratio,
  downsizes to a bounded edge, emits PNG data, and keeps a 96-entry/32MiB LRU.
  Album starts files-only image sessions; ordinary Browse does not start
  thumbnail work.

## Verification

The final automated run passed:

- `npm.cmd run build` with TypeScript strict mode and a separate lazy
  `ColorBendsBackground` chunk;
- `npm.cmd run lint` with zero warnings;
- `npm.cmd run test`: 25 tests across nine files, including a 100,000-item
  shortest-column Masonry window bound;
- `npm.cmd run test:e2e`: 12 Edge scenarios covering legacy behavior plus V5
  GradientText, tabs, task ownership, rails, filters, resizers, Home, Cubes,
  Album, persistence, ColorBends pixels, context ceilings, and 390x844,
  760x520, 1600x1000, and 3840x2160 containment;
- `cargo fmt --all -- --check`;
- `cargo clippy --workspace --all-targets -- -D warnings`;
- `cargo test --workspace`: 74 tests;
- `cargo check -p muller-core --no-default-features`;
- `cargo build -p muller` for the Tauri debug executable.

Generated visual evidence is under `test-results/stage7/`, including Option
Wheel, Line Sidebar, Filter-open, Home, minimum, compact, and 4K screenshots.

## Remaining manual acceptance

Headless automation cannot certify a physical 144Hz Windows display, DWM/Mica,
WebView2 GPU scheduling, audio hardware, or sustained decoded-memory behavior on
a large real image directory. Before labeling Stage 7 hardware-complete, run the
debug Tauri executable on the target Windows machine and record frame-time,
input-latency, GPU, decoded-memory, and tick-audio traces while Browse,
Duplicates, Compare, Album, ColorBends, and Flow Border are active.

Stage 8 remains excluded: no elevation, MFT/USN service, or named-pipe indexer
was added.
