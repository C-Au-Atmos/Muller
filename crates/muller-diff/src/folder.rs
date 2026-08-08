use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use muller_core::{CancellationToken, FileHashError, hash_file_blake3};
use walkdir::WalkDir;

use crate::{
    DiffError, FolderDiffConfig, FolderDiffEntry, FolderDiffIssue, FolderDiffPhase,
    FolderDiffProgress, FolderDiffReport, FolderDiffStats, FolderDiffStatus, FolderEntryKind,
    FolderSide,
};

#[derive(Debug)]
struct CollectedEntry {
    relative_path: PathBuf,
    kind: FolderEntryKind,
    side: FolderSide,
}

pub fn compare_folders(config: &FolderDiffConfig) -> Result<FolderDiffReport, DiffError> {
    compare_folders_cancellable_with_progress(config, &CancellationToken::default(), |_| {})
}

pub fn compare_folders_cancellable_with_progress<F>(
    config: &FolderDiffConfig,
    cancellation: &CancellationToken,
    progress: F,
) -> Result<FolderDiffReport, DiffError>
where
    F: Fn(&FolderDiffProgress),
{
    ensure_running(cancellation)?;
    let left_root = validate_root(&config.left_root)?;
    let right_root = validate_root(&config.right_root)?;
    let mut issues = Vec::new();

    progress(&FolderDiffProgress {
        phase: FolderDiffPhase::Discovering,
        processed: 0,
        total: None,
        bytes_hashed: 0,
    });
    let left = collect_entries(&left_root, cancellation, &mut issues)?;
    let right = collect_entries(&right_root, cancellation, &mut issues)?;
    let keys = left
        .keys()
        .chain(right.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let total = keys.len() as u64;
    let mut stats = FolderDiffStats {
        total_entries: total,
        ..FolderDiffStats::default()
    };
    let mut entries = Vec::with_capacity(keys.len());

    progress(&FolderDiffProgress {
        phase: FolderDiffPhase::Comparing,
        processed: 0,
        total: Some(total),
        bytes_hashed: 0,
    });

    for (index, key) in keys.into_iter().enumerate() {
        ensure_running(cancellation)?;
        let left_entry = left.get(&key);
        let right_entry = right.get(&key);
        let entry = compare_entry(
            left_entry,
            right_entry,
            config.treat_mtime_as_diff,
            cancellation,
            &mut stats,
        )?;
        count_status(entry.status, &mut stats);
        entries.push(entry);

        let processed = index as u64 + 1;
        if processed.is_multiple_of(64) || processed == total {
            progress(&FolderDiffProgress {
                phase: FolderDiffPhase::Comparing,
                processed,
                total: Some(total),
                bytes_hashed: stats.bytes_hashed,
            });
        }
    }

    stats.errors = stats.errors.saturating_add(issues.len() as u64);
    progress(&FolderDiffProgress {
        phase: FolderDiffPhase::Complete,
        processed: total,
        total: Some(total),
        bytes_hashed: stats.bytes_hashed,
    });

    Ok(FolderDiffReport {
        left_root,
        right_root,
        entries,
        issues,
        stats,
    })
}

fn validate_root(requested: &Path) -> Result<PathBuf, DiffError> {
    if !requested.exists() {
        return Err(DiffError::PathNotFound(requested.to_path_buf()));
    }
    let metadata = fs::metadata(requested).map_err(|source| DiffError::Io {
        path: requested.to_path_buf(),
        source,
    })?;
    if !metadata.is_dir() {
        return Err(DiffError::RootNotDirectory(requested.to_path_buf()));
    }
    fs::canonicalize(requested).map_err(|source| DiffError::Io {
        path: requested.to_path_buf(),
        source,
    })
}

fn collect_entries(
    root: &Path,
    cancellation: &CancellationToken,
    issues: &mut Vec<FolderDiffIssue>,
) -> Result<BTreeMap<String, CollectedEntry>, DiffError> {
    let mut entries = BTreeMap::new();
    for result in WalkDir::new(root).follow_links(false).min_depth(1) {
        ensure_running(cancellation)?;
        let directory_entry = match result {
            Ok(entry) => entry,
            Err(error) => {
                issues.push(FolderDiffIssue {
                    path: error.path().unwrap_or(root).to_path_buf(),
                    error: error.to_string(),
                });
                continue;
            }
        };
        let path = directory_entry.path().to_path_buf();
        let metadata = match directory_entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                issues.push(FolderDiffIssue {
                    path,
                    error: error.to_string(),
                });
                continue;
            }
        };
        let relative_path = match directory_entry.path().strip_prefix(root) {
            Ok(relative) => relative.to_path_buf(),
            Err(error) => {
                issues.push(FolderDiffIssue {
                    path,
                    error: error.to_string(),
                });
                continue;
            }
        };
        let kind = if directory_entry.file_type().is_file() {
            FolderEntryKind::File
        } else if directory_entry.file_type().is_dir() {
            FolderEntryKind::Directory
        } else {
            FolderEntryKind::Other
        };
        let key = relative_sort_key(&relative_path);
        entries.insert(
            key,
            CollectedEntry {
                relative_path,
                kind,
                side: FolderSide {
                    path,
                    size: metadata.len(),
                    modified_unix_ms: modified_unix_ms(&metadata),
                },
            },
        );
    }
    Ok(entries)
}

