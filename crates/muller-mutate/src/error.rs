use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum MutationError {
    #[error("mutation cancelled")]
    Cancelled,

    #[error("path does not exist: {0}")]
    PathNotFound(PathBuf),

    #[error("mutation target is not a regular file: {0}")]
    NotRegularFile(PathBuf),

    #[error("mutation target is not a file or directory: {0}")]
    NotFileOrDirectory(PathBuf),

    #[error("symbolic links and reparse aliases cannot be mutated: {0}")]
    SymlinkTarget(PathBuf),

    #[error("mutation target {path} is protected by {protected}")]
    ProtectedPath { path: PathBuf, protected: PathBuf },

    #[error("cannot inspect {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("editable file exceeds the {limit} byte limit: {path}")]
    EditableFileTooLarge { path: PathBuf, limit: u64 },

    #[error("file changed outside Muller since the edit session opened: {0}")]
    ExternalChange(PathBuf),

    #[error("refusing to recycle hard-linked file {path} ({links} links)")]
    HardLinkedFile { path: PathBuf, links: u64 },

    #[error("text contains characters that cannot be represented by {encoding}")]
    EncodingLoss { encoding: String },

    #[error("invalid BLAKE3 fingerprint: {0}")]
    InvalidFingerprint(String),

    #[error("cannot create a unique same-directory temporary file for {0}")]
    TemporaryPathExhausted(PathBuf),

    #[error("atomic replacement failed for {path}: {source}")]
    Replace {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("rollback backup does not exist: {0}")]
    BackupNotFound(PathBuf),

    #[error("cannot recycle {path}: {message}")]
    Recycle { path: PathBuf, message: String },

    #[error("invalid file name: {0}")]
    InvalidName(String),

    #[error("destination already exists: {0}")]
    DestinationConflict(PathBuf),

    #[error("file operation failed for {path}: {message}")]
    Operation { path: PathBuf, message: String },

    #[error(transparent)]
    Diff(#[from] muller_diff::DiffError),
}
