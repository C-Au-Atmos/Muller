use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

use crate::{ScanConfig, ScanError};

#[derive(Debug)]
pub(crate) struct GuardedPaths {
    pub roots: Vec<PathBuf>,
    pub blacklist: Vec<PathBuf>,
}

impl GuardedPaths {
    pub fn validate(config: &ScanConfig) -> Result<Self, ScanError> {
        if config.roots().is_empty() {
            return Err(ScanError::NoRoots);
        }

        let mut blacklist = default_blacklist();
        blacklist.extend(config.additional_blacklist().iter().cloned());
        blacklist = blacklist
            .into_iter()
            .map(|path| normalize_path(&path))
            .collect::<Result<Vec<_>, _>>()?;
        sort_and_deduplicate(&mut blacklist);

        let mut roots = Vec::with_capacity(config.roots().len());
        for requested in config.roots() {
            if !requested.exists() {
                return Err(ScanError::RootNotFound(requested.clone()));
            }
            let metadata = fs::metadata(requested).map_err(|source| ScanError::RootIo {
                path: requested.clone(),
                source,
            })?;
            if !metadata.is_dir() {
                return Err(ScanError::RootNotDirectory(requested.clone()));
            }

            let root = normalize_path(requested)?;
            if let Some(protected) = blacklist
                .iter()
                .find(|protected| same_or_descendant(&root, protected))
            {
                return Err(ScanError::ProtectedRoot {
                    root,
                    protected: protected.clone(),
                });
            }
            roots.push(root);
        }

        roots.sort_by(|left, right| {
            left.components()
                .count()
                .cmp(&right.components().count())
                .then_with(|| path_sort_key(left).cmp(&path_sort_key(right)))
        });
        let mut non_overlapping: Vec<PathBuf> = Vec::with_capacity(roots.len());
        for root in roots {
            if non_overlapping
                .iter()
                .any(|existing| same_or_descendant(&root, existing))
            {
                continue;
            }
            non_overlapping.push(root);
        }

        Ok(Self {
            roots: non_overlapping,
            blacklist,
        })
    }

    #[must_use]
    pub fn is_blacklisted(&self, path: &Path) -> bool {
        self.blacklist
            .iter()
            .any(|protected| same_or_descendant(path, protected))
    }
}

pub(crate) fn path_sort_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn normalize_path(path: &Path) -> Result<PathBuf, ScanError> {
    if path.exists() {
        return fs::canonicalize(path).map_err(|source| ScanError::RootIo {
            path: path.to_path_buf(),
            source,
        });
    }

    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .map_err(|source| ScanError::RootIo {
                path: path.to_path_buf(),
                source,
            })?
            .join(path)
    };
    Ok(lexically_normalize(&absolute))
}

fn lexically_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn same_or_descendant(path: &Path, parent: &Path) -> bool {
    if cfg!(windows) {
        let path = path_sort_key(path);
        let parent = path_sort_key(parent)
            .trim_end_matches(['\\', '/'])
            .to_owned();
        return path == parent
            || path
                .strip_prefix(&parent)
                .is_some_and(|remainder| remainder.starts_with(['\\', '/']));
    }
    path == parent || path.starts_with(parent)
}

fn sort_and_deduplicate(paths: &mut Vec<PathBuf>) {
    paths.sort_by_key(|path| path_sort_key(path));
    paths.dedup_by(|left, right| path_sort_key(left) == path_sort_key(right));
}

#[cfg(windows)]
fn default_blacklist() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(path) = env::var_os("SystemRoot") {
        paths.push(PathBuf::from(path));
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
        if let Some(path) = env::var_os(variable) {
            paths.push(PathBuf::from(path));
        }
    }

    if paths.is_empty() {
        paths.extend([
            PathBuf::from(r"C:\Windows"),
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Program Files (x86)"),
            PathBuf::from(r"C:\ProgramData"),
        ]);
    }
    paths
}

#[cfg(not(windows))]
fn default_blacklist() -> Vec<PathBuf> {
    ["/System", "/bin", "/etc", "/sbin", "/usr"]
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::same_or_descendant;

    #[test]
    fn path_boundaries_do_not_use_naive_prefixes() {
        assert!(same_or_descendant(
            Path::new("/safe/child"),
            Path::new("/safe")
        ));
        assert!(!same_or_descendant(
            Path::new("/safe-looking"),
            Path::new("/safe")
        ));
    }
}
