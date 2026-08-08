use std::{
    collections::{BTreeMap, HashSet},
    fs::Metadata,
    io,
    path::PathBuf,
    time::UNIX_EPOCH,
};

use rayon::prelude::*;
use walkdir::WalkDir;

use crate::{
    CancellationToken, DuplicateGroup, FileEntry, ProgressEvent, ScanConfig, ScanError, ScanPhase,
    ScanReport, ScanStats, SkippedFile, SkippedStage,
    hashing::{FileHashError, hash_file_blake3, head_tail_fingerprint},
    identity::file_identity,
    path_guard::{GuardedPaths, path_sort_key},
};

#[derive(Debug)]
struct PendingFile {
    entry: FileEntry,
    metadata: Metadata,
}

#[derive(Debug)]
enum HashOutcome {
    Hashed(usize, FileEntry, u64),
    Failed(usize, SkippedFile),
    Cancelled,
}

#[derive(Debug)]
enum FingerprintOutcome {
    Hashed(FileEntry, u64, u64),
    Failed(SkippedFile),
}

pub fn scan(config: &ScanConfig) -> Result<ScanReport, ScanError> {
    scan_cancellable_with_progress(config, &CancellationToken::default(), |_| {})
}

pub fn scan_with_progress<F>(config: &ScanConfig, progress: F) -> Result<ScanReport, ScanError>
where
    F: Fn(&ProgressEvent),
{
    scan_cancellable_with_progress(config, &CancellationToken::default(), progress)
}

pub fn scan_cancellable(
    config: &ScanConfig,
    cancellation: &CancellationToken,
) -> Result<ScanReport, ScanError> {
    scan_cancellable_with_progress(config, cancellation, |_| {})
}

pub fn scan_cancellable_with_progress<F>(
    config: &ScanConfig,
    cancellation: &CancellationToken,
    progress: F,
) -> Result<ScanReport, ScanError>
where
    F: Fn(&ProgressEvent),
{
    scan_cancellable_with_progress_and_groups(config, cancellation, progress, |_| {})
}

pub fn scan_cancellable_with_progress_and_groups<F, G>(
    config: &ScanConfig,
    cancellation: &CancellationToken,
    progress: F,
    group_found: G,
) -> Result<ScanReport, ScanError>
where
    F: Fn(&ProgressEvent),
    G: Fn(&DuplicateGroup),
{
    ensure_running(cancellation)?;
    let guarded = GuardedPaths::validate(config)?;
    let mut stats = ScanStats::default();
    let mut skipped = Vec::new();

    let size_buckets = discover_size_candidates(
        config,
        &guarded,
        &mut stats,
        &mut skipped,
        cancellation,
        &progress,
    )?;
    let head_tail_buckets = fingerprint_candidates(
        config,
        size_buckets,
        &mut stats,
        &mut skipped,
        cancellation,
        &progress,
    )?;
    let mut groups = hash_full_candidates(
        config,
        head_tail_buckets,
        &mut stats,
        &mut skipped,
        cancellation,
        &progress,
        &group_found,
    )?;

    for group in &mut groups {
        group.files.sort_by_key(|entry| path_sort_key(&entry.path));
        group.suggested_keep = suggested_keep(&group.files);
    }
    groups.sort_by(|left, right| {
        right
            .reclaimable_bytes()
            .cmp(&left.reclaimable_bytes())
            .then_with(|| right.size.cmp(&left.size))
            .then_with(|| left.full_hash.cmp(&right.full_hash))
    });
    skipped.sort_by(|left, right| {
        path_sort_key(&left.path)
            .cmp(&path_sort_key(&right.path))
            .then_with(|| (left.stage as u8).cmp(&(right.stage as u8)))
    });

    let reclaimable_bytes = groups.iter().fold(0_u64, |total, group| {
        total.saturating_add(group.reclaimable_bytes())
    });
    progress(&ProgressEvent {
        phase: ScanPhase::Complete,
        processed: stats.files_seen,
        total: Some(stats.files_seen),
        candidate_files: stats.head_tail_candidate_files,
        bytes_read: stats.bytes_read,
    });

    Ok(ScanReport {
        groups,
        skipped,
        stats,
        reclaimable_bytes,
    })
}

