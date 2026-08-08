# Stage 5.1 - Browse foundation report

Status: complete on 2026-07-22.

## Corrected product boundary

The synthetic Locate workspace has been removed from the application shell.
`Browse` is now the default, real filesystem workspace. The 12,000-row fixture
files remain available to historical Stage 1 code and reports, but they are no
longer presented as a user-facing file browser.

Browse and Compare now share the same top-level navigation contract:

- editable active-pane address;
- Back, Forward, Up, and single/split controls;
- independent left and right paths, histories, selections, and paged sessions;
- double-click or Enter to open an item;
- an explicit toolbar button to open the selected item;
- F5 refresh and Backspace parent navigation.

The browser build continues to report the native runtime boundary. It does not
substitute fixtures for real files.

## File-manager commands

Browse supports a single selected entry per pane and an application file
clipboard. Toolbar, keyboard, and context-menu routes converge on the same
commands:

- Copy: `Ctrl+C`;
- Cut: `Ctrl+X`;
- Paste: `Ctrl+V`;
- Rename: `F2`;
- Move to Recycle Bin: `Delete` with confirmation;
- Open: double-click or Enter;
- Refresh: `F5`;
- Up: Backspace;
- Open a directory in the left or right pane;
- Properties for the current directory snapshot.

Tool switching is now `Ctrl+1` for Browse, `Ctrl+2` for Duplicates, and
`Ctrl+3` for Compare. This leaves F2 available for the standard rename command.

Right-clicking a row selects it and opens the entry menu. Right-clicking empty
list space opens the directory menu. Symbolic links and special entries remain
read-only in mutation commands.

## Conflict behavior

Paste and rename first use the `fail` strategy. If the destination exists, the
frontend stops and offers:

- Skip;
- Keep both, using `name - Copy` and then numbered variants;
- Replace.

Replace is not implemented as delete-then-copy. The existing destination is
moved to a generated sibling backup, the verified replacement is committed,
and the backup is restored if commit fails. Generated backups are removed only
after success; a cleanup failure is returned as a warning.

## Protected transfer engine

`muller-mutate` now supports files and directory trees while retaining the
existing protected-root and reparse-point policy.

Copy behavior:

1. Canonicalize and validate the source plus destination directory.
2. Walk the complete source tree before mutation and reject links, special
   entries, unreadable descendants, or protected paths.
3. Reject copying a directory into itself.
4. Copy into a unique staging path inside the destination directory.
5. Sync each output file and compare source/destination BLAKE3 plus size.
6. Re-snapshot the source tree to detect changes during the operation.
7. Rename the staged entry into place and apply the selected conflict policy.

Move and rename use same-volume `rename` first. Case-only Windows renames use a
generated sibling name for the two-step transition. On a cross-volume move,
Muller performs the verified copy path and then moves the source to the system
Recycle Bin. If source recycling fails, the verified destination remains, the
clipboard is retained, and the UI displays a warning rather than claiming a
complete move.

Long copy operations have a task id and cancellation token. Cancellation is
checked during traversal, copy, and hashing. A cancellation before commit
removes staging output. Once an atomic rename has committed, cancellation does
not attempt to manufacture a rollback race.

## Recycle behavior

Explorer deletion always means Recycle Bin. Permanent deletion is deliberately
not mapped to ordinary Delete or Shift+Delete in this stage.

Before invoking the system recycler, the backend compares the selected entry's
kind, size, and modification time with the directory snapshot and re-runs the
protected path policy. Duplicate-result recycling retains its stronger BLAKE3
and hard-link checks from Stage 5.

## Automated evidence

New mutation tests cover:

- verified directory-tree copy;
- same-volume move and rename;
- Windows case-only rename;
- keep-both naming;
- replace commit and generated-backup cleanup;
- recursive self-copy rejection;
- invalid rename path components;
- cancellation without destination or staging residue;
- explorer snapshot validation before recycling;
- transfer task cancellation and retirement in the Tauri manager.

All filesystem mutation tests operate only in temporary directories. Recycler
tests inject a fake implementation and never call the user's real Recycle Bin.

Browser/Edge scenarios verify the default Browse address, two panes, split
toggle, empty-directory context menu, disabled Paste without a clipboard,
responsive containment, browser runtime errors, and the existing Compare and
Flow Border gates.

## Current boundaries

- The Browse clipboard is an in-application file clipboard; it does not yet
  publish or consume Windows CF_HDROP clipboard data from other applications.
- Selection is one entry per pane. Multi-select transfer is not part of this
  corrective foundation.
- Transfer cancellation is available, while byte-level progress reporting is
  not yet exposed in the toolbar.
- New folder/file creation and permanent deletion are not enabled.
- Native file opening uses the Windows default application. Browser mode cannot
  invoke it.
