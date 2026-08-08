use std::{
    env, fs,
    path::{Path, PathBuf},
};

use crate::MutationError;

#[derive(Debug, Clone)]
pub struct MutationPolicy {
    protected: Vec<PathBuf>,
}

impl Default for MutationPolicy {
    fn default() -> Self {
        let mut protected = default_protected_paths();
        protected.sort_by_key(|path| sort_key(path));
        protected.dedup_by(|left, right| sort_key(left) == sort_key(right));
        Self { protected }
    }
}

impl MutationPolicy {
    #[must_use]
    pub fn with_protected_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.protected.push(path.into());
        self
    }

    pub fn validate_file(&self, requested: &Path) -> Result<PathBuf, MutationError> {
        let path = self.validate_entry(requested)?;
        if !path.is_file() {
            return Err(MutationError::NotRegularFile(path));
        }
        Ok(path)
    }

    pub fn validate_directory(&self, requested: &Path) -> Result<PathBuf, MutationError> {
        let path = self.validate_entry(requested)?;
        if !path.is_dir() {
            return Err(MutationError::NotFileOrDirectory(path));
        }
        Ok(path)
    }

    pub fn validate_entry(&self, requested: &Path) -> Result<PathBuf, MutationError> {
        if !requested.exists() {
            return Err(MutationError::PathNotFound(requested.to_path_buf()));
        }
        let link_metadata =
            fs::symlink_metadata(requested).map_err(|source| MutationError::Io {
                path: requested.to_path_buf(),
                source,
            })?;
        if is_link_or_reparse_point(&link_metadata) {
            return Err(MutationError::SymlinkTarget(requested.to_path_buf()));
        }
        if !link_metadata.is_file() && !link_metadata.is_dir() {
            return Err(MutationError::NotFileOrDirectory(requested.to_path_buf()));
        }
        let path = fs::canonicalize(requested).map_err(|source| MutationError::Io {
            path: requested.to_path_buf(),
            source,
        })?;
        for protected in &self.protected {
            let normalized = normalize_existing_or_absolute(protected)?;
            if same_or_descendant(&path, &normalized) {
                return Err(MutationError::ProtectedPath {
                    path,
                    protected: normalized,
                });
            }
        }
        Ok(path)
    }
}

#[cfg(windows)]
fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;

    metadata.file_type().is_symlink()
        || metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
}

#[cfg(not(windows))]
fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn normalize_existing_or_absolute(path: &Path) -> Result<PathBuf, MutationError> {
    if path.exists() {
        return fs::canonicalize(path).map_err(|source| MutationError::Io {
            path: path.to_path_buf(),
            source,
        });
    }
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        env::current_dir()
            .map(|current| current.join(path))
            .map_err(|source| MutationError::Io {
                path: path.to_path_buf(),
                source,
            })
    }
}

fn same_or_descendant(path: &Path, parent: &Path) -> bool {
    if cfg!(windows) {
        let path = sort_key(path);
        let parent = sort_key(parent).trim_end_matches(['\\', '/']).to_owned();
        path == parent
            || path
                .strip_prefix(&parent)
                .is_some_and(|remainder| remainder.starts_with(['\\', '/']))
    } else {
        path == parent || path.starts_with(parent)
    }
}

fn sort_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

#[cfg(windows)]
fn default_protected_paths() -> Vec<PathBuf> {
    [
        ("SystemRoot", r"C:\Windows"),
        ("ProgramFiles", r"C:\Program Files"),
        ("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        ("ProgramData", r"C:\ProgramData"),
    ]
    .into_iter()
    .map(|(variable, fallback)| {
        env::var_os(variable).map_or_else(|| PathBuf::from(fallback), PathBuf::from)
    })
    .collect()
}

#[cfg(not(windows))]
fn default_protected_paths() -> Vec<PathBuf> {
    ["/System", "/bin", "/etc", "/sbin", "/usr"]
        .into_iter()
        .map(PathBuf::from)
        .collect()
}
