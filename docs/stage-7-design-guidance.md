# Stage 7 visual system and delivery guidance

Status: V5 final design contract implemented through automated acceptance on
2026-07-23. Physical 144Hz WebView2/DWM acceptance remains manual.

## 1. Product direction

Stage 7 is not a reskin of the current shell. It introduces a governed visual
and workspace system while retaining the completed native Browse, Duplicates,
Compare, preview, mutation, and search contracts.

The V5 Option Wheel reference is
[`design/stage-7-layout-v5-option-wheel.png`](design/stage-7-layout-v5-option-wheel.png)
and the Line Sidebar reference is
[`design/stage-7-layout-v5-line-sidebar.png`](design/stage-7-layout-v5-line-sidebar.png).
Both are rendered from the same interactive source,
[`design/stage-7-layout-v5.html`](design/stage-7-layout-v5.html). Only the
official sidebar mode changes; the shell, panes, proportions, typography, and
commands remain identical. The Filter button opens/closes the conditional right
menu and occupies zero width while inactive.

## 2. Required component inventory

| Component | Muller responsibility | Integration rule |
|---|---|---|
| Color Bends | Global animated visual background | Full intensity only on Home. Browse, Duplicates, Compare, and Album use a subdued low-DPR, low-FPS profile behind translucent operational surfaces. |
| GradientText | `Muller` brand wordmark only | Use the supplied horizontal three-color gradient with an 8-second yoyo cycle, no border, and no hover pause. It must not color the subtitle or any shell control/content. Pause while hidden and use a static gradient under reduced motion. |
| Specular Button | Every toolbar, navigation, icon, primary, and menu command | Preserve the supplied native rounded-rectangle SDF, base edge, symmetric pointer-directed laser streak, proximity fade, and one-pixel rim. Port the shader to shared rendering ownership rather than creating the supplied OGL renderer once per button. |
| Pill Nav | Top-level workspace tabs | Each pill owns an independent workspace history, panes, filters, view, tasks, and scroll anchors. Preserve real tab semantics, close, add, reorder, overflow, and keyboard traversal. |
| Line Sidebar | One selectable official location-rail mode | Render the supplied indexes, primary marker lines, intermediate ticks, pointer-proximity color/shift/scale, smoothing, and active item. It is never composed with Option Wheel. |
| Option Wheel | The alternate selectable official location-rail mode | Render the supplied curved vertical option geometry, tilt, distance blur/fade, smoothing, drag/wheel/arrow input, and optional rate-limited tick sound. It is never transformed into a radial dial or mixed with Line Sidebar. |
| Staggered Menu | Right-side Filter surface | It does not exist in the layout while Filters is inactive. When selected, rows enter from the right with staggered timing; close/Escape returns focus to the Filter button. |
| Counter | Before/After modified-date filter | Compose validated year/month/day counters with wheel, arrows, typing, and a native date fallback. Store one local-date boundary and an explicit Before/After mode. |
| Cubes | Horizontal strip and cube-grid directory presentations | Apply only to the virtualized visible window. View changes preserve selection, filters, and a representable scroll anchor. |
| Folder | Folder body inside Cubes and refined list rows | Preserve focus, selection, open, context-menu, drag target, and active/inactive pane semantics. It is not decoration detached from the entry model. |
| Magic Bento | Operational Home dashboard | Show recent locations, saved workspaces, current tasks, Browse, Duplicates, Compare, and Album. Home is not a marketing landing page. |
| Spotlight Card | Actionable cells inside Magic Bento | A card is one actual action or task. It has button/link semantics and deterministic keyboard focus; do not nest cards inside cards. |
| Masonry | Album view for images in the active directory | Use native thumbnails, paging, lazy decode, cancellation, stable aspect ratios, viewport windowing, and a bounded decoded-image cache. |
| Flow Border adaptation | Four fast perimeter light runners | Exactly four luminous heads, phase-offset around the perimeter, with thin heads and long trails. Remove synthetic depth controls and do not expose renderer tuning in product UI. |

### Supplied React Bits source profile

