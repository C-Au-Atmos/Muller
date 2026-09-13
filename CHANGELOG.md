# Changelog

All notable changes to Muller are documented in this file.

## [0.1.5-beta.4] - 2026-09-14

REQ-0.1.5-006/007 unify Space navigation with the top address bar and add
selection previews while keeping complete album columns beside a pinned preview.

- Backspace opens the actual parent directory; Alt+Left/Right traverse history.
  Top buttons, breadcrumbs, typed paths and sidebar navigation share that state.
  Cancelled address drafts restore the current path, and rapid navigation keeps focus.
- Space offers a Preview button and Space toggle for selected files and folders.
  Focused smaller items preview their own content; stale requests cannot replace a new selection.
- Shared previews use a dark content stage, compact file identity and collapsed properties.
  Readers and media are replaced on selection changes; existing format support is preserved.
- Pinned album previews stay in the grid. Available image width is divided into
  complete equal-width columns when the preview or window is resized.
- Includes the beta.3 follow-ups for Space context actions, smaller-item selection,
  resizable details, recycle cleanup and white Target Cursor corners limited to blocks.
- Verified 130 frontend tests and all 109 Edge cases, plus lint, production build
  and Rust formatting/tests/clippy. One administrator-only NTFS test remains ignored;
  the unchanged native index was not probed again in this UI release.

## [0.1.5-beta.3] - 2026-09-13

REQ-0.1.5-005 adds keyboard navigation and interaction polish to the Platinum
space view.

- Arrow keys select the nearest visible block; Enter opens folders and Escape returns.
- Optional Target Cursor effect can lock onto controls and the current Canvas block.
- Space blocks use richer deep-black, low-saturation graphite, blue-black, smoke-purple and warm-black tones.
- Right-click offers open/enter, locate in browser and copy path for the selected item.
- Choosing a folder from the left rail while in Space mode keeps the Space view active.
- Verified lint, 103 frontend tests, production build and the full Edge E2E suite.

## [0.1.5-beta.2] - 2026-09-13

BUG-0.1.5-001 corrects the space map's thin, hard-to-click rectangles and the
missing updates during scanning.

- Uses squarified byte-proportional rectangles, aggregating small entries into
  an accessible list. Individual blocks meet a 28px short edge and 1600px² area
  threshold; an aggregate keeps its true area even when it is subpixel.
- Restores Platinum gradients, fine white seams, orthogonal light accents and
  selection corners. Folder contents become interactive tiles after opening.
- Streams discovered directories and growing totals through coalesced immutable
  snapshots, animates current geometry, and retains the last result on stop.
- Keeps drill-down history and scan sessions isolated; respects reduced motion
  and preserves distinct names in Windows case-sensitive directories.
- Verified 102 frontend, 153 Rust and 96 Edge tests, with focused regressions for
  live Canvas changes, cancellation, small-item access and folder navigation.

The beta.1 native MFT/USN filename index remains available. Directory space is
still measured separately; fast scans finish immediately without artificial delay.

## [0.1.5-beta.1] - 2026-09-13

Windows test build for REQ-0.1.5-002/004: Platinum Space Sniffer view and native
NTFS filename indexing. Enable "NTFS fast index" in the address bar to launch
the isolated indexer through UAC; the desktop GUI keeps normal privileges.

- Enumerates MFT records with FSCTL_ENUM_USN_DATA, then replays USN changes for
  creates, deletes, file renames and parent-directory renames. Invalid journal
  checkpoints trigger a rebuild or an explicit fallback state.
- Uses a local, user-restricted named pipe with process identity checks; the
  helper only reads filesystem metadata and exits with its parent process.
- Browse, Home and Compare searches share the native provider, bounded query
  snapshots and paged metadata loading. Missing coverage falls back to the
  portable walker. Portable snapshots are cached in memory for queries.
- Includes the existing Canvas space map with selection, folder drill-down,
  breadcrumbs, interface sounds and linear weighted-strip layout.
- Space scans now emit file tiles in addition to folder totals; intermediate
  breadcrumbs restore the correct directory and keep Escape navigation working.
- Verified 148 Rust tests, 86 frontend tests and 93 Edge E2E tests, plus a real
  NTFS helper probe covering initial enumeration and USN lifecycle changes.

Beta limits: the native index lives in memory and rebuilds on activation;
additional hard-link names are not fully enumerated. USN must already be
enabled. Filename indexing does not compute recursive directory byte totals;
the space view continues to scan logical sizes separately. Name queries scan
cached names; this build does not claim parity with every Everything feature.

## [0.1.4] - 2026-09-03

Keyword-based file organization and Windows-style directory navigation release.

### Added

- New folders can optionally collect matching files from the current directory
  tree using a user-provided keyword.
- Existing directories expose a custom organization action from their context
  menu.
- The latest successful organization operation can be undone with `Ctrl+Z`,
  while conflicts and failed items remain protected and visible.
- `Alt+Left Arrow` and `Alt+Right Arrow` navigate backward and forward in the
  active Browse or Compare pane.

### Changed

- Organization scans match file names recursively without case sensitivity,
  exclude the destination directory tree, skip directories, and use keep-both
  conflict handling without overwriting existing files.
- Organization progress reports successful, skipped, and failed items while
  continuing independent file operations.

### Verification

