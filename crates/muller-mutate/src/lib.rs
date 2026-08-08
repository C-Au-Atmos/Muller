//! Protected, conflict-aware file mutation primitives for Muller.
//!
//! Every operation validates its path policy before touching a file. Text saves
//! revalidate the original fingerprint, preserve encoding/line endings, write
//! and flush a same-directory temporary file, and atomically replace the target
//! while retaining a rollback backup.

mod atomic;
mod document;
mod error;
mod file_ops;
mod fingerprint;
mod policy;
mod recycle;

pub use atomic::{RollbackReport, SaveReport, rollback_document, save_document};
pub use document::{EditableDocument, EditableDocumentInfo, MAX_EDITABLE_BYTES, open_document};
pub use error::MutationError;
pub use file_ops::{
    ConflictStrategy, EntryExpectation, EntryKind, TransferMode, TransferOutcome, TransferReport,
    recycle_entry, rename_entry, transfer_entry,
};
pub use fingerprint::{FileFingerprint, fingerprint_file, parse_hash_hex};
pub use policy::MutationPolicy;
pub use recycle::{
    RecycleCandidate, RecycleFailure, RecycleReport, Recycler, SystemRecycler, recycle_candidates,
};