The user-supplied Specular Button, Option Wheel, Line Sidebar, and GradientText
TypeScript + Tailwind sources are authoritative for shader math, geometry,
smoothing, input, animation, and visual response. Muller does not adopt Tailwind
solely for these components; utility declarations are translated into owned CSS
while component behavior is kept intact. `ogl` is the only new dependency
required by the supplied source; Motion already exists. The Specular shader is
moved to shared edge/specular rendering ownership as described in the visual
budget below.

Muller V5 defaults for the compact desktop shell are:

- GradientText: `colors={['#5227FF', '#FF9FFC', '#B497CF']}`,
  `animationSpeed={8}`, `direction="horizontal"`, `pauseOnHover={false}`,
  `yoyo`, and `showBorder={false}`. Apply it only to the `Muller` wordmark;
  `FILE INTELLIGENCE` remains muted `#6c6c6c`;
- Specular Button: `#201531` tint/surface, `#6c6c6c` base edge,
  `#A855F7` laser line, `#c4c4c4` text, one-pixel thickness, pointer following,
  proximity fade, no permanent auto animation, and one universal 8px radius;
- Option Wheel: `side="left"`, approximately 0.82rem labels, 46-52px visual
  spacing, moderate curve/tilt, restrained distance blur/fade, 200ms smoothing,
  `#c4c4c4` resting text, `#A855F7` active text, no loop, dragging enabled, and
  an opt-in low-volume tick;
- Line Sidebar: approximately 0.75rem labels, 48px marker lines, 0.5 tick scale,
  19px item gaps, 14px maximum proximity shift, smooth falloff, 100ms smoothing,
  `#A855F7` accent, `#c4c4c4` text, `#6c6c6c` markers, indexes and markers
  enabled, and the same active location as Option Wheel.

The V5 shell palette is closed and tokenized:

- `#1B1722`: application base and non-elevated workspace background;
- `#201531`: controls, active neutral surfaces, and conditional menu surface;
- `#A855F7`: Specular laser, active location, active pane line, and sparse
  perimeter/background accents;
- `#c4c4c4`: primary text and selected content;
- `#6c6c6c`: inactive text, separators, base strokes, markers, and metadata.

Alpha variants may be derived from these five colors, but Stage 7 components
may not introduce independent blue, cyan, green, gold, or danger gradients into
the normal shell. Destructive commands use semantic danger color only inside
their explicit confirmation state. The only brand exception is GradientText:
`#5227FF`, `#FF9FFC`, and `#B497CF` may appear inside the `Muller` glyphs and
nowhere else in the shell.

## 3. Shell contract

V3 deliberately reduces chrome after the V2 density review. At the 1560x960
reference size the header is 108px, the tool ribbon is 58px, the status bar is
26px, and the file workspace receives the remaining 768px. The location rail is
210px wide and both official variants use the same fixed layout allocation.

The baseline type scale is 14px for the brand, 13px for the editable address,
12-13px for location labels, 10px for filenames, 9px for commands and pane
paths, and 7-8px for column/metadata labels. UI Scale changes the complete token
set rather than independently enlarging random components.

The header owns only:

- Muller identity;
- Pill Nav workspace tabs;
- Back, Forward, and parent navigation for the active pane;
- the borderless editable active-pane address;
- single/split pane state;
- UI scale and a restrained overflow menu.

The tool ribbon owns product mode, directory presentation, Muller search, and
the Filter trigger. It does not permanently reserve a right inspector. When
Filters is off, the directory panes receive the complete available width.

All controls use the Specular Button visual contract, including compact icon
buttons and Pill Nav tabs. Every clickable surface uses the same 8px radius,
one-pixel `#6c6c6c` base edge, symmetric `#A855F7` shine, pointer following, and
proximity fade. Pill Nav keeps tab behavior but no longer uses an elliptical
pill silhouette. The laser is a moving rim, not a colored gradient fill. Active
state may strengthen the laser and `#201531` surface but does not introduce a
different radius, floating shadow, or border language.

Rows, panes, toolbars, and page regions remain flat and use one-pixel separators
rather than decorative floating cards. Official Line Sidebar marker/tick lines
and the borderless Option Wheel labels are navigation geometry, not exceptions
to the button-radius rule.

## 4. Official sidebar modes

