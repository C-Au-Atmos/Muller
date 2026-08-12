# Stage 6.1 - desktop interaction corrections report

Status: complete on 2026-07-22.

## Windows file opening

Browse still opens regular files through the Windows Shell, so registered
defaults retain normal system behavior. The backend now validates and resolves
the requested path, converts internal Windows verbatim paths back to a
user-facing UTF-16 shell path, and distinguishes Shell return codes.

When Windows reports no association or an incomplete association, Muller opens
the native Open with dialog with execution and optional registration enabled.
The Browse context menu also exposes `Open with...` directly for regular files.
Closing the chooser returns a cancellation outcome instead of displaying an
operation error. The requested path must resolve successfully before Muller
invokes the Shell.

## Split-pane keyboard focus

Left and Right activate the corresponding directory pane and focus its virtual
list in split Browse and Compare directory views. They do not run in a single
pane, in Duplicates, in dialogs/menus, or while a text input owns caret movement.
The active-pane address, selection, history, and toolbar commands immediately
follow the newly focused pane.

This is pane activation, not filesystem back/forward navigation. Back and
Forward remain explicit header actions; Backspace remains parent-directory
navigation in Browse.

## Muller-owned search

`Ctrl+F` is captured before the WebView2/browser find command. Browse and the
directory view of Compare open an independent search bar in the active pane.
The native command searches the complete existing directory session by
case-insensitive filename substring and returns paged matches; it does not scan
only the rows currently mounted in React and does not retraverse the disk.

Frontend search has a 120 ms debounce, an independent query generation, stale
response rejection, search-aware virtual page loading, and cancellation/reset
on navigation. Enter returns focus to the list. Escape clears and closes the
search. CodeMirror retains its editor-native find behavior.

Duplicates uses the same Muller search surface to filter by case-insensitive
file path. If any file matches, its complete duplicate group remains visible so
the KEEP/DUP decision and reclaim context are not detached from the match.

## Boundaries carried into Stage 7

- Current-directory search is non-recursive and is not a global indexed search.
- Compare folder/text/hex result-row search is not added; `Ctrl+F` is suppressed
  there except for CodeMirror's own find surface.
- Tabs, draggable pane/preview/inspector widths, and adjustable UI scale are UI
  architecture work, not Stage 6.1 interaction patches.
- The planned shell proportions and React Bits surfaces remain Stage 7. The
  privileged read-only MFT/USN indexer is now Stage 8.
- The native Open with chooser needs a human to choose/cancel an installed
  application; automation verifies routing and outcomes but cannot complete the
  interactive operating-system dialog.

## Automated evidence

- 71 Rust workspace tests pass, including directory search paging, missing and
  incomplete association routing, verbatim Shell path conversion, and existing
  explorer/file-operation regressions.
- 19 frontend unit tests pass, including duplicate-group path filtering and the
  global keyboard command map.
- Seven Edge E2E scenarios pass. Stage 6.1 coverage asserts Left/Right pane
  activation and focus, Muller search focus in Browse, Compare, and Duplicates,
  Escape dismissal, narrow-viewport containment, and no unhandled page errors.
- TypeScript production build and ESLint with zero warnings pass.
- Rustfmt, Clippy with warnings denied, the no-default-features core check, and
  the Tauri debug build pass.
