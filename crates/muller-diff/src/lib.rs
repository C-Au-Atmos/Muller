//! Read-only folder, text, and binary comparison for Muller.
//!
//! The crate is runtime-independent. Desktop callers own blocking task and
//! session boundaries, while this crate keeps file reads cancellable and
//! bounded by explicit limits.

mod binary;
mod error;
mod folder;
mod model;
mod text;

pub use binary::read_binary_diff_range;
pub use error::DiffError;
pub use folder::{compare_folders, compare_folders_cancellable_with_progress};
pub use model::{
    BinaryDiffRange, DecodedText, FileDiffKind, FilePairInspection, FolderDiffConfig,
    FolderDiffEntry, FolderDiffIssue, FolderDiffPhase, FolderDiffProgress, FolderDiffReport,
    FolderDiffStats, FolderDiffStatus, FolderEntryKind, FolderSide, HighlightRange, LineEnding,
    TextDiffReport, TextDiffRow, TextDiffTag, TextEncoding,
};
pub use text::{
    MAX_TEXT_FILE_BYTES, compare_text_files, decode_text_bytes, decode_text_file,
    inspect_file_pair, is_developer_text_path,
};