Option Wheel and Line Sidebar are two mutually exclusive user preferences over
the same quick-location model. Switching variants preserves the active pane,
selected location, navigation history, filters, and workspace tab. No custom
hybrid mode is part of Stage 7.

Option Wheel retains the supplied component behavior:

- options remain a vertical list laid out on a circular arc anchored to the
  selected side;
- wheel/touchpad input is non-passive and capped per event, then snaps after the
  supplied 140ms settle window;
- drag begins only after the supplied four-pixel movement threshold;
- Arrow Up/Left and Down/Right move one location;
- distance from center controls curve position, rotation, opacity, blur, and
  interpolation toward the active color;
- `loop` stays off for filesystem quick locations unless a later usability test
  demonstrates a clear benefit.

Line Sidebar retains the supplied component behavior:

- optional zero-padded indexes precede labels;
- primary marker lines and intermediate ticks retain the official geometry;
- vertical pointer proximity drives the official smooth falloff;
- marker color, tick scale, label color, horizontal shift, and active state all
  derive from the one smoothed effect value;
- the active location remains highlighted when the pointer leaves.

Only Option Wheel has the supplied `soundUrl`/`soundVolume` selection tick. It
uses the component's 70ms limiter and ignored autoplay failures, while also
respecting Muller's global opt-in interface-sound preference and hidden state.
Line Sidebar does not receive invented dial audio.

## 5. Filter menu contract

Filters are represented by one Specular Button with an active-count badge.
Inactive means the Staggered Menu is unmounted and occupies zero layout width.
Active means the menu overlays or pushes from the right according to available
width; it must never remain as a blank permanent inspector.

Stagger order is header, extension wheel, date mode/counters, then result
summary. Motion communicates hierarchy and should finish within 320-440ms. It
is reduced to a direct fade/slide under reduced motion.

Extension selection and date selection update the native paged query contract,
not a frontend-only subset of currently loaded rows. Filter state belongs to a
workspace tab. Closing the menu preserves active filters; Clear resets them.

## 6. Visual runtime budgets

Color Bends and the perimeter runners share a `VisualGovernor` but use separate
rendering ownership. Home may render Color Bends at the full selected profile;
workspaces lower opacity, DPR, and update frequency. Hidden/minimized means no
animation frames.

Default perimeter profile:

- runner count: exactly 4;
- phase: quarter-perimeter offsets;
- head thickness: 1.5-2px;
- trail length: 18-26% of the perimeter;
- target lap time: 1.1-1.5 seconds at normal motion;
- glow radius: visually restrained to roughly 4-10px;
- colors: independent product accents, not tied to obsolete Idle/Scan/Risk
  controls;
- reduced motion: stationary fine rim or a slow low-contrast pulse;
- no depth, main-load, particle-count, or renderer debug controls in product UI.

Keep no more than two long-lived WebGL contexts: one global background and one
shared edge/specular overlay Worker. The supplied Specular Button source creates
an OGL `Renderer`, context, pointer listener, and RAF for every instance; copying
that lifecycle across every Muller button would exceed browser context budgets.
Stage 7 ports its exact fragment/SDF laser math into the shared edge overlay and
scissors rendering to registered button bounds. This changes rendering
ownership, not the required native laser appearance or interaction.

## 7. Delivery stages

### Stage 7.0 - component provenance and visual spikes

Pin the selected React Bits source revision and license notices. Build isolated
spikes for Color Bends, the supplied Specular shader in shared ownership, Pill
Nav overflow, the four-unit edge runner, unmodified Option Wheel geometry,
unmodified Line Sidebar proximity behavior, and Staggered Menu.

Exit gates:

- native Specular shader output matches the supplied component at reference
  sizes without per-button RAF or per-button WebGL contexts;
- pointer, keyboard, reduced-motion, hidden, and CSS/software fallbacks work;
- Option Wheel settling, dragging, keyboard input, and 70ms audio limit work;
- Line Sidebar falloff, marker scaling, active state, and smoothing work;
- frame, GPU, context, and input-latency traces are recorded before integration.

### Stage 7.1 - shell and workspace state decomposition

