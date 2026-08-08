# Muller

Muller is a Windows 11 desktop tool for duplicate-file discovery and file or
directory comparison. The product is being delivered as risk-ordered vertical
slices; the implementation plan is tracked in
[`docs/implementation-roadmap.md`](docs/implementation-roadmap.md).

## Install on another PC

End users do not need Node.js, Rust, Visual Studio, or the source tree. Download
one of the Windows x64 assets from the repository's GitHub Releases page:

- `*-setup.exe` is the recommended installer and creates the normal Windows
  application entry.
- `*-portable.exe` runs directly and can be kept on a removable drive.

Windows 11 normally includes the Microsoft Edge WebView2 Runtime used by
Muller. If a stripped-down Windows image does not have it, install the current
Evergreen WebView2 Runtime from Microsoft. The 0.1.0 preview binaries are not
code-signed, so Windows SmartScreen may show an unknown-publisher warning.
Development prerequisites below are only needed to build Muller from source.

Muller is licensed under the GNU General Public License v3.0. See `LICENSE`.

## Prerequisites

- Node.js 24+
- Rust 1.87+ with the MSVC target
- Microsoft C++ Build Tools and WebView2 for Tauri desktop builds

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

Quality gates:

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

The end-to-end suite uses the locally installed Microsoft Edge channel and
writes diagnostic screenshots under the ignored `test-results/` directory.

Regenerate deterministic application icons after changing the brand mark:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
```

Run the desktop shell after the native prerequisites are available:

```powershell
npm.cmd run tauri dev
```

Browse is the default native workspace. It exposes two independently navigable
directory panes with an editable active-pane address, Back, Forward, Up,
single/split mode, double-click/Enter open, and F5 refresh. The toolbar and
right-click menu provide copy, cut, paste, rename, properties, and confirmed
Recycle Bin operations. Standard shortcuts are `Ctrl+C`, `Ctrl+X`, `Ctrl+V`,
`F2`, `Delete`, and Backspace. `Ctrl+1`, `Ctrl+2`, and `Ctrl+3` switch Browse,
Duplicates, and Compare. In a split Browse or Compare directory view, Left and
Right activate and focus the corresponding pane. Files without a registered
default application open the Windows Open with dialog; the same chooser is
available explicitly from a file's context menu.

`Ctrl+F` is owned by Muller rather than WebView2. In Browse and the directory
view of Compare it searches the active pane's complete native directory
session, including entries not yet paged into the visible list. In Duplicates it
filters groups by file path while preserving the full matching group for
KEEP/DUP context. These searches are non-recursive; global/indexed search and
search inside Compare diff rows are outside Stage 6.1.

Space toggles the bounded preview panel for the selected Browse file. Text
previews read at most 128 KiB, image previews accept source files up to 4 MiB,
and switching selection cancels stale work. `Ctrl+K` opens the searchable
command palette. Interface audio is opt-in from the speaker button.

Closing the native window keeps Muller in the notification area. Left-click the
tray icon, choose Show Muller, or press `Ctrl+Shift+Space` globally to restore
the existing window. Use Quit Muller in the tray menu to exit the resident
process.

Copying a directory first validates the complete tree, writes into a same-
destination staging path, syncs output files, verifies BLAKE3 content, and then
commits by rename. Destination conflicts require Skip, Keep both, or Replace.
Protected Windows roots and symlink/reparse aliases remain read-only. Delete
means Recycle Bin; this stage does not expose permanent deletion.

The Duplicates workspace performs a real read-only filesystem scan only inside
the Tauri desktop runtime. Enter an absolute Windows root, choose the minimum
file size in bytes, and use the play button to start or restart. The stop button
or Escape cancels the active task. Starting again also cancels the previous task
and isolates any late events by generation and task id.

The scan follows neither symlinks nor protected Windows system paths. It reports
unreadable files separately. A selected `DUP` can be moved to the operating
system Recycle Bin only after explicit confirmation; `KEEP` and hard-linked
entries are blocked, and the backend revalidates the current BLAKE3 before any
move. Opening the Vite URL in a normal browser is supported for UI and Worker
profiling, but filesystem operations there intentionally report that the
desktop runtime is required.

The Compare workspace is also native-only. Ctrl+3 opens two independently navigable
directory panes. The header address, Back, Forward, and Up controls target the
active pane; the split control preserves both pane sessions while showing one or
two panes. Compare runs a read-only relative-path/content folder diff, and
changed files open a paged Myers text view or an on-demand Hex range view.

Text comparison recognizes UTF-8, GBK, UTF-16 BOM, and line-ending differences.
It is capped at 64MB per side; binary views read 4KB windows. Text pairs up to
8MB per side can enter the explicit Edit / Merge mode, which lazily loads a
CodeMirror two-sided editor with directional hunk application. Saves preserve
encoding and line endings, validate size/mtime/BLAKE3, atomically replace the
target, and retain a rollback backup. Hex remains read-only.

Run the Stage 2 duplicate-discovery CLI without the desktop shell:

```powershell
cargo run -p muller-core --bin muller-dedup -- --help
cargo run -p muller-core --bin muller-dedup -- D:\Data --min-size 1024
```

The first vertical slice is also browser-runnable so the Worker/WebGL renderer
can be profiled independently of Tauri and Windows compositor effects.

Stage 7, 7.9, and the Stage 7.10 preview scope have passed automated acceptance.
The remaining pre-stable gates are physical Windows hardware, slow-storage,
UNC, multi-monitor, DPI, high-refresh-rate, and real-media checks. The
privileged MFT/USN indexer remains a separate Stage 8 milestone and does not
block the 0.1.0 preview. See
[`docs/release-readiness.md`](docs/release-readiness.md) for the current release
boundary.
