# Changelog

All notable changes to Muller are documented in this file.

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
- Frontend tests: 76 passed; Rust workspace tests: 115 passed; Edge E2E tests:
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
