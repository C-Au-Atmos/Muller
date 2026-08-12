# Stage 3 - desktop scan slice report

Status: complete on 2026-07-21.

## Delivered boundary

- The runtime-independent core exposes `CancellationToken`, `scan_cancellable`,
  and `scan_cancellable_with_progress`.
- Tauri exposes `start_scan` and `cancel_scan`. A complete synchronous scan runs
  inside `spawn_blocking`; BLAKE3 work remains on the core's bounded Rayon pool.
- A typed `ipc::Channel` carries task-scoped lifecycle and result events to the
  React application.
- The Duplicates workspace accepts a Windows root and minimum file size, shows
  phase/progress/bytes, supports cancellation and restart, and virtualizes real
  duplicate groups and file rows.
- At Stage 3, the Locate workspace retained the 12,000-row pressure fixture used to verify
  main-thread responsiveness and Worker rendering isolation.
- A small command registry owns F2, Ctrl+F, Escape, arrow, and page navigation
  bindings. Input editing is not intercepted except for the explicit global
  locate and active-scan cancellation commands. Stage 5.1 later removed Locate
  from the product shell and replaced it with the real Browse workspace.

This stage remains read-only. It does not delete, recycle, modify, or rewrite a
file.

## Event contract

Every event carries a monotonically assigned `taskId`:

| Event | Payload | Meaning |
|---|---|---|
| `started` | `taskId` | Blocking scan task accepted |
| `progress` | `progress` | Discovery, fingerprint, full-hash, or complete progress |
| `groupFound` | `groupIndex`, `group` | Ordered duplicate group ready for consumption |
| `done` | counts, reclaimable bytes, skipped files, stats | Successful terminal event |
| `cancelled` | `taskId` | Cancellation terminal event; no `done` follows in that task path |
| `error` | `message` | Failed terminal event |

The event envelope uses camelCase for Tauri/TypeScript fields. Nested data owned
by `muller-core` deliberately retains its serialized snake_case schema. A Rust
serialization test locks this boundary so 64-bit fingerprints and existing CLI
JSON semantics do not drift while crossing IPC.

Groups are sorted deterministically by the core and sent by index before
`done`. The frontend flattens them into fixed 40px group/file rows and renders
only the visible window plus eight-row overscan.

## Cancellation and stale-event isolation

Cancellation is checked while walking each directory entry, before every
head/tail candidate, before every full-hash batch, and during each 256KB BLAKE3
read. A cancelled core scan never emits the `Complete` progress phase.

The desktop manager permits one active scan. Starting another scan atomically
cancels and retires the previous token. The frontend adds two independent
guards:

1. A hook generation changes on start, restart, cancel, and unmount. Callbacks
   from an older Channel are ignored even before a new task id is known.
2. Once bound, the reducer rejects events whose `taskId` does not match the
   current task.

If cancellation happens while `start_scan` is still returning, the eventual
task id is cancelled immediately. If a very small scan reaches a terminal event
before the invoke promise resolves, the hook does not rebind it to `scanning`.
Failed best-effort cancellation invokes are absorbed during teardown to avoid an
unhandled Promise rejection.

## Automated evidence

The final verification passed:

- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets --locked -- -D warnings`
- `cargo test --workspace --locked`: 16 core/CLI tests and 4 Tauri bridge tests
- `cargo check -p muller-core --no-default-features --lib --locked`
- `npm.cmd run build`
- `npm.cmd run lint`
- `npm.cmd test`: 11 tests across scan state, list modeling, keymap, and flow model
- `npm.cmd run test:e2e`: four headless Edge scenarios
- `npm.cmd run tauri -- build --debug --no-bundle`

The Edge suite covers Worker continuity under list pressure, edge-only pixels,
390x844 containment, CSS fallback direction, and the explicit browser-only scan
error. Rust tests cover the actual scan task, cancellation, ordered group/done
events, manager replacement, and the serialized Channel contract.

## Known boundaries

- Headless Playwright runs in a browser and cannot invoke a native Tauri
  Channel. A live WebView2 scan, cancellation during large-file I/O, Windows
  sharing behavior, and physical disk performance remain useful manual checks.
- The current UI accepts one typed root. The backend protocol already accepts
  multiple roots; a native folder chooser and multi-root editing can be added
  without changing the scan engine.
- Duplicate groups are streamed after the core finishes its hashing funnel.
  They are virtualized for bounded DOM cost, but the complete report remains in
  native and frontend memory for this slice.
- Reclaimable bytes are advisory and conservative around hard links. Mutation
  remains deferred until Stage 5 safety gates exist.
