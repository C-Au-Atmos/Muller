//! Bounded-memory duplicate-file discovery for Muller.
//!
//! The engine is deliberately independent from Tauri. Callers own the task
//! boundary; the desktop bridge must run a scan from a blocking task, while
//! full-file hashing stays inside the engine's dedicated Rayon pool.

mod cancellation;
mod error;
mod hashing;
mod identity;
mod model;
mod path_guard;
mod scanner;

pub use cancellation::CancellationToken;
pub use error::ScanError;
pub use hashing::{FULL_HASH_BUFFER_BYTES, FileHashError, HEAD_TAIL_BYTES, hash_file_blake3};
pub use model::{
    DuplicateGroup, FileEntry, MAX_FINGERPRINT_THREADS, MAX_HASH_THREADS, ProgressEvent,
    ScanConfig, ScanPhase, ScanReport, ScanStats, SkippedFile, SkippedStage,
};
pub use scanner::{
    scan, scan_cancellable, scan_cancellable_with_progress,
    scan_cancellable_with_progress_and_groups, scan_with_progress,
};