fn compare_entry(
    left: Option<&CollectedEntry>,
    right: Option<&CollectedEntry>,
    treat_mtime_as_diff: bool,
    cancellation: &CancellationToken,
    stats: &mut FolderDiffStats,
) -> Result<FolderDiffEntry, DiffError> {
    let relative_path = left
        .map(|entry| entry.relative_path.clone())
        .or_else(|| right.map(|entry| entry.relative_path.clone()))
        .expect("union key always has a side");
    let kind = left
        .map(|entry| entry.kind)
        .or_else(|| right.map(|entry| entry.kind))
        .expect("union key always has a side");

    let (status, error) = match (left, right) {
        (Some(_), None) => (FolderDiffStatus::LeftOnly, None),
        (None, Some(_)) => (FolderDiffStatus::RightOnly, None),
        (Some(left), Some(right)) if left.kind != right.kind => (FolderDiffStatus::Different, None),
        (Some(left), Some(_right)) if left.kind != FolderEntryKind::File => {
            (FolderDiffStatus::Equal, None)
        }
        (Some(left), Some(right)) if left.side.size != right.side.size => {
            (FolderDiffStatus::Different, None)
        }
        (Some(left), Some(right)) => {
            let left_hash = hash_file_blake3(&left.side.path, cancellation);
            let right_hash = hash_file_blake3(&right.side.path, cancellation);
            match (left_hash, right_hash) {
                (Ok((left_hash, left_bytes)), Ok((right_hash, right_bytes))) => {
                    stats.hashed_files = stats.hashed_files.saturating_add(2);
                    stats.bytes_hashed = stats
                        .bytes_hashed
                        .saturating_add(left_bytes)
                        .saturating_add(right_bytes);
                    if left_hash != right_hash {
                        (FolderDiffStatus::Different, None)
                    } else if left.side.modified_unix_ms != right.side.modified_unix_ms {
                        if treat_mtime_as_diff {
                            (FolderDiffStatus::Different, None)
                        } else {
                            (FolderDiffStatus::MetadataOnly, None)
                        }
                    } else {
                        (FolderDiffStatus::Equal, None)
                    }
                }
                (Err(FileHashError::Cancelled), _) | (_, Err(FileHashError::Cancelled)) => {
                    return Err(DiffError::Cancelled);
                }
                (Err(error), _) => (FolderDiffStatus::Error, Some(error.to_string())),
                (_, Err(error)) => (FolderDiffStatus::Error, Some(error.to_string())),
            }
        }
        (None, None) => unreachable!("union key always has a side"),
    };

    Ok(FolderDiffEntry {
        relative_path,
        kind,
        left: left.map(|entry| entry.side.clone()),
        right: right.map(|entry| entry.side.clone()),
        status,
        error,
    })
}

fn count_status(status: FolderDiffStatus, stats: &mut FolderDiffStats) {
    let counter = match status {
        FolderDiffStatus::LeftOnly => &mut stats.left_only,
        FolderDiffStatus::RightOnly => &mut stats.right_only,
        FolderDiffStatus::Different => &mut stats.different,
        FolderDiffStatus::Equal => &mut stats.equal,
        FolderDiffStatus::MetadataOnly => &mut stats.metadata_only,
        FolderDiffStatus::Error => &mut stats.errors,
    };
    *counter = counter.saturating_add(1);
}

fn relative_sort_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn modified_unix_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn ensure_running(cancellation: &CancellationToken) -> Result<(), DiffError> {
    if cancellation.is_cancelled() {
        Err(DiffError::Cancelled)
    } else {
        Ok(())
    }
}
