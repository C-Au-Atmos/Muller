# Stage 5 - safe mutation report

Status: complete on 2026-07-22.

## Delivered boundary

Stage 5 adds a runtime-independent `muller-mutate` crate, Tauri edit sessions,
a lazily loaded CodeMirror merge workspace, and confirmed duplicate-file
recycling. Read-only paging remains the default Compare behavior. No full text
is sent to React until the user explicitly enters Edit / Merge, and editable
files are capped at 8MB per side.

## Protected edit sessions

Opening an edit session validates that each target exists, is a regular file,
is not a symbolic link or Windows reparse alias, and is outside protected
Windows roots. The session retains:

- canonical path;
- original encoding and line-ending classification;
- normalized LF editor text;
- the original separator at each line ordinal;
- size, modification time, and BLAKE3 fingerprint;
- the latest rollback backup and its fingerprint.

The fingerprint is measured before and after decoding. Hashing also compares
metadata before and after the read, so a file that changes while the session is
being established is rejected rather than opened from an inconsistent
snapshot.

## Encoding and line endings

Saves preserve UTF-8, UTF-8 BOM, UTF-16 little/big endian BOM, GBK, and
Windows-1252. Legacy encodings reject unrepresentable editor content before a
temporary file is created. UTF-16 output is encoded explicitly by code unit and
byte order rather than relying on an ambiguous generic encoder path.

CRLF, LF, CR, and mixed files are normalized only inside the editor. On save,
existing separator ordinals are restored exactly. Additional line separators
use the predominant original style. This makes an unchanged mixed file byte-
stable and gives inserted trailing lines a deterministic convention. If an
edit inserts lines in the middle of a mixed-ending file, separator preservation
is ordinal rather than based on semantic line identity.

## Atomic save and rollback

Every save follows this sequence:

1. Revalidate policy plus size, mtime, and BLAKE3 against the session.
2. Encode the editor text in the original encoding and enforce the 8MB limit.
3. Create a unique temporary file in the target directory with `create_new`.
4. Write all bytes, flush, copy target permissions, and call `sync_all`.
5. Revalidate the target fingerprint immediately before commit.
6. Atomically replace the target while creating a unique backup.
7. Fingerprint the committed target and backup, then update session state.

Windows commits through `ReplaceFileW` with `REPLACEFILE_WRITE_THROUGH`. Unix
builds copy and sync the backup, atomically rename the same-filesystem temporary
file, and sync the parent directory. An injected replacer test proves a failed
commit leaves the target bytes intact and removes the temporary file.

Rollback applies the same target fingerprint check and separately validates
the backup fingerprint. It atomically restores the backup and keeps the
replaced version as the next rollback point. An external change to either the
target or backup produces a conflict instead of an overwrite.

The newest backup remains beside the file when an edit session closes. A later
successful save in the same session removes its older backup only after the new
backup is valid. This favors recoverability over silently deleting the last
known-good copy.

## Recycle-bin safety

The Duplicates workspace exposes the trash action only for the selected `DUP`
entry. `KEEP` entries are never actionable, and files reporting more than one
hard link remain disabled. The user must confirm a dialog showing the path,
size, and BLAKE3 prefix before the command is sent.

The backend does not trust the frontend decision. It preflights every candidate
before moving any file:

- path policy and canonical regular-file validation;
- duplicate candidate detection;
- actual operating-system hard-link count;
- strict 64-character expected BLAKE3 parsing;
- current BLAKE3 equality.

One failed preflight aborts the whole batch without invoking the recycler.
After preflight, operating-system recycle failures are reported per file. A
successful UI recycle automatically starts a fresh duplicate scan.

Tests use temporary directories and an injected fake recycler. They never call
the real system Recycle Bin or mutate user-selected files.

## Tauri and frontend contracts

New commands:

- `open_edit_session`;
- `save_edit_side`;
- `rollback_edit_side`;
- `close_edit_session`;
- `recycle_duplicates`.

Open, save, rollback, hashing, encoding, and recycle work run through
`spawn_blocking`. Edit sessions retain independent left and right documents
behind per-session locks. Closing or replacing a frontend generation prevents a
late open response from becoming active.

CodeMirror and `@codemirror/merge` are emitted as a separate dynamic chunk.
Both sides are editable. A segmented arrow control switches built-in hunk
application between left-to-right and right-to-left. Each side has independent
save and rollback controls. On a conflict, editor contents remain mounted and
the backend refuses the write. Closing edit mode rebuilds the paged read-only
diff so it cannot display pre-save rows.

## Automated evidence

The mutation crate has 18 tests covering:

- protected paths and symlink policy;
- UTF-8 BOM, UTF-16LE/BE, GBK, CRLF, and mixed-ending round trips;
- unrepresentable legacy-encoding output;
- save and rollback after external changes;
- real Windows atomic backup and rollback in temporary directories;
- injected replacement failure and temporary-file cleanup;
- all-candidate recycle preflight, partial recycler failure, and hard links.

The broader gate retains Rust workspace tests, warnings-denied Clippy, strict
TypeScript, ESLint, 14 frontend tests, five browser/Edge scenarios, and a Tauri
debug executable build. The exact final totals are recorded in the roadmap.

## Known boundaries

- Editing deliberately has a lower 8MB limit than the 64MB read-only diff.
- Mixed separator restoration follows line ordinal. It cannot infer semantic
  identity after arbitrary line insertion or reordering.
- Backups are visible same-directory files whose names contain
  `.muller-backup` or `.muller-rollback`. They are retained for recovery.
- Real Recycle Bin behavior is not automated because the safety suite must not
  move user files. The production adapter is exercised only by an explicitly
  confirmed desktop action.
- Headless browser tests cannot invoke native Tauri edit sessions. Rust tests
  cover the native contracts; the browser suite continues to verify the normal
  runtime boundary and responsive shell.
