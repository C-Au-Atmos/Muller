use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("scan cancelled")]
    Cancelled,

    #[error("at least one scan root is required")]
    NoRoots,

    #[error("scan root does not exist: {0}")]
    RootNotFound(PathBuf),

    #[error("scan root is not a directory: {0}")]
    RootNotDirectory(PathBuf),

    #[error("scan root {root} is protected by blacklist entry {protected}")]
    ProtectedRoot { root: PathBuf, protected: PathBuf },

    #[error("cannot inspect scan root {path}: {source}")]
    RootIo {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("cannot build bounded hashing pool: {0}")]
    ThreadPool(#[from] rayon::ThreadPoolBuildError),
}
