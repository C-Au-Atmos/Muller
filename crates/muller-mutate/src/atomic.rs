use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write as _},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use muller_core::CancellationToken;
use serde::Serialize;

use crate::{
    EditableDocument, FileFingerprint, MutationError, MutationPolicy,
    document::{BackupState, encode_text, normalize_and_capture, restore_line_endings},
    fingerprint_file,
};

static UNIQUE_PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReport {
    pub path: PathBuf,
    pub backup_path: PathBuf,
    pub fingerprint: FileFingerprint,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackReport {
    pub path: PathBuf,
    pub restored_from: PathBuf,
    pub backup_path: PathBuf,
    pub text: String,
    pub fingerprint: FileFingerprint,
}

pub fn save_document(
    document: &mut EditableDocument,
    editor_text: &str,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<SaveReport, MutationError> {
    save_document_with_replacer(document, editor_text, policy, cancellation, &SystemReplacer)
}

pub fn rollback_document(
    document: &mut EditableDocument,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<RollbackReport, MutationError> {
    rollback_document_with_replacer(document, policy, cancellation, &SystemReplacer)
}

fn save_document_with_replacer(
    document: &mut EditableDocument,
    editor_text: &str,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
    replacer: &impl AtomicReplacer,
) -> Result<SaveReport, MutationError> {
    validate_document_target(document, policy, cancellation)?;
    let (persisted_text, separators, line_ending) =
        restore_line_endings(editor_text, &document.separators);
    let bytes = encode_text(&persisted_text, document.encoding)?;
    if bytes.len() as u64 > crate::MAX_EDITABLE_BYTES {
        return Err(MutationError::EditableFileTooLarge {
            path: document.path.clone(),
            limit: crate::MAX_EDITABLE_BYTES,
        });
    }
    let permissions = fs::metadata(&document.path)
        .map_err(|source| io_error(&document.path, source))?
        .permissions();
    let (temporary_path, mut temporary) = create_unique_file(&document.path, "tmp")?;
    let backup_path = unique_unused_path(&document.path, "backup")?;

    let result = (|| {
        temporary
            .write_all(&bytes)
            .and_then(|()| temporary.flush())
            .map_err(|source| io_error(&temporary_path, source))?;
        fs::set_permissions(&temporary_path, permissions)
            .map_err(|source| io_error(&temporary_path, source))?;
        temporary
            .sync_all()
            .map_err(|source| io_error(&temporary_path, source))?;
        drop(temporary);

        validate_document_target(document, policy, cancellation)?;
        if cancellation.is_cancelled() {
            return Err(MutationError::Cancelled);
        }
        replacer
            .replace(&document.path, &temporary_path, &backup_path)
            .map_err(|source| MutationError::Replace {
                path: document.path.clone(),
                source,
            })?;

        let committed = CancellationToken::default();
        let fingerprint = fingerprint_file(&document.path, &committed)?;
        let backup_fingerprint = fingerprint_file(&backup_path, &committed)?;
        let previous_backup = document.backup.replace(BackupState {
            path: backup_path.clone(),
            fingerprint: backup_fingerprint,
        });
        if let Some(previous) = previous_backup {
            let _ = fs::remove_file(previous.path);
        }
        document.text = normalize_and_capture(editor_text).0;
        document.separators = separators;
        document.line_ending = line_ending;
        document.fingerprint = fingerprint.clone();
        Ok(SaveReport {
            path: document.path.clone(),
            backup_path: backup_path.clone(),
            fingerprint,
        })
    })();

    if temporary_path.exists() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

fn rollback_document_with_replacer(
    document: &mut EditableDocument,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
    replacer: &impl AtomicReplacer,
) -> Result<RollbackReport, MutationError> {
    validate_document_target(document, policy, cancellation)?;
    let backup = document
        .backup
        .clone()
        .ok_or_else(|| MutationError::BackupNotFound(document.path.clone()))?;
    if !backup.path.is_file() {
        return Err(MutationError::BackupNotFound(backup.path));
    }
    let current_backup = fingerprint_file(&backup.path, cancellation)?;
    if current_backup != backup.fingerprint {
        return Err(MutationError::ExternalChange(backup.path));
    }
    let decoded_backup = muller_diff::decode_text_file(&backup.path, cancellation)?;
    let (restored_text, restored_separators) = normalize_and_capture(&decoded_backup.text);
    let replacement_backup = unique_unused_path(&document.path, "rollback")?;
    if cancellation.is_cancelled() {
        return Err(MutationError::Cancelled);
    }
    replacer
        .replace(&document.path, &backup.path, &replacement_backup)
        .map_err(|source| MutationError::Replace {
            path: document.path.clone(),
            source,
        })?;

    let committed = CancellationToken::default();
    let fingerprint = fingerprint_file(&document.path, &committed)?;
    let replacement_fingerprint = fingerprint_file(&replacement_backup, &committed)?;
    document.text = restored_text.clone();
    document.encoding = decoded_backup.encoding;
    document.line_ending = decoded_backup.line_ending;
    document.separators = restored_separators;
    document.fingerprint = fingerprint.clone();
    document.backup = Some(BackupState {
        path: replacement_backup.clone(),
        fingerprint: replacement_fingerprint,
    });
    Ok(RollbackReport {
        path: document.path.clone(),
        restored_from: backup.path,
        backup_path: replacement_backup,
        text: restored_text,
        fingerprint,
    })
}

fn validate_document_target(
    document: &EditableDocument,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<(), MutationError> {
    let validated = policy.validate_file(&document.path)?;
    if validated != document.path {
        return Err(MutationError::ExternalChange(document.path.clone()));
    }
    let current = fingerprint_file(&document.path, cancellation)?;
    if current != document.fingerprint {
        return Err(MutationError::ExternalChange(document.path.clone()));
    }
    Ok(())
}

fn create_unique_file(target: &Path, purpose: &str) -> Result<(PathBuf, File), MutationError> {
    for _ in 0..128 {
        let path = candidate_path(target, purpose);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(source) => return Err(io_error(&path, source)),
        }
    }
    Err(MutationError::TemporaryPathExhausted(target.to_path_buf()))
}

fn unique_unused_path(target: &Path, purpose: &str) -> Result<PathBuf, MutationError> {
    (0..128)
        .map(|_| candidate_path(target, purpose))
        .find(|path| !path.exists())
        .ok_or_else(|| MutationError::TemporaryPathExhausted(target.to_path_buf()))
}

fn candidate_path(target: &Path, purpose: &str) -> PathBuf {
    let counter = UNIQUE_PATH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = target
        .file_name()
        .map_or_else(|| "file".into(), |name| name.to_string_lossy());
    target.with_file_name(format!(
        ".{name}.muller-{purpose}-{}-{counter}",
        std::process::id()
    ))
}

fn io_error(path: &Path, source: io::Error) -> MutationError {
    MutationError::Io {
        path: path.to_path_buf(),
        source,
    }
}

trait AtomicReplacer {
    fn replace(&self, target: &Path, replacement: &Path, backup: &Path) -> io::Result<()>;
}

struct SystemReplacer;

#[cfg(windows)]
impl AtomicReplacer for SystemReplacer {
    fn replace(&self, target: &Path, replacement: &Path, backup: &Path) -> io::Result<()> {
        use std::os::windows::ffi::OsStrExt as _;
        use windows_sys::Win32::{
            Foundation::GetLastError,
            Storage::FileSystem::{REPLACEFILE_WRITE_THROUGH, ReplaceFileW},
        };

        let wide = |path: &Path| {
            path.as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>()
        };
        let target = wide(target);
        let replacement = wide(replacement);
        let backup = wide(backup);
        // SAFETY: all pointers reference NUL-terminated buffers that remain alive for the call.
        let result = unsafe {
            ReplaceFileW(
                target.as_ptr(),
                replacement.as_ptr(),
                backup.as_ptr(),
                REPLACEFILE_WRITE_THROUGH,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if result == 0 {
            // SAFETY: GetLastError has no preconditions.
            Err(io::Error::from_raw_os_error(
                unsafe { GetLastError() } as i32
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(not(windows))]
impl AtomicReplacer for SystemReplacer {
    fn replace(&self, target: &Path, replacement: &Path, backup: &Path) -> io::Result<()> {
        let permissions = fs::metadata(target)?.permissions();
        fs::copy(target, backup)?;
        fs::set_permissions(backup, permissions)?;
        File::open(backup)?.sync_all()?;
        if let Err(error) = fs::rename(replacement, target) {
            let _ = fs::remove_file(backup);
            return Err(error);
        }
        sync_parent(target)
    }
}

#[cfg(not(windows))]
fn sync_parent(path: &Path) -> io::Result<()> {
    File::open(path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()
}

#[cfg(test)]
mod tests {
    use std::{fs, io};

    use muller_core::CancellationToken;
    use tempfile::tempdir;

    use super::{AtomicReplacer, save_document_with_replacer};
    use crate::{MutationPolicy, open_document};

    struct FailingReplacer;

    impl AtomicReplacer for FailingReplacer {
        fn replace(
            &self,
            _target: &std::path::Path,
            _replacement: &std::path::Path,
            _backup: &std::path::Path,
        ) -> io::Result<()> {
            Err(io::Error::other("injected replacement failure"))
        }
    }

    #[test]
    fn replacement_failure_leaves_the_original_intact() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("document.txt");
        fs::write(&path, "original\r\n").expect("write fixture");
        let cancellation = CancellationToken::default();
        let policy = MutationPolicy::default();
        let mut document =
            open_document(&path, &policy, &cancellation).expect("open edit document");

        let error = save_document_with_replacer(
            &mut document,
            "changed\n",
            &policy,
            &cancellation,
            &FailingReplacer,
        )
        .expect_err("replacement should fail");

        assert!(error.to_string().contains("injected replacement failure"));
        assert_eq!(fs::read(&path).expect("read target"), b"original\r\n");
        assert_eq!(
            fs::read_dir(directory.path())
                .expect("read directory")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains("muller-tmp"))
                .count(),
            0
        );
    }
}
