# Stage 2 - deduplication core report

Status: complete on 2026-07-21.

## Delivered boundary

- `muller-core`: runtime-agnostic Rust library with no Tauri dependency.
- `muller-dedup`: read-only human/JSON CLI behind the default `cli` feature.
- Root Cargo workspace containing `muller-core` and the existing Tauri shell.
- One workspace `Cargo.lock` and one ignored `.cargo-target` output tree.

Deletion, recycle-bin integration, cancellation, Tauri commands, and frontend
result streaming remain outside this stage.

## Funnel and memory bounds

1. Walk configured roots without following symlinks, prune protected subtrees,
   read metadata, and retain only size buckets containing multiple physical
   files.
2. Read a maximum of 64KB from each end of a large candidate. Files up to 128KB
   are read once in full. Group candidates by xxHash3.
3. Stream survivors through BLAKE3 using one fixed 256KB buffer per active hash.
   Files are processed in bounded batches by a private Rayon pool with at most
   eight threads by default.

No memory mapping or whole-large-file allocation is used. A changed size,
unreadable file, walk error, or sharing violation is isolated into the skipped
report rather than aborting other roots.

## Safety semantics

- Windows system and program paths are always merged into the blacklist.
- A root that resolves inside a protected path is rejected before traversal.
- Additional blacklisted subtrees are pruned before their contents are visited.
- Overlapping roots are collapsed after canonicalization.
- Physical identity uses volume serial + file index on Windows and device + inode
  on Unix.
- Hard-link aliases are counted once. Filesystem link count remains on the
  result, multi-link entities are preferred as the keep candidate, and removing
  one alias is never counted as reclaimed storage.
- Group and file ordering is deterministic across scans.
- xxHash and BLAKE3 serialize as hexadecimal strings so future JavaScript IPC
  cannot lose 64-bit fingerprint precision.

## Automated coverage

Fifteen tests cover:

- head/tail boundary sizes from empty through 128KB + 1;
- exact duplicates and same-size false positives;
- equal head/tail regions with different middle content;
- deterministic ordering, keep suggestion, and reclaimable-byte math;
- overlapping roots;
- hard-link identity and conservative reclaim accounting;
- protected subtree pruning and protected-root rejection;
- Windows exclusive sharing locks without scan-wide failure;
- minimum-size filtering before content I/O;
- ordered progress phases and byte accounting;
- CLI JSON schema and missing-root exit behavior.
- hash-thread clamping to the 32-thread hard resource limit.

Quality commands:

```powershell
cargo test -p muller-core
cargo clippy -p muller-core --all-targets -- -D warnings
cargo check -p muller-core --no-default-features --lib
cargo test --workspace --locked
```

## Benchmark baseline

Command:

```powershell
cargo bench -p muller-core --bench funnel -- --warm-up-time 1 --measurement-time 1 --sample-size 10
```

| Fixture | Measured interval |
|---|---:|
| 100 x 16KB files, ten repeated contents | 5.81-5.97ms |
| 8 x 4MB files, four repeated contents | 3.18-3.25ms |

These are warm-cache development-machine regression references. They do not
represent cold-disk, network-share, antivirus, or 144Hz UI performance claims.

## Stage 3 handoff

The desktop bridge should call the synchronous scan from a blocking task and
forward ordered `ProgressEvent` values through a Tauri `Channel`. It must add a
cancellation token at batch/walk boundaries and must not run BLAKE3 directly on
Tokio async workers. The Tauri dependency should use `muller-core` with
`default-features = false` so CLI-only dependencies are excluded.