- Windows 11 10.0.26200 x64 actual-device verification passed for new-folder
  organization, context-menu organization, recursive matching, Chinese names,
  mixed case, nested directories, conflicts, `Ctrl+Z`, and navigation in single,
  dual-pane, and Compare workspaces.
- Frontend tests: 76 passed; Rust workspace tests: 125 passed; Edge E2E tests:
  87 passed, including 4 targeted V0.1.4 scenarios.

## [0.1.3] - 2026-08-25

Windows lifecycle, diagnostics, and IME reliability release.

### Added

- Settings can now choose whether closing the main window hides Muller to the
  system tray or quits; the choice is persisted and hiding remains the default.
- Optional per-user Windows sign-in startup launches Muller hidden, reflects
  the actual Windows registration, refreshes stale executable paths, and cleans
  up Muller-created entries during NSIS uninstall.
- Single-instance startup coordination restores the existing main window for a
  repeated manual launch instead of opening a duplicate instance.
- Persistent local diagnostics use `INFO` by default, offer an opt-in `DEBUG`
  setting and log-folder shortcut, and rotate `muller.log` at 5 MiB while
  retaining at most four archives (about 25 MiB total).

### Changed

- Restoring default settings now also selects hide-to-tray, disables Windows
  sign-in startup, and disables detailed debug logging.

### Fixed

- Browse search now keeps IME pre-edit text local, ignores composition and
  WebView2 key-code `229` candidate keys, and submits final text only once across
  current-folder, recursive, all-drive, dual-pane, and shared search fields.
  This addresses the reported Microsoft Pinyin query flood and WeChat Input
  blocked-input event path.
- Window restoration now requests Windows attention when foreground-activation
  restrictions prevent a normal focus handoff.

### Privacy

- Diagnostic logs stay on the local device and are never uploaded. Muller's
  first-party diagnostic events use runtime allowlists that exclude search
  text, IME data, paths, file names and contents, clipboard data, and raw
  process arguments or working directories.

### Upgrade notes

- Upgrading from 0.1.2 requires no manual data migration; existing workspace,
  theme, and interface preferences remain compatible. The previous default
  close behavior (hide to tray) is unchanged, while sign-in startup and detailed
  debug logging start disabled.
- Normal `INFO` diagnostics are written after upgrade even when detailed debug
  logging is off. Use Settings > Diagnostics to change the level or open the
  local log folder. `MULLER_LOG=debug|trace` can override the level for one run.
- If an enabled startup registration points to an older or moved executable,
  launch 0.1.3 once to refresh it to the current path. Portable builds have no
  NSIS uninstall hook, so disable sign-in startup before deleting the executable.

### Known limits

- Installed-build validation with real Microsoft Pinyin and WeChat Input remains
  pending; Edge composition-event automation is not a substitute for that test.
- Windows installed-build checks remain pending for login/upgrade/uninstall,
  true multi-process and foreground restrictions, log creation/restart/rotation
  and unwritable-directory fallback, and close/logoff/shutdown behavior.

## [0.1.2] - 2026-08-09

Workspace and preview refinement release.

### Added

- Resizable navigation sidebar with persisted width and dedicated glyphs for
  Windows known folders, drives, favorites, and This PC.
- Full Browse-style navigation, search, preview, context menus, and file
  operations inside the Compare workspace.
- HDR image decoding and a user preference for workspace glass effects.

### Changed

- Improved marquee selection, preview behavior, range-control animation, and
  flow-border rendering under active desktop workloads.
- Expanded directory search and Compare workflows to work consistently across
  both panes.

### Fixed

- Rounded window corners are now transparent instead of exposing the obsolete
  black WebView/window background; maximized windows correctly use square
  corners.

## [0.1.1] - 2026-08-08

First public preview hotfix.

### Fixed

- Fresh installations now open the current Windows user profile instead of the
  build machine's `D:\\Muller` path. If known folders are unavailable, Muller
  falls back to a local drive and then the virtual This PC workspace.
- Fresh installations and preference resets now start with Muller Monochrome
  Platinum. Existing saved theme choices remain unchanged.
- The native window and HTML startup surfaces now use the Platinum canvas color
  to prevent an obsolete dark-purple flash before the interface is ready.

## [0.1.0] - 2026-08-08

First public Windows preview.

### Added

- Native paged Browse, Compare, Duplicate, Album, Home, and Settings workflows.
- Explorer-style file operations, context menus, drag/drop, global and scoped
  search, split panes, tabs, breadcrumbs, and Windows Shell visuals.
- Text, binary, developer-source, RAW, GIF, media, and PPTX-cover previews.
- Safe duplicate review, Recycle Bin operations, ZIP creation/extraction, and
  guarded file merge/write workflows.
- Dark, light, Muller Monochrome Platinum, and importable JSON themes.
- Optional theme-aware frosted-glass surfaces and macOS-inspired capsule range
  controls.
- Simplified Chinese and English interfaces, interface audio, keyboard
  navigation, and persistent workspace preferences.

### Known limits

- The Windows binaries are not code-signed and may trigger SmartScreen.
- Physical 100-200% DPI, multi-monitor, 144Hz, slow-storage, UNC, OneDrive, and
  extended real-media testing remains open.
- Stage 8's optional privileged MFT/USN index service is not included; global
  search uses the existing traversal index with fallback behavior.
