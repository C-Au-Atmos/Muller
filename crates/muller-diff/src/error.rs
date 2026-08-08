use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DiffError {
    #[error("comparison cancelled")]
    Cancelled,

    #[error("path does not exist: {0}")]
    PathNotFound(PathBuf),

    #[error("folder comparison root is not a directory: {0}")]
    RootNotDirectory(PathBuf),

    #[error("file comparison path is not a file: {0}")]
    PathNotFile(PathBuf),

    #[error("cannot inspect {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("text file exceeds the {limit} byte comparison limit: {path}")]
    TextTooLarge { path: PathBuf, limit: u64 },

    #[error("file is not recognized as text: {0}")]
    NotText(PathBuf),

    #[error("binary range length {requested} exceeds the {maximum} byte limit")]
    BinaryRangeTooLarge { requested: usize, maximum: usize },
}