fn discover_size_candidates<F>(
    config: &ScanConfig,
    guarded: &GuardedPaths,
    stats: &mut ScanStats,
    skipped: &mut Vec<SkippedFile>,
    cancellation: &CancellationToken,
    progress: &F,
) -> Result<Vec<Vec<FileEntry>>, ScanError>
where
    F: Fn(&ProgressEvent),
{
    let mut buckets: BTreeMap<u64, Vec<PendingFile>> = BTreeMap::new();

    progress(&ProgressEvent {
        phase: ScanPhase::Discovering,
        processed: 0,
        total: None,
        candidate_files: 0,
        bytes_read: stats.bytes_read,
    });

    for root in &guarded.roots {
        ensure_running(cancellation)?;
        let mut blacklisted_under_root = 0_u64;
        let walker = WalkDir::new(root)
            .follow_links(false)
            .min_depth(1)
            .into_iter()
            .filter_entry(|entry| {
                let blocked = guarded.is_blacklisted(entry.path());
                if blocked {
                    blacklisted_under_root = blacklisted_under_root.saturating_add(1);
                }
                !blocked
            });

        for item in walker {
            ensure_running(cancellation)?;
            let directory_entry = match item {
                Ok(entry) => entry,
                Err(error) => {
                    skipped.push(SkippedFile {
                        path: error.path().unwrap_or(root).to_path_buf(),
                        stage: SkippedStage::Walk,
                        error: error.to_string(),
                        locked: false,
                    });
                    continue;
                }
            };

            if directory_entry.file_type().is_symlink() {
                stats.symlinks_skipped = stats.symlinks_skipped.saturating_add(1);
                continue;
            }
            if !directory_entry.file_type().is_file() {
                continue;
            }

            stats.files_seen = stats.files_seen.saturating_add(1);
            if stats
                .files_seen
                .is_multiple_of(config.progress_batch_size() as u64)
            {
                progress(&ProgressEvent {
                    phase: ScanPhase::Discovering,
                    processed: stats.files_seen,
                    total: None,
                    candidate_files: 0,
                    bytes_read: stats.bytes_read,
                });
            }
            let path = directory_entry.path().to_path_buf();
            let metadata = match directory_entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    skipped.push(SkippedFile {
                        path,
                        stage: SkippedStage::Metadata,
                        error: error.to_string(),
                        locked: false,
                    });
                    continue;
                }
            };
            let size = metadata.len();
            if size < config.min_size() {
                stats.files_below_min_size = stats.files_below_min_size.saturating_add(1);
                continue;
            }

            buckets.entry(size).or_default().push(PendingFile {
                entry: FileEntry {
                    path,
                    size,
                    created_unix_ms: created_unix_ms(&metadata),
                    modified_unix_ms: modified_unix_ms(&metadata),
                    head_tail: None,
                    full_hash: None,
                    hard_link_count: 1,
                    locked: false,
                },
                metadata,
            });
        }
        stats.blacklisted_entries_skipped = stats
            .blacklisted_entries_skipped
            .saturating_add(blacklisted_under_root);
    }

    let mut seen_identities = HashSet::new();
    let mut candidate_buckets = Vec::new();
    for (_, mut bucket) in buckets {
        if bucket.len() < 2 {
            stats.unique_size_files = stats.unique_size_files.saturating_add(bucket.len() as u64);
            continue;
        }
        bucket.sort_by_key(|pending| path_sort_key(&pending.entry.path));

        let mut physical_files = Vec::with_capacity(bucket.len());
        for mut pending in bucket {
            match file_identity(&pending.entry.path, &pending.metadata) {
                Ok(identity) => {
                    if seen_identities.insert(identity.identity) {
                        pending.entry.hard_link_count = identity.hard_link_count.max(1);
                        physical_files.push(pending.entry);
                    } else {
                        stats.physical_duplicates_skipped =
                            stats.physical_duplicates_skipped.saturating_add(1);
                    }
                }
                Err(error) => skipped.push(skipped_io(
                    pending.entry.path,
                    SkippedStage::Identity,
                    &error,
                )),
            }
        }

        if physical_files.len() >= 2 {
            stats.size_candidate_files = stats
                .size_candidate_files
                .saturating_add(physical_files.len() as u64);
            candidate_buckets.push(physical_files);
        } else {
            stats.unique_size_files = stats
                .unique_size_files
                .saturating_add(physical_files.len() as u64);
        }
    }

    progress(&ProgressEvent {
        phase: ScanPhase::Discovering,
        processed: stats.files_seen,
        total: Some(stats.files_seen),
        candidate_files: stats.size_candidate_files,
        bytes_read: stats.bytes_read,
    });
    Ok(candidate_buckets)
}

