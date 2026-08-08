# Muller 0.1.0 preview release readiness

Date: 2026-08-08

## Decision

The current tree is suitable for a first **preview/beta** GitHub Release after
repository initialization. The local native package smoke test has passed. It
should not be labelled stable because the physical Windows matrix below is still open.
Stage 8 is a separate performance milestone and does not block this preview.

## Automated evidence

- `npm.cmd run build`: passed.
- `npm.cmd run lint`: passed with zero warnings.
- `npm.cmd run test`: 55/55 passed.
- `cargo test --workspace --locked`: 100/100 passed.
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`:
  passed.
- `npm.cmd run test:e2e`: 74/74 passed across seven isolated spec processes;
  process isolation avoids Edge exhausting Windows network buffers during a
  single 74-context diagnostic run.
- Dark, light, Platinum, and 760px glass/capsule screenshots were inspected with
  no overlap, clipping, blank canvas, or large conflicting dark surfaces.
- The release portable executable stayed alive and responsive for the smoke
  interval with window title `Muller`; the NSIS and portable files were hashed.

## Remaining manual gates

- Windows 11 release package on 100%, 125%, 150%, and 200% DPI.
- Multi-monitor restore/drag behavior and a physical 144Hz DWM/WebView2 trace.
- HDD or controlled slow-storage Duplicate benchmarks and cancellation latency.
- Large real image/media folders, long playback switching, and memory recovery.
- OneDrive/redirected known folders, multiple physical volumes, UNC shares, and
  long network paths.
- Windows Shell thumbnail-handler fallbacks with and without third-party apps.

## GitHub publication status

- The repository is initialized and `origin` is configured for
  `AuAtmos/Muller`.
- The existing GPLv3 `LICENSE` commit is retained as the base of `main`.
- The current source tree is committed and pushed separately from any release.
- Pushing `v0.1.0` and publishing a GitHub Release still require separate,
  explicit authorization.
- The preview is unsigned. A code-signing certificate is recommended before a
  stable release but is not technically required for a preview.

## Intended assets

- `Muller_0.1.0_x64_glass-capsule-preview-setup.exe`
- `Muller_0.1.0_x64_glass-capsule-preview-portable.exe`

Local candidate SHA-256 values:

- setup: `1BDAAAEB49188036DE64169AC23DF4E332CA6BF380000CE3A1857ED4190A5374`
- portable: `F908BFE462A50CFD4D40E8220E5472BB4AAF1331E53F1A0359A30ABC8C0A5A8B`

The setup executable is the normal end-user path. The portable executable runs
without Node.js, Rust, Visual Studio, or source-code dependencies. Windows 11
normally supplies WebView2; uncommon stripped-down systems may need Microsoft's
Evergreen WebView2 Runtime installed once.

## Publication sequence

1. The repository, `origin`, author metadata, and GPLv3 licensing are configured.
2. The current source tree is committed and pushed to `main`.
3. Confirm the Windows CI workflow passes.
4. With separate authorization, push tag `v0.1.0`; the release workflow then
   creates a draft prerelease.
5. Download and smoke-test both assets on a clean Windows account or machine.
6. Add screenshots and known limits, then explicitly publish the draft.
