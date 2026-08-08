# muller-core

`muller-core` is Muller's read-only duplicate-discovery engine. It has no Tauri
dependency and can be tested, benchmarked, or embedded independently.

## Funnel

1. Metadata discovery groups physical files by byte size. Unique sizes stop.
2. Same-size candidates read at most 64KB from each end and group by xxHash3.
3. Survivors stream through BLAKE3 with a fixed 256KB buffer in a dedicated,
   bounded Rayon pool. The default is at most eight threads and the hard cap is
   32 threads (about 8MB of full-hash read buffers).

The engine never uses `mmap`, never loads a whole large file, and never performs
deletion. Files that cannot be read or that change size during hashing are
reported individually without aborting the scan.

Hard links are collapsed by volume/file identity. The filesystem link count is
preserved, multi-link entities are preferred as the keep candidate, and deleting
one link is never counted as reclaimed storage.

## Thread boundary

`scan` is synchronous by design so the core remains runtime-agnostic. Desktop
callers must invoke the complete scan from a blocking task. Full-file hashing
uses the engine's private Rayon pool; it must never run directly on a Tokio async
worker. Ordered phase/batch progress is available through `scan_with_progress`.
Desktop callers can use `scan_cancellable_with_progress` with a shared
`CancellationToken`; cancellation is checked during traversal, candidate
fingerprinting, full-hash batches, and each 256KB full-hash read.
The same bounded full-file BLAKE3 operation is exposed as `hash_file_blake3` so
the read-only diff engine can reuse cancellation and byte accounting instead of
adding a second hashing implementation.

## CLI

The default `cli` feature builds the `muller-dedup` read-only command:

```powershell
cargo run -p muller-core --bin muller-dedup -- D:\Data --min-size 1024
cargo run -p muller-core --bin muller-dedup -- D:\Data --json --quiet
```

Embed only the library without CLI dependencies using
`default-features = false` on the path dependency.

## Quality gates

```powershell
cargo test -p muller-core
cargo clippy -p muller-core --all-targets -- -D warnings
cargo bench -p muller-core --bench funnel
```

The 2026-07-21 warm-cache development baseline on this machine was 5.81-5.97ms
for 100 x 16KB files and 3.18-3.25ms for 8 x 4MB files. These values are local
regression references, not cold-disk performance commitments.
