use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use muller_core::CancellationToken;
use serde::{Deserialize, Serialize};

use crate::{MutationError, MutationPolicy, fingerprint_file, parse_hash_hex};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecycleCandidate {
    pub path: PathBuf,
    pub expected_size: u64,
    pub expected_blake3: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleFailure {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleReport {
    pub recycled: Vec<PathBuf>,
    pub failures: Vec<RecycleFailure>,
}

pub trait Recycler: Send + Sync {
    fn recycle(&self, path: &Path) -> Result<(), String>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemRecycler;

impl Recycler for SystemRecycler {
    fn recycle(&self, path: &Path) -> Result<(), String> {
        trash::delete(path).map_err(|error| error.to_string())
    }
}

pub fn recycle_candidates(
    candidates: &[RecycleCandidate],
    policy: &MutationPolicy,
    recycler: &impl Recycler,
    cancellation: &CancellationToken,
) -> Result<RecycleReport, MutationError> {
    let mut preflighted = Vec::with_capacity(candidates.len());
    let mut report = RecycleReport {
        recycled: Vec::with_capacity(candidates.len()),
        failures: Vec::new(),
    };
    let mut seen = HashSet::with_capacity(candidates.len());
    for candidate in candidates {
        if cancellation.is_cancelled() {
            return Err(MutationError::Cancelled);
        }
        let preflight = (|| {
            let path = policy.validate_file(&candidate.path)?;
            if !seen.insert(path.clone()) {
                return Err(MutationError::Recycle {
                    path,
                    message: "the same file was selected more than once".to_owned(),
                });
            }
            let links = hard_link_count(&path)?;
            if links > 1 {
                return Err(MutationError::HardLinkedFile { path, links });
            }
            let expected = parse_hash_hex(&candidate.expected_blake3)?;
            let current = fingerprint_file(&path, cancellation)?;
            if current.size != candidate.expected_size || current.blake3 != expected {
                return Err(MutationError::ExternalChange(path));
            }
            Ok(path)
        })();
        match preflight {
            Ok(path) => preflighted.push(path),
            Err(error) => report.failures.push(RecycleFailure {
                path: candidate.path.clone(),
                message: error.to_string(),
            }),
        }
    }

    for path in preflighted {
        if cancellation.is_cancelled() {
            report.failures.push(RecycleFailure {
                path,
                message: MutationError::Cancelled.to_string(),
            });
            continue;
        }
        match recycler.recycle(&path) {
            Ok(()) => report.recycled.push(path),
            Err(message) => report.failures.push(RecycleFailure { path, message }),
        }
    }
    Ok(report)
}

#[cfg(windows)]
fn hard_link_count(path: &Path) -> Result<u64, MutationError> {
    use std::{fs::File, mem::MaybeUninit, os::windows::io::AsRawHandle as _};

    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    let file = File::open(path).map_err(|source| MutationError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let mut information = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    // SAFETY: the file handle is valid for the call and the output is read only on success.
    let succeeded = unsafe {
        GetFileInformationByHandle(file.as_raw_handle().cast(), information.as_mut_ptr())
    };
    if succeeded == 0 {
        return Err(MutationError::Io {
            path: path.to_path_buf(),
            source: std::io::Error::last_os_error(),
        });
    }
    // SAFETY: Windows reported that it initialized the output structure.
    Ok(u64::from(
        unsafe { information.assume_init() }.nNumberOfLinks,
    ))
}

#[cfg(unix)]
fn hard_link_count(path: &Path) -> Result<u64, MutationError> {
    use std::os::unix::fs::MetadataExt as _;

    std::fs::metadata(path)
        .map(|metadata| metadata.nlink())
        .map_err(|source| MutationError::Io {
            path: path.to_path_buf(),
            source,
        })
}

#[cfg(not(any(windows, unix)))]
fn hard_link_count(_path: &Path) -> Result<u64, MutationError> {
    Ok(1)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, sync::Mutex};

    use muller_core::CancellationToken;
    use tempfile::tempdir;

    use super::{RecycleCandidate, Recycler, recycle_candidates};
    use crate::{MutationPolicy, fingerprint_file};

    #[derive(Default)]
    struct FakeRecycler {
        calls: Mutex<Vec<std::path::PathBuf>>,
        fail_name: Option<String>,
    }

    impl Recycler for FakeRecycler {
        fn recycle(&self, path: &Path) -> Result<(), String> {
            self.calls
                .lock()
                .expect("fake recycler lock")
                .push(path.to_path_buf());
            if path.file_name().and_then(|name| name.to_str()) == self.fail_name.as_deref() {
                Err("injected recycler failure".to_owned())
            } else {
                Ok(())
            }
        }
    }

    fn candidate(path: &Path) -> RecycleCandidate {
        let fingerprint =
            fingerprint_file(path, &CancellationToken::default()).expect("fingerprint fixture");
        RecycleCandidate {
            path: path.to_path_buf(),
            expected_size: fingerprint.size,
            expected_blake3: fingerprint.hash_hex(),
        }
    }

    #[test]
    fn failed_preflight_does_not_block_valid_candidates() {
        let directory = tempdir().expect("temporary directory");
        let first = directory.path().join("first.txt");
        let second = directory.path().join("second.txt");
        fs::write(&first, "same").expect("write fixture");
        fs::write(&second, "same").expect("write fixture");
        let recycler = FakeRecycler::default();
        let mut candidates = [candidate(&first), candidate(&second)];
        candidates[1].expected_blake3 = "00".repeat(32);

        let report = recycle_candidates(
            &candidates,
            &MutationPolicy::default(),
            &recycler,
            &CancellationToken::default(),
        )
        .expect("batch should report failures");

        assert_eq!(report.recycled.len(), 1);
        assert_eq!(report.failures.len(), 1);
        assert!(
            report.failures[0]
                .message
                .contains("changed outside Muller")
        );
    }

    #[test]
    fn reports_partial_recycler_failures() {
        let directory = tempdir().expect("temporary directory");
        let first = directory.path().join("first.txt");
        let second = directory.path().join("second.txt");
        fs::write(&first, "same").expect("write fixture");
        fs::write(&second, "same").expect("write fixture");
        let recycler = FakeRecycler {
            calls: Mutex::default(),
            fail_name: Some("second.txt".to_owned()),
        };

        let report = recycle_candidates(
            &[candidate(&first), candidate(&second)],
            &MutationPolicy::default(),
            &recycler,
            &CancellationToken::default(),
        )
        .expect("preflight should pass");

        assert_eq!(
            report.recycled,
            [fs::canonicalize(first).expect("canonical path")]
        );
        assert_eq!(report.failures.len(), 1);
        assert_eq!(recycler.calls.lock().expect("fake recycler lock").len(), 2);
    }

    #[test]
    fn hard_links_are_rejected_before_recycling() {
        let directory = tempdir().expect("temporary directory");
        let first = directory.path().join("first.txt");
        let linked = directory.path().join("linked.txt");
        fs::write(&first, "same physical file").expect("write fixture");
        fs::hard_link(&first, &linked).expect("create hard-link fixture");
        let recycler = FakeRecycler::default();

        let report = recycle_candidates(
            &[candidate(&first)],
            &MutationPolicy::default(),
            &recycler,
            &CancellationToken::default(),
        )
        .expect("hard link should be an item failure");

        assert_eq!(report.recycled.len(), 0);
        assert_eq!(report.failures.len(), 1);
        assert!(report.failures[0].message.contains("hard-linked file"));
        assert!(
            recycler
                .calls
                .lock()
                .expect("fake recycler lock")
                .is_empty()
        );
    }
}
