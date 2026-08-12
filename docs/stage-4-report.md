# Stage 4 - read-only comparison report

Status: complete on 2026-07-21.

## Delivered boundary

Stage 4 adds a runtime-independent `muller-diff` crate, cancellable Tauri
sessions, and a real Compare workspace. It remains fully read-only.

The Stage 3.1 prerequisite was delivered with it:

- Two independent directory panes with active-pane focus.
- Editable active-pane address, Back, Forward, Up, and single/split controls.
- Non-recursive directory snapshots remain in Rust sessions; React requests only
  the 128-entry pages intersecting its virtual window.
- Directory sessions use task id plus frontend generation isolation. Cancelling
  a task also closes a session already created under the same id, covering the
  ready/invoke race and StrictMode teardown.
- Directories sort before files with deterministic case-aware name ordering.
- Symlinks are identified and never followed implicitly.

## Folder comparison

`muller-diff` walks both roots without following links, keys entries by relative
path, and classifies:

- left-only;
- right-only;
- different kind, size, or BLAKE3 content;
- equal content;
- equal content with different modification time;
- per-entry hash errors.

Modification time is informational by default. The explicit Strict time option
promotes it to a difference. Same-size file pairs use the existing cancellable,
256KB-buffered BLAKE3 API from `muller-core`; comparison never introduces an
unbounded full-file read.

The completed folder report stays in a native session. The frontend consumes at
most 128 entries per requested page and renders fixed 40px virtual rows. Next or
previous difference lookup runs against the backend session, so intermediate
pages do not need to be loaded into JavaScript.

## Text routing and diff

Text inspection recognizes:

- UTF-8 and UTF-8 BOM;
- UTF-16 little/big endian with BOM;
- GBK and Windows-1252 through `chardetng` and `encoding_rs`;
- LF, CRLF, CR, mixed, and no-line-ending metadata;
- binary control/null-byte samples.

Line endings are normalized only for diff computation, preventing every line
from appearing changed when content is equal across CRLF/LF. Original encoding
and line-ending metadata remains on the session and is shown in the UI.

Myers is selected explicitly through `similar`. Replace rows include character-
level highlight ranges. Decoded input is capped at 64MB per file. Diff rows stay
in the native session and are exposed in pages capped at 512 rows; the React
virtual view requests 256 rows at a time and mounts only its visible window.

## Binary comparison

When either side routes as binary, the backend exposes seek-based ranges capped
at 64KB. The current UI requests 4KB at a time and renders aligned 16-byte Hex
rows with differing indices highlighted. Previous/next range controls do not
retain the complete file in Rust or JavaScript.

## Tauri contract

New commands:

- `start_directory_query`, `cancel_directory_query`, `read_directory_page`,
  `close_directory_session`;
- `start_folder_diff`, `start_file_diff`, `cancel_diff`;
- `read_folder_diff_page`, `read_text_diff_page`, `read_binary_range`;
- `find_diff_position`, `close_diff_session`.

Blocking directory walks, hashing, decoding, and Myers computation run through
`spawn_blocking`. Channel events carry task ids and emit `ready` only after the
native session has been stored, preventing an immediate page read from racing
session creation.

## Frontend behavior

- Compare is available from the function rail and F3.
- The header address and navigation buttons bind to the active pane.
- The split control switches between one visible pane and the two-pane layout
  without discarding either pane's history/session.
- Browse, Folder diff, and File diff are explicit tabs.
- Selecting one file on each pane enables direct file comparison.
- Double-clicking a two-sided changed folder-diff file opens text or Hex diff.
- Enter opens a selected directory/diff file; arrows and Page Up/Down navigate;
  Alt+Down/Alt+Up request the next/previous backend difference position.
- Normal-browser mode reports the native runtime boundary instead of displaying
  fixtures as real files.

## Automated evidence

The final gate set includes:

- folder classification, deterministic ordering, timestamp policy, hashing,
  cancellation, and no-complete-after-cancel tests;
- UTF-8 BOM, UTF-16LE/BE BOM, GBK, CRLF/LF, character replacement, 20,000-line
  Myers, and binary range tests;
- native session ordering, page caps, cleanup-after-completion, task
  cancellation, serialization, and backend difference navigation tests;
- frontend paging, command registry, scan state, list modeling, and Worker model
  tests;
- Edge tests for the original Worker/fallback/mobile gates plus Compare address,
  pane layout, split control, browser runtime boundary, and horizontal overflow.

Exact command/test counts are recorded by the current roadmap verification line.

## Known boundaries

- Myers needs both decoded texts and its diff rows in native memory. The 64MB
  per-file ceiling makes this bounded but can still be a substantial session;
  users receive an explicit error above the ceiling.
- The native folder report retains one entry per discovered relative path until
  the session is closed. Frontend DOM and JavaScript retention are paged, but an
  extremely large recursive tree still scales native session memory with entry
  count.
- Encoding detection deliberately supports the documented Windows-focused set,
  not every legacy encoding.
- Hex is read-only. Text editing, hunk apply, save, delete, recycle-bin behavior,
  backups, and atomic writes remain Stage 5.
- Headless Edge cannot invoke native Channels. Rust tests cover the contracts;
  a live WebView2 run remains the final environment check for real directories.
