use std::{
    ffi::OsStr,
    fs::{self, OpenOptions},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::UNIX_EPOCH,
};

use muller_core::CancellationToken;
use serde::{Deserialize, Serialize};

use crate::{
    MutationError, MutationPolicy, Recycler, SystemRecycler, fingerprint_file, parse_hash_hex,
};

static OPERATION_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStrategy {
    Fail,
    Skip,
    KeepBoth,
    Replace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferMode {
    Copy,
    Move,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferOutcome {
    Copied,
    Moved,
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferReport {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub outcome: TransferOutcome,
    pub replaced: bool,
    pub warning: Option<String>,
    pub source_retained: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryExpectation {
    pub path: PathBuf,
    pub kind: EntryKind,
    pub size: u64,
    pub modified_unix_ms: Option<u64>,
    #[serde(default)]
    pub expected_blake3: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SnapshotEntry {
    relative: PathBuf,
    kind: EntryKind,
    size: u64,
    modified_unix_ms: Option<u64>,
}

pub fn transfer_entry(
    source: &Path,
    destination_directory: &Path,
    mode: TransferMode,
    conflict: ConflictStrategy,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<TransferReport, MutationError> {
    transfer_entry_with_recycler_named(
        source,
        TransferDestination {
            directory: destination_directory,
            name: None,
        },
        mode,
        conflict,
        policy,
        cancellation,
        &SystemRecycler,
    )
}

pub fn transfer_entry_as(
    source: &Path,
    destination_directory: &Path,
    destination_name: &str,
    mode: TransferMode,
    conflict: ConflictStrategy,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<TransferReport, MutationError> {
    validate_name(destination_name)?;
    transfer_entry_with_recycler_named(
        source,
        TransferDestination {
            directory: destination_directory,
            name: Some(OsStr::new(destination_name)),
        },
        mode,
        conflict,
        policy,
        cancellation,
        &SystemRecycler,
    )
}

struct TransferDestination<'a> {
    directory: &'a Path,
    name: Option<&'a OsStr>,
}

#[cfg(test)]
fn transfer_entry_with_recycler(
    source: &Path,
    destination_directory: &Path,
    mode: TransferMode,
    conflict: ConflictStrategy,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
    recycler: &impl Recycler,
) -> Result<TransferReport, MutationError> {
    transfer_entry_with_recycler_named(
        source,
        TransferDestination {
            directory: destination_directory,
            name: None,
        },
        mode,
        conflict,
        policy,
        cancellation,
        recycler,
    )
}

fn transfer_entry_with_recycler_named(
    source: &Path,
    destination: TransferDestination<'_>,
    mode: TransferMode,
    conflict: ConflictStrategy,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
    recycler: &impl Recycler,
) -> Result<TransferReport, MutationError> {
    let source = policy.validate_entry(source)?;
    let destination_directory = policy.validate_directory(destination.directory)?;
    let source_name = source
        .file_name()
        .ok_or_else(|| operation_error(&source, "cannot transfer a filesystem root"))?;
    let requested_name = destination.name.unwrap_or(source_name);
    let requested_destination = destination_directory.join(requested_name);
    if source.is_dir() && path_is_same_or_descendant(&destination_directory, &source) {
        return Err(operation_error(
            &source,
            "cannot copy or move a directory into itself",
        ));
    }
    if mode == TransferMode::Move && same_path(&source, &requested_destination) {
        return Ok(skipped_report(source.clone(), source));
    }

    let snapshot = snapshot_tree(&source, policy, cancellation)?;
    let (destination, replaced) =
        resolve_destination(&source, requested_destination, conflict, policy)?;
    if destination == source {
        return Ok(skipped_report(source.clone(), source));
    }
    if mode == TransferMode::Move {
        match try_direct_move(&source, &destination, replaced) {
            Ok(warning) => {
                return Ok(TransferReport {
                    source,
                    destination,
                    outcome: TransferOutcome::Moved,
                    replaced,
                    warning,
                    source_retained: false,
                });
            }
            Err(error) if is_cross_device(&error) => {}
            Err(source_error) => {
                return Err(MutationError::Operation {
                    path: source,
                    message: source_error.to_string(),
                });
            }
        }
    }

    let staged = unique_sibling(&destination_directory, "stage")?;
    if let Err(error) = copy_snapshot(&source, &staged, &snapshot, policy, cancellation) {
        remove_generated_path(&staged);
        return Err(error);
    }
    if cancellation.is_cancelled() {
        remove_generated_path(&staged);
        return Err(MutationError::Cancelled);
    }
    let mut warning = commit_staged(&staged, &destination, replaced)?;

    let mut source_retained = mode == TransferMode::Copy;
    if mode == TransferMode::Move
        && let Err(message) = recycler.recycle(&source)
    {
        source_retained = true;
        warning = Some(format!(
            "destination was verified, but the source could not be recycled: {message}"
        ));
    }
    Ok(TransferReport {
        source,
        destination,
        outcome: if mode == TransferMode::Copy {
            TransferOutcome::Copied
        } else {
            TransferOutcome::Moved
        },
        replaced,
        warning,
        source_retained,
    })
}

pub fn rename_entry(
    source: &Path,
    new_name: &str,
    conflict: ConflictStrategy,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<TransferReport, MutationError> {
    validate_name(new_name)?;
    let source = policy.validate_entry(source)?;
    let parent = source
        .parent()
        .ok_or_else(|| operation_error(&source, "cannot rename a filesystem root"))?;
    let parent = policy.validate_directory(parent)?;
    let destination = parent.join(new_name);
    if same_path(&source, &destination) {
        if source.file_name() != Some(OsStr::new(new_name)) {
            let _snapshot = snapshot_tree(&source, policy, cancellation)?;
            let temporary = unique_sibling(&parent, "case-rename")?;
            fs::rename(&source, &temporary).map_err(|error| MutationError::Operation {
                path: source.clone(),
                message: error.to_string(),
            })?;
            if let Err(error) = fs::rename(&temporary, &destination) {
                let _ = fs::rename(&temporary, &source);
                return Err(MutationError::Operation {
                    path: source,
                    message: error.to_string(),
                });
            }
            return Ok(TransferReport {
                source,
                destination,
                outcome: TransferOutcome::Moved,
                replaced: false,
                warning: None,
                source_retained: false,
            });
        }
        return Ok(TransferReport {
            source: source.clone(),
            destination: source,
            outcome: TransferOutcome::Skipped,
            replaced: false,
            warning: None,
            source_retained: true,
        });
    }
    let _snapshot = snapshot_tree(&source, policy, cancellation)?;
    let (destination, replaced) = resolve_destination(&source, destination, conflict, policy)?;
    if destination == source {
        return Ok(skipped_report(source, destination));
    }
    if cancellation.is_cancelled() {
        return Err(MutationError::Cancelled);
    }
    let warning = commit_direct_move(&source, &destination, replaced)?;
    Ok(TransferReport {
        source,
        destination,
        outcome: TransferOutcome::Moved,
        replaced,
        warning,
        source_retained: false,
    })
}

pub fn recycle_entry(
    expectation: &EntryExpectation,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<PathBuf, MutationError> {
    recycle_entry_with(expectation, policy, cancellation, &SystemRecycler)
}

fn recycle_entry_with(
    expectation: &EntryExpectation,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
    recycler: &impl Recycler,
) -> Result<PathBuf, MutationError> {
    let path = policy.validate_entry(&expectation.path)?;
    let metadata = fs::metadata(&path).map_err(|source| io_error(&path, source))?;
    let actual_kind = if metadata.is_file() {
        EntryKind::File
    } else if metadata.is_dir() {
        EntryKind::Directory
    } else {
        return Err(MutationError::NotFileOrDirectory(path));
    };
    if actual_kind != expectation.kind
        || metadata.len() != expectation.size
        || modified_unix_ms(&metadata) != expectation.modified_unix_ms
    {
        return Err(MutationError::ExternalChange(path));
    }
    if let Some(expected) = &expectation.expected_blake3
        && (actual_kind != EntryKind::File
            || fingerprint_file(&path, cancellation)?.blake3 != parse_hash_hex(expected)?)
    {
        return Err(MutationError::ExternalChange(path));
    }
    if cancellation.is_cancelled() {
        return Err(MutationError::Cancelled);
    }
    recycler
        .recycle(&path)
        .map_err(|message| MutationError::Recycle {
            path: path.clone(),
            message,
        })?;
    Ok(path)
}

fn snapshot_tree(
    source: &Path,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<Vec<SnapshotEntry>, MutationError> {
    let mut snapshot = Vec::new();
    collect_snapshot(source, source, policy, cancellation, &mut snapshot)?;
    snapshot.sort_by(|left, right| left.relative.cmp(&right.relative));
    Ok(snapshot)
}

fn collect_snapshot(
    root: &Path,
    path: &Path,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
    snapshot: &mut Vec<SnapshotEntry>,
) -> Result<(), MutationError> {
    if cancellation.is_cancelled() {
        return Err(MutationError::Cancelled);
    }
    let path = policy.validate_entry(path)?;
    let metadata = fs::metadata(&path).map_err(|source| io_error(&path, source))?;
    let kind = if metadata.is_file() {
        EntryKind::File
    } else if metadata.is_dir() {
        EntryKind::Directory
    } else {
        return Err(MutationError::NotFileOrDirectory(path));
    };
    let relative = path
        .strip_prefix(root)
        .map_or_else(|_| PathBuf::new(), Path::to_path_buf);
    snapshot.push(SnapshotEntry {
        relative,
        kind,
        size: metadata.len(),
        modified_unix_ms: modified_unix_ms(&metadata),
    });
    if kind == EntryKind::Directory {
        let entries = fs::read_dir(&path).map_err(|source| io_error(&path, source))?;
        for entry in entries {
            let entry = entry.map_err(|source| io_error(&path, source))?;
            collect_snapshot(root, &entry.path(), policy, cancellation, snapshot)?;
        }
    }
    Ok(())
}

fn copy_snapshot(
    source: &Path,
    staged: &Path,
    snapshot: &[SnapshotEntry],
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<(), MutationError> {
    let root = snapshot
        .first()
        .ok_or_else(|| operation_error(source, "source snapshot is empty"))?;
    if root.kind == EntryKind::Directory {
        fs::create_dir(staged).map_err(|source| io_error(staged, source))?;
    } else {
        copy_verified_file(source, staged, root, cancellation)?;
    }
    for entry in snapshot.iter().skip(1) {
        if cancellation.is_cancelled() {
            return Err(MutationError::Cancelled);
        }
        let source_path = source.join(&entry.relative);
        let target_path = staged.join(&entry.relative);
        policy.validate_entry(&source_path)?;
        if entry.kind == EntryKind::Directory {
            fs::create_dir(&target_path).map_err(|source| io_error(&target_path, source))?;
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
            }
            copy_verified_file(&source_path, &target_path, entry, cancellation)?;
        }
    }
    if root.kind == EntryKind::Directory {
        for entry in snapshot.iter().rev() {
            if entry.kind != EntryKind::Directory {
                continue;
            }
            let source_path = source.join(&entry.relative);
            let target_path = staged.join(&entry.relative);
            let permissions = fs::metadata(&source_path)
                .map_err(|source| io_error(&source_path, source))?
                .permissions();
            fs::set_permissions(&target_path, permissions)
                .map_err(|source| io_error(&target_path, source))?;
        }
    }
    let after = snapshot_tree(source, policy, cancellation)?;
    if after != snapshot {
        return Err(MutationError::ExternalChange(source.to_path_buf()));
    }
    Ok(())
}

fn copy_verified_file(
    source: &Path,
    target: &Path,
    expected: &SnapshotEntry,
    cancellation: &CancellationToken,
) -> Result<(), MutationError> {
    let before = fs::metadata(source).map_err(|source_error| io_error(source, source_error))?;
    if before.len() != expected.size || modified_unix_ms(&before) != expected.modified_unix_ms {
        return Err(MutationError::ExternalChange(source.to_path_buf()));
    }
    fs::copy(source, target).map_err(|source_error| io_error(target, source_error))?;
    OpenOptions::new()
        .write(true)
        .open(target)
        .and_then(|file| file.sync_all())
        .map_err(|source_error| io_error(target, source_error))?;
    let source_fingerprint = fingerprint_file(source, cancellation)?;
    let target_fingerprint = fingerprint_file(target, cancellation)?;
    if source_fingerprint.blake3 != target_fingerprint.blake3
        || source_fingerprint.size != target_fingerprint.size
    {
        return Err(operation_error(
            target,
            "copied content failed BLAKE3 verification",
        ));
    }
    Ok(())
}

fn resolve_destination(
    source: &Path,
    requested: PathBuf,
    conflict: ConflictStrategy,
    policy: &MutationPolicy,
) -> Result<(PathBuf, bool), MutationError> {
    if !requested.exists() {
        return Ok((requested, false));
    }
    if same_path(source, &requested) {
        return match conflict {
            ConflictStrategy::KeepBoth => Ok((keep_both_path(&requested)?, false)),
            ConflictStrategy::Skip => Ok((source.to_path_buf(), false)),
            ConflictStrategy::Fail | ConflictStrategy::Replace => {
                Err(MutationError::DestinationConflict(requested))
            }
        };
    }
    policy.validate_entry(&requested)?;
    match conflict {
        ConflictStrategy::Fail => Err(MutationError::DestinationConflict(requested)),
        ConflictStrategy::Skip => Ok((source.to_path_buf(), false)),
        ConflictStrategy::KeepBoth => Ok((keep_both_path(&requested)?, false)),
        ConflictStrategy::Replace => Ok((requested, true)),
    }
}

fn try_direct_move(
    source: &Path,
    destination: &Path,
    replaced: bool,
) -> std::io::Result<Option<String>> {
    if replaced {
        let backup = unique_sibling(
            destination.parent().unwrap_or_else(|| Path::new(".")),
            "replace",
        )
        .map_err(std::io::Error::other)?;
        fs::rename(destination, &backup)?;
        match fs::rename(source, destination) {
            Ok(()) => {
                let warning = remove_generated_path_with_warning(&backup);
                Ok(warning)
            }
            Err(error) => {
                let _ = fs::rename(&backup, destination);
                Err(error)
            }
        }
    } else {
        fs::rename(source, destination).map(|()| None)
    }
}

fn commit_direct_move(
    source: &Path,
    destination: &Path,
    replaced: bool,
) -> Result<Option<String>, MutationError> {
    try_direct_move(source, destination, replaced).map_err(|error| MutationError::Operation {
        path: source.to_path_buf(),
        message: error.to_string(),
    })
}

fn commit_staged(
    staged: &Path,
    destination: &Path,
    replaced: bool,
) -> Result<Option<String>, MutationError> {
    if !replaced {
        fs::rename(staged, destination).map_err(|source| MutationError::Operation {
            path: destination.to_path_buf(),
            message: source.to_string(),
        })?;
        return Ok(None);
    }
    let backup = unique_sibling(
        destination.parent().unwrap_or_else(|| Path::new(".")),
        "replace",
    )?;
    fs::rename(destination, &backup).map_err(|source| io_error(destination, source))?;
    if let Err(error) = fs::rename(staged, destination) {
        let _ = fs::rename(&backup, destination);
        return Err(MutationError::Operation {
            path: destination.to_path_buf(),
            message: error.to_string(),
        });
    }
    Ok(remove_generated_path_with_warning(&backup))
}

fn keep_both_path(requested: &Path) -> Result<PathBuf, MutationError> {
    let parent = requested
        .parent()
        .ok_or_else(|| operation_error(requested, "destination has no parent"))?;
    let stem = requested
        .file_stem()
        .unwrap_or_else(|| requested.file_name().unwrap_or_else(|| OsStr::new("item")))
        .to_string_lossy();
    let extension = requested.extension().map(|value| value.to_string_lossy());
    for index in 1..=10_000_u32 {
        let suffix = if index == 1 {
            " - Copy".to_owned()
        } else {
            format!(" - Copy ({index})")
        };
        let name = extension.as_ref().map_or_else(
            || format!("{stem}{suffix}"),
            |extension| format!("{stem}{suffix}.{extension}"),
        );
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(operation_error(
        requested,
        "cannot generate a non-conflicting destination name",
    ))
}

fn unique_sibling(parent: &Path, purpose: &str) -> Result<PathBuf, MutationError> {
    for _ in 0..128 {
        let counter = OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(
            ".muller-{purpose}-{}-{counter}",
            std::process::id()
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(MutationError::TemporaryPathExhausted(parent.to_path_buf()))
}

fn validate_name(name: &str) -> Result<(), MutationError> {
    let path = Path::new(name);
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('\0')
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
    {
        return Err(MutationError::InvalidName(name.to_owned()));
    }
    #[cfg(windows)]
    {
        if name.contains(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
            || name.ends_with(['.', ' '])
        {
            return Err(MutationError::InvalidName(name.to_owned()));
        }
        let stem = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_uppercase();
        if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.as_bytes()[3].is_ascii_digit()
                && stem.as_bytes()[3] != b'0')
        {
            return Err(MutationError::InvalidName(name.to_owned()));
        }
    }
    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = path_key(left);
    let right = path_key(right);
    left == right
}

fn path_is_same_or_descendant(path: &Path, parent: &Path) -> bool {
    if cfg!(windows) {
        let path = path_key(path);
        let parent = path_key(parent).trim_end_matches(['\\', '/']).to_owned();
        path == parent
            || path
                .strip_prefix(&parent)
                .is_some_and(|rest| rest.starts_with(['\\', '/']))
    } else {
        path == parent || path.starts_with(parent)
    }
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn is_cross_device(error: &std::io::Error) -> bool {
    #[cfg(windows)]
    {
        error.raw_os_error() == Some(17)
    }
    #[cfg(unix)]
    {
        error.raw_os_error() == Some(18)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = error;
        false
    }
}

fn remove_generated_path(path: &Path) {
    let _ = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
}

fn remove_generated_path_with_warning(path: &Path) -> Option<String> {
    let result = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result
        .err()
        .map(|error| format!("replacement backup remains at {}: {error}", path.display()))
}

fn modified_unix_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn skipped_report(source: PathBuf, destination: PathBuf) -> TransferReport {
    TransferReport {
        source,
        destination,
        outcome: TransferOutcome::Skipped,
        replaced: false,
        warning: None,
        source_retained: true,
    }
}

fn io_error(path: &Path, source: std::io::Error) -> MutationError {
    MutationError::Io {
        path: path.to_path_buf(),
        source,
    }
}

fn operation_error(path: &Path, message: &str) -> MutationError {
    MutationError::Operation {
        path: path.to_path_buf(),
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, sync::Mutex};

    use muller_core::CancellationToken;
    use tempfile::tempdir;

    use super::{
        ConflictStrategy, EntryExpectation, EntryKind, TransferMode, TransferOutcome,
        recycle_entry_with, rename_entry, transfer_entry_with_recycler,
    };
    use crate::{MutationPolicy, Recycler};

    #[derive(Default)]
    struct FakeRecycler {
        paths: Mutex<Vec<std::path::PathBuf>>,
    }

    impl Recycler for FakeRecycler {
        fn recycle(&self, path: &Path) -> Result<(), String> {
            self.paths.lock().expect("recycler lock").push(path.into());
            Ok(())
        }
    }

    #[test]
    fn copies_and_verifies_a_directory_tree() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("source");
        let destination = fixture.path().join("destination");
        fs::create_dir_all(source.join("nested")).expect("source directories");
        fs::create_dir(&destination).expect("destination directory");
        fs::write(source.join("nested/file.txt"), "verified contents").expect("source file");

        let report = transfer_entry_with_recycler(
            &source,
            &destination,
            TransferMode::Copy,
            ConflictStrategy::Fail,
            &MutationPolicy::default(),
            &CancellationToken::default(),
            &FakeRecycler::default(),
        )
        .expect("copy tree");

        assert_eq!(report.outcome, TransferOutcome::Copied);
        assert_eq!(
            fs::read_to_string(destination.join("source/nested/file.txt")).expect("copied file"),
            "verified contents"
        );
        assert!(source.is_dir());
    }

    #[test]
    fn keep_both_generates_a_non_conflicting_name() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("item.txt");
        let destination = fixture.path().join("destination");
        fs::create_dir(&destination).expect("destination directory");
        fs::write(&source, "new").expect("source file");
        fs::write(destination.join("item.txt"), "existing").expect("existing file");

        let report = transfer_entry_with_recycler(
            &source,
            &destination,
            TransferMode::Copy,
            ConflictStrategy::KeepBoth,
            &MutationPolicy::default(),
            &CancellationToken::default(),
            &FakeRecycler::default(),
        )
        .expect("keep both copy");

        assert_eq!(report.destination.file_name().unwrap(), "item - Copy.txt");
        assert_eq!(fs::read_to_string(report.destination).expect("copy"), "new");
        assert_eq!(
            fs::read_to_string(destination.join("item.txt")).expect("existing"),
            "existing"
        );
    }

    #[test]
    fn same_volume_move_and_rename_do_not_call_recycler() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("move.txt");
        let destination = fixture.path().join("destination");
        fs::create_dir(&destination).expect("destination directory");
        fs::write(&source, "move me").expect("source file");
        let recycler = FakeRecycler::default();
        let report = transfer_entry_with_recycler(
            &source,
            &destination,
            TransferMode::Move,
            ConflictStrategy::Fail,
            &MutationPolicy::default(),
            &CancellationToken::default(),
            &recycler,
        )
        .expect("move file");
        let renamed = rename_entry(
            &report.destination,
            "renamed.txt",
            ConflictStrategy::Fail,
            &MutationPolicy::default(),
            &CancellationToken::default(),
        )
        .expect("rename file");

        assert_eq!(
            fs::read_to_string(renamed.destination).expect("renamed"),
            "move me"
        );
        assert!(recycler.paths.lock().expect("recycler lock").is_empty());
    }

    #[test]
    fn recycle_validates_the_entry_snapshot_before_calling_adapter() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("recycle.txt");
        fs::write(&path, "original").expect("source file");
        let metadata = fs::metadata(&path).expect("metadata");
        let recycler = FakeRecycler::default();
        let mut expectation = EntryExpectation {
            path: path.clone(),
            kind: EntryKind::File,
            size: metadata.len(),
            modified_unix_ms: super::modified_unix_ms(&metadata),
            expected_blake3: None,
        };
        fs::write(&path, "externally changed").expect("external change");

        recycle_entry_with(
            &expectation,
            &MutationPolicy::default(),
            &CancellationToken::default(),
            &recycler,
        )
        .expect_err("changed entry should fail");
        assert!(recycler.paths.lock().expect("recycler lock").is_empty());

        let metadata = fs::metadata(&path).expect("new metadata");
        expectation.size = metadata.len();
        expectation.modified_unix_ms = super::modified_unix_ms(&metadata);
        recycle_entry_with(
            &expectation,
            &MutationPolicy::default(),
            &CancellationToken::default(),
            &recycler,
        )
        .expect("matching entry");
        assert_eq!(recycler.paths.lock().expect("recycler lock").len(), 1);
    }

    #[test]
    fn replace_conflict_commits_verified_copy_and_cleans_backup() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("item.txt");
        let destination = fixture.path().join("destination");
        fs::create_dir(&destination).expect("destination directory");
        fs::write(&source, "replacement").expect("source file");
        fs::write(destination.join("item.txt"), "old destination").expect("old file");

        let report = transfer_entry_with_recycler(
            &source,
            &destination,
            TransferMode::Copy,
            ConflictStrategy::Replace,
            &MutationPolicy::default(),
            &CancellationToken::default(),
            &FakeRecycler::default(),
        )
        .expect("replace copy");

        assert!(report.replaced);
        assert_eq!(
            fs::read_to_string(destination.join("item.txt")).expect("replacement"),
            "replacement"
        );
        assert_eq!(
            fs::read_dir(&destination)
                .expect("destination entries")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().starts_with(".muller-"))
                .count(),
            0
        );
    }

    #[test]
    fn rejects_copying_a_directory_into_itself() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("source");
        let nested = source.join("nested");
        fs::create_dir_all(&nested).expect("source tree");

        let error = transfer_entry_with_recycler(
            &source,
            &nested,
            TransferMode::Copy,
            ConflictStrategy::KeepBoth,
            &MutationPolicy::default(),
            &CancellationToken::default(),
            &FakeRecycler::default(),
        )
        .expect_err("recursive self copy should fail");

        assert!(error.to_string().contains("into itself"));
    }

    #[test]
    fn rejects_rename_names_with_path_components() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("item.txt");
        fs::write(&source, "item").expect("source file");

        let error = rename_entry(
            &source,
            "nested/item.txt",
            ConflictStrategy::Fail,
            &MutationPolicy::default(),
            &CancellationToken::default(),
        )
        .expect_err("path components should fail");

        assert!(error.to_string().contains("invalid file name"));
        assert!(source.is_file());
    }

    #[test]
    fn cancellation_leaves_no_destination_or_staging_entry() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("source");
        let destination = fixture.path().join("destination");
        fs::create_dir(&source).expect("source directory");
        fs::create_dir(&destination).expect("destination directory");
        fs::write(source.join("file.txt"), "content").expect("source file");
        let cancellation = CancellationToken::default();
        cancellation.cancel();

        transfer_entry_with_recycler(
            &source,
            &destination,
            TransferMode::Copy,
            ConflictStrategy::Fail,
            &MutationPolicy::default(),
            &cancellation,
            &FakeRecycler::default(),
        )
        .expect_err("cancelled copy should fail");

        assert!(!destination.join("source").exists());
        assert_eq!(
            fs::read_dir(&destination)
                .expect("destination entries")
                .filter_map(Result::ok)
                .count(),
            0
        );
    }

    #[cfg(windows)]
    #[test]
    fn supports_case_only_rename_on_windows() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("report.txt");
        fs::write(&source, "report").expect("source file");

        let report = rename_entry(
            &source,
            "Report.txt",
            ConflictStrategy::Fail,
            &MutationPolicy::default(),
            &CancellationToken::default(),
        )
        .expect("case-only rename");

        assert_eq!(report.destination.file_name().unwrap(), "Report.txt");
        assert_eq!(
            fs::read_to_string(report.destination).expect("renamed file"),
            "report"
        );
    }
}
