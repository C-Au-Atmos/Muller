# muller-mutate

`muller-mutate` is Muller's runtime-independent safety boundary for editable
text files, recoverable file management, and recycle-bin operations.

The crate provides:

- edit sessions capped at 8MB per file;
- size, modification-time, and BLAKE3 conflict validation;
- UTF-8, UTF-8 BOM, UTF-16LE/BE BOM, GBK, and Windows-1252 output;
- original CRLF, LF, CR, and mixed separator preservation by line ordinal;
- same-directory temporary writes with flush and `sync_all` before commit;
- Windows `ReplaceFileW` atomic replacement with a rollback backup;
- rollback with target and backup fingerprint validation;
- protected-path, symlink/reparse-point, and hard-link rejection;
- all-candidate recycle preflight followed by per-file failure reporting.
- staged, BLAKE3-verified file and directory copy;
- same-volume move/rename with cross-volume verified-copy fallback;
- explicit fail, skip, keep-both, and replace conflict strategies;
- cancellable traversal/copy before commit and generated-path cleanup.

The public APIs are independent of Tauri. Desktop callers are responsible for
running blocking operations outside their async executor threads. Production
recycling uses the operating system Recycle Bin through `trash`; tests inject a
fake recycler and never recycle a real user file.

```powershell
cargo test -p muller-mutate --locked
cargo clippy -p muller-mutate --all-targets --locked -- -D warnings
```

Backups are intentionally retained beside the target after a successful save
so the active edit session can roll back. A later successful save removes the
older session backup after the new backup has been created.
