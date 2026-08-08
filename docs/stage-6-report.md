# Stage 6 - operating model and preview report

Status: complete on 2026-07-22.

## Operating model

Muller now remains resident in the Windows notification area when its main
window is closed. The tray provides explicit Show and Quit commands. A left
click restores, unminimizes, and focuses the existing main window rather than
creating another application instance.

`Ctrl+Shift+Space` performs the same restore operation from outside Muller. A
shortcut collision is treated as a degraded capability and does not prevent
the application from starting; the tray remains available in that case.

The native close request is intercepted only to hide the main window. The tray
Quit command uses the application exit path and does not loop through the
close-to-tray handler.

## Command mode

`Ctrl+K` opens a modal command palette with search, Up/Down selection, Enter
execution, Escape dismissal, pointer selection, and a visible toolbar button.
It exposes tool switching, pane history, parent navigation, split mode,
preview, and sound controls. Commands retain their normal enabled/disabled
state and do not open over existing rename, conflict, recycle, or properties
dialogs.

The existing direct keymap remains available. Space toggles the Browse preview
unless focus is in an editable control, and Ctrl+1/Ctrl+2/Ctrl+3 continue to
switch the main workspaces.

## Bounded preview service

Browse has a selectable preview panel backed by a native cancellable task, not
an unrestricted frontend file read. Selection changes, closing the panel,
leaving the component, and hiding the application cancel the current task.
Returning to a visible window reloads the currently selected preview.

Current limits are:

- text: 128 KiB maximum per preview, with explicit truncation state;
- images: 4 MiB maximum source payload per preview;
- cache: at most 32 entries and 16 MiB of encoded/text content;
- reads: fixed 32 KiB chunks with cancellation checks;
- inputs: regular files only; symlinks and non-files are rejected.

The LRU cache is keyed by canonical path and validates size plus modification
time before reuse. It is tested independently for count and byte-budget
eviction. Text content is rendered as escaped React text. Supported inline
image types exclude SVG, so preview data cannot inject active markup.

This stage establishes the task and cache boundary future Album work can
reuse. It does not yet generate downscaled thumbnails or expose a scoped custom
protocol. Images within the limit are transferred as bounded data URLs through
the Tauri Channel; Album still needs native thumbnail encoding before a large
Masonry directory can be enabled.

## Feedback and suspension

Interface audio is opt-in and persisted locally. Enabling it primes one Web
Audio context from the user gesture. A 90 ms limiter suppresses event bursts,
and hidden documents never play sound. Completed Browse mutations, duplicate
scans, and folder comparisons trigger the success tone and a short success
particle burst. Reduced-motion users do not receive particle animation.

The Flow Border Worker already accepted visibility messages. Stage 6 also
pauses its CSS fallback, cancels preview work, and suppresses audio while the
document is hidden. Filesystem scans and committed file operations are not
silently aborted when the window moves to the tray.

## Foundation corrections included

The production chrome no longer exposes the Stage 1 `Idle`, `Scan`, `Done`,
`Risk`, or synthetic `Main load` controls. Duplicate-list scrolling no longer
performs intentional main-thread busy work.

Windows verbatim paths such as `\\?\D:\Muller` stay internal. Browse and Compare
display `D:\Muller`, return user-form entry paths, and compute `D:\` as the real
parent. `D:\` remains the volume root; a future This PC view would be a virtual
shell location rather than a filesystem parent.

Directory selection surfaces no longer share Motion layout identities across
panes. Each pane displays selection immediately and keeps an inactive
selection visible with reduced emphasis.

Folder Compare prevents identical left/right roots. Its verification metric is
now labelled as cumulative disk reads, includes a no-write tooltip, and reports
the verified file count after completion.

## Automated evidence

- 68 Rust workspace tests pass, including four preview task/cache tests.
- 18 frontend unit tests pass, including path normalization and audio rate
  limiting.
- Six Edge E2E scenarios pass across 390 px mobile and desktop viewports.
- E2E covers command search/execution, preview keyboard toggling, same-root
  Compare prevention, hidden suspension, overflow, fallback, and canvas pixels.
- TypeScript production build and ESLint with zero warnings pass.
- Rustfmt, Clippy with warnings denied, and the no-default-features core check
  pass.
- Tauri debug build succeeds at `.cargo-target/debug/muller.exe`.
- Native smoke testing creates a responsive Windows window titled `Muller`;
  a standard `WM_CLOSE` leaves the process alive, hides the window, and allows
  the same native window to be restored.

The physical 144 Hz/DWM acceptance run remains a hardware-only gate from Stage
1 and is not claimed by headless Edge automation.
