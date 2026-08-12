# Changelog

All notable changes to Muller are documented in this file.

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
