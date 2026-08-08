# muller-diff

`muller-diff` is Muller's runtime-independent, read-only comparison engine.

It provides cancellable folder comparison, text/binary routing, explicit Myers
line diff with character ranges, encoding/line-ending metadata, and bounded
binary range reads. The Tauri layer owns tasks, sessions, and paging.

Supported text routes are UTF-8, UTF-8 BOM, UTF-16LE/BE BOM, GBK, and
Windows-1252. Text inputs are capped at 64MB per side. Binary reads are capped at
64KB per call.

```powershell
cargo test -p muller-diff --locked
cargo clippy -p muller-diff --all-targets --locked -- -D warnings
```

This crate performs no mutation.