fn fingerprint_candidates<F>(
    config: &ScanConfig,
    size_buckets: Vec<Vec<FileEntry>>,
    stats: &mut ScanStats,
    skipped: &mut Vec<SkippedFile>,
    cancellation: &CancellationToken,
    progress: &F,
) -> Result<Vec<Vec<FileEntry>>, ScanError>
where
    F: Fn(&ProgressEvent),
{
    let total = size_buckets.iter().map(Vec::len).sum::<usize>() as u64;
    let mut processed = 0_u64;
    let mut fingerprints: BTreeMap<(u64, u64), Vec<FileEntry>> = BTreeMap::new();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.fingerprint_threads())
        .thread_name(|index| format!("muller-fingerprint-{index}"))
        .build()?;
    let files = size_buckets.into_iter().flatten().collect::<Vec<_>>();
    let batch_size = config
        .progress_batch_size()
        .max(config.fingerprint_threads().saturating_mul(4));

    progress(&ProgressEvent {
        phase: ScanPhase::Fingerprinting,
        processed,
        total: Some(total),
        candidate_files: total,
        bytes_read: stats.bytes_read,
    });

    for batch in files.chunks(batch_size) {
        ensure_running(cancellation)?;
        let outcomes = pool.install(|| {
            batch
                .par_iter()
                .cloned()
                .map(|mut entry| {
                    if cancellation.is_cancelled() {
                        return FingerprintOutcome::Failed(SkippedFile {
                            path: entry.path,
                            stage: SkippedStage::HeadTail,
                            error: "scan cancelled".to_owned(),
                            locked: false,
                        });
                    }
                    match head_tail_fingerprint(&entry.path, entry.size) {
                        Ok((fingerprint, bytes_read)) => {
                            entry.head_tail = Some(fingerprint);
                            FingerprintOutcome::Hashed(entry, fingerprint, bytes_read)
                        }
                        Err(error) => FingerprintOutcome::Failed(skipped_io(
                            entry.path,
                            SkippedStage::HeadTail,
                            &error,
                        )),
                    }
                })
                .collect::<Vec<_>>()
        });
        ensure_running(cancellation)?;
        for outcome in outcomes {
            match outcome {
                FingerprintOutcome::Hashed(entry, fingerprint, bytes_read) => {
                    stats.bytes_read = stats.bytes_read.saturating_add(bytes_read);
                    fingerprints
                        .entry((entry.size, fingerprint))
                        .or_default()
                        .push(entry);
                }
                FingerprintOutcome::Failed(file) => skipped.push(file),
            }
            processed = processed.saturating_add(1);
        }
        progress(&ProgressEvent {
            phase: ScanPhase::Fingerprinting,
            processed,
            total: Some(total),
            candidate_files: total,
            bytes_read: stats.bytes_read,
        });
    }

    let candidates = fingerprints
        .into_values()
        .filter(|bucket| bucket.len() >= 2)
        .collect::<Vec<_>>();
    stats.head_tail_candidate_files = candidates.iter().map(Vec::len).sum::<usize>() as u64;
    Ok(candidates)
}