Split the current `App.tsx` and global stylesheet by ownership. Introduce a
workspace reducer, view registry, tab identity, pane layout state, per-tab
history/filter/presentation state, persistence schema, and migration from the
current single-workspace state.

Exit gates:

- existing Browse, Duplicates, Compare, mutation, preview, and search tests stay
  green before visual integration;
- closing or switching a tab cannot leak task events, selection, or history;
- corrupt/old persisted state falls back without preventing startup.

### Stage 7.2 - visual runtime and command surfaces

Integrate Color Bends profiles, the four-runner Flow Border plus shared native
Specular overlay, UI tokens, UI scale, hidden-state suspension, and visual/audio
preferences.

Exit gates:

- workspace content remains readable over every background frame;
- UI scale does not overlap fixed controls from minimum size through 4K;
- visual effects stop while hidden and respect reduced motion;
- main-thread input/scroll work remains below the existing 3ms p95 budget.

### Stage 7.3 - Pill Nav tabs and resizable layout

Add workspace tabs, add/close/reorder/overflow, independent tab state, active
pane addressing, and keyboard-accessible resizers for panes, previews, and any
temporary side surface.

Exit gates:

- more than two locations are practical without adding more simultaneous
  columns;
- tab switching preserves pane history, filters, selection, view, and scroll;
- drag sizes and UI scale persist and clamp safely on smaller displays.

### Stage 7.4 - official Option Wheel and Line Sidebar modes

Integrate the supplied Option Wheel and Line Sidebar as two alternative renderers
for one quick-location state model. Add preference switching, persistence,
Option Wheel tick audio, and Muller navigation commits without altering either
component's official geometry or proximity behavior.

Exit gates:

- both modes use the same fixed rail width and never move the pane boundary;
- switching modes preserves location, pane history, filters, and tab state;
- Option Wheel drag/scroll/key selection cannot create an audio burst;
- Line Sidebar pointer proximity never triggers navigation without a click;
- touch, mouse, keyboard, sound-off, hidden, and reduced-motion scenarios pass.

### Stage 7.5 - Staggered Filter menu and Counter

Add the conditional right menu, multi-select extension wheel, Before/After date
mode, validated Counter composition, active badge, Clear, and backend query
serialization.

Exit gates:

- inactive Filter uses zero right-side layout width;
- stale filter pages cannot cross query generations or workspace tabs;
- extension/date timezone boundaries and keyboard operation are tested;
- opening/closing at 390px, 760x520, desktop, and 4K has no overflow.

### Stage 7.6 - Cubes, Folder, and Home

Add virtualized horizontal Cubes, cube grid, Folder interaction adapters, and
the Magic Bento Home with Spotlight Card actions.

Exit gates:

- view switching preserves representable selection and scroll anchors;
- mounted-node ceilings hold for 100,000-entry fixtures;
- Home task cards expose real state/actions and do not become marketing copy;
- focus, selection, context menus, and file operations match list view.

### Stage 7.7 - Masonry Album

Add the native thumbnail service/protocol, stable metadata, bounded caches,
cancellation, paging, lazy decode, and virtualized Masonry surface.

Exit gates:

- rapid tab/path/view changes cannot display stale thumbnails;
- unsupported, corrupt, huge, animated, and locked images fail per item;
- decoded memory returns near baseline after leaving Album;
- the ordinary Browse list never pays the Album thumbnail cost.

### Stage 7.8 - integration and hardware acceptance

Run Browse, Duplicates, Compare, Home, Album, filters, tabs, resizers, audio,
Color Bends, and edge runners together under WebView2.

Exit gates:

- complete Rust, TypeScript, lint, unit, Edge, and Tauri gates pass;
- screenshot and pixel checks cover desktop, mobile, wide, and 4K layouts;
- no task crosses tabs/panes and no UI surface overlaps incoherently;
- a physical 144Hz Windows/DWM run records frame, GPU, memory, audio, and input
  traces before Stage 7 is marked complete.

## 8. Explicit exclusions

Stage 7 does not replace the tested duplicate hashing funnel, folder/text/binary
diff engines, mutation safety, Recycle Bin policy, native paged directory
sessions, or Stage 6.1 search/open behavior. The privileged MFT/USN indexer
remains Stage 8.