fn hash_full_candidates<F, G>(
    config: &ScanConfig,
    head_tail_buckets: Vec<Vec<FileEntry>>,
    stats: &mut ScanStats,
    skipped: &mut Vec<SkippedFile>,
    cancellation: &CancellationToken,
    progress: &F,
    group_found: &G,
) -> Result<Vec<DuplicateGroup>, ScanError>
where
    F: Fn(&ProgressEvent),
    G: Fn(&DuplicateGroup),
{
    let bucket_count = head_tail_buckets.len();
    let mut remaining = head_tail_buckets.iter().map(Vec::len).collect::<Vec<_>>();
    let files = head_tail_buckets
        .into_iter()
        .enumerate()
        .flat_map(|(bucket_index, bucket)| {
            bucket.into_iter().map(move |entry| (bucket_index, entry))
        })
        .collect::<Vec<_>>();
    let total = files.len() as u64;
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.hash_threads())
        .thread_name(|index| format!("muller-hash-{index}"))
        .build()?;
    let batch_size = config
        .progress_batch_size()
        .max(config.hash_threads().saturating_mul(2));
    let mut hashed_groups: BTreeMap<(u64, [u8; 32]), Vec<FileEntry>> = BTreeMap::new();
    let mut bucket_hashes = vec![std::collections::BTreeSet::new(); bucket_count];
    let mut processed = 0_u64;

    progress(&ProgressEvent {
        phase: ScanPhase::FullHashing,
        processed,
        total: Some(total),
        candidate_files: total,
        bytes_read: stats.bytes_read,
    });

    for batch in files.chunks(batch_size) {
        ensure_running(cancellation)?;
        let outcomes = pool.install(|| {
            batch
                .par_iter()
                .cloned()
                .map(|(bucket_index, mut entry)| {
                    match hash_file_blake3(&entry.path, cancellation) {
                    Ok((hash, bytes_read)) if bytes_read == entry.size => {
                        entry.full_hash = Some(hash);
                        HashOutcome::Hashed(bucket_index, entry, bytes_read)
                    }
                    Ok((_, bytes_read)) => HashOutcome::Failed(bucket_index, SkippedFile {
                        path: entry.path,
                        stage: SkippedStage::FullHash,
                        error: format!(
                            "file size changed during hashing: expected {} bytes, read {bytes_read}",
                            entry.size
                        ),
                        locked: false,
                    }),
                    Err(FileHashError::Io(error)) => HashOutcome::Failed(bucket_index, skipped_io(
                        entry.path,
                        SkippedStage::FullHash,
                        &error,
                    )),
                    Err(FileHashError::Cancelled) => HashOutcome::Cancelled,
                }})
                .collect::<Vec<_>>()
        });

        for outcome in outcomes {
            match outcome {
                HashOutcome::Hashed(bucket_index, entry, bytes_read) => {
                    let hash = entry.full_hash.expect("successful hash stores digest");
                    let size = entry.size;
                    stats.fully_hashed_files = stats.fully_hashed_files.saturating_add(1);
                    stats.bytes_read = stats.bytes_read.saturating_add(bytes_read);
                    hashed_groups.entry((size, hash)).or_default().push(entry);
                    bucket_hashes[bucket_index].insert((size, hash));
                    remaining[bucket_index] = remaining[bucket_index].saturating_sub(1);
                }
                HashOutcome::Failed(bucket_index, file) => {
                    skipped.push(file);
                    remaining[bucket_index] = remaining[bucket_index].saturating_sub(1);
                }
                HashOutcome::Cancelled => return Err(ScanError::Cancelled),
            }
            processed = processed.saturating_add(1);
        }

        progress(&ProgressEvent {
            phase: ScanPhase::FullHashing,
            processed,
            total: Some(total),
            candidate_files: total,
            bytes_read: stats.bytes_read,
        });

        for bucket_index in 0..remaining.len() {
            if remaining[bucket_index] != 0 || bucket_hashes[bucket_index].is_empty() {
                continue;
            }
            let keys = std::mem::take(&mut bucket_hashes[bucket_index]);
            for (size, full_hash) in keys {
                let Some(files) = hashed_groups.get(&(size, full_hash)) else {
                    continue;
                };
                if files.len() < 2 {
                    continue;
                }
                let mut files = files.clone();
                files.sort_by_key(|entry| path_sort_key(&entry.path));
                let group = DuplicateGroup {
                    full_hash,
                    size,
                    suggested_keep: suggested_keep(&files),
                    files,
                };
                group_found(&group);
            }
        }
    }

    Ok(hashed_groups
        .into_iter()
        .filter_map(|((size, full_hash), files)| {
            (files.len() >= 2).then_some(DuplicateGroup {
                full_hash,
                size,
                files,
                suggested_keep: 0,
            })
        })
        .collect())
}

fn ensure_running(cancellation: &CancellationToken) -> Result<(), ScanError> {
    if cancellation.is_cancelled() {
        Err(ScanError::Cancelled)
    } else {
        Ok(())
    }
}

fn suggested_keep(files: &[FileEntry]) -> usize {
    files
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            right
                .hard_link_count
                .cmp(&left.hard_link_count)
                .then_with(|| {
                    left.modified_unix_ms
                        .unwrap_or(u64::MAX)
                        .cmp(&right.modified_unix_ms.unwrap_or(u64::MAX))
                })
                .then_with(|| {
                    left.path
                        .components()
                        .count()
                        .cmp(&right.path.components().count())
                })
                .then_with(|| {
                    left.path
                        .as_os_str()
                        .len()
                        .cmp(&right.path.as_os_str().len())
                })
                .then_with(|| path_sort_key(&left.path).cmp(&path_sort_key(&right.path)))
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn modified_unix_ms(metadata: &Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

fn created_unix_ms(metadata: &Metadata) -> Option<u64> {
    metadata
        .created()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

fn skipped_io(path: PathBuf, stage: SkippedStage, error: &io::Error) -> SkippedFile {
    SkippedFile {
        path,
        stage,
        error: error.to_string(),
        locked: is_lock_error(error),
    }
}

fn is_lock_error(error: &io::Error) -> bool {
    if error.kind() == io::ErrorKind::PermissionDenied {
        return true;
    }

    #[cfg(windows)]
    {
        matches!(error.raw_os_error(), Some(5 | 32 | 33))
    }

    #[cfg(not(windows))]
    false
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::FileEntry;

    use super::suggested_keep;

    #[test]
    fn keep_suggestion_is_deterministic() {
        let files = vec![
            entry("deep/path/new.bin", 20),
            entry("old.bin", 10),
            entry("also-old.bin", 10),
        ];
        assert_eq!(suggested_keep(&files), 1);
    }

    fn entry(path: &str, modified: u64) -> FileEntry {
        FileEntry {
            path: PathBuf::from(path),
            size: 1,
            created_unix_ms: Some(modified),
            modified_unix_ms: Some(modified),
            head_tail: None,
            full_hash: None,
            hard_link_count: 1,
            locked: false,
        }
    }
}
