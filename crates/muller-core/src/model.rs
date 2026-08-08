use std::{num::NonZeroUsize, path::PathBuf};

use serde::{Serialize, Serializer};

pub const MAX_HASH_THREADS: usize = 32;
pub const MAX_FINGERPRINT_THREADS: usize = 4;

#[derive(Debug, Clone)]
pub struct ScanConfig {
    roots: Vec<PathBuf>,
    additional_blacklist: Vec<PathBuf>,
    min_size: u64,
    hash_threads: NonZeroUsize,
    progress_batch_size: usize,
}

impl ScanConfig {
    #[must_use]
    pub fn new<I, P>(roots: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: Into<PathBuf>,
    {
        let available = std::thread::available_parallelism()
            .map(NonZeroUsize::get)
            .unwrap_or(1);
        let threads = NonZeroUsize::new(available.min(8)).expect("one is non-zero");

        Self {
            roots: roots.into_iter().map(Into::into).collect(),
            additional_blacklist: Vec::new(),
            min_size: 1,
            hash_threads: threads,
            progress_batch_size: 64,
        }
    }

    #[must_use]
    pub fn with_min_size(mut self, min_size: u64) -> Self {
        self.min_size = min_size;
        self
    }

    #[must_use]
    pub fn with_hash_threads(mut self, threads: usize) -> Self {
        self.hash_threads =
            NonZeroUsize::new(threads.clamp(1, MAX_HASH_THREADS)).expect("clamp ensures non-zero");
        self
    }

    #[must_use]
    pub fn with_blacklist_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.additional_blacklist.push(path.into());
        self
    }

    #[must_use]
    pub fn with_progress_batch_size(mut self, files: usize) -> Self {
        self.progress_batch_size = files.max(1);
        self
    }

    #[must_use]
    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    #[must_use]
    pub fn additional_blacklist(&self) -> &[PathBuf] {
        &self.additional_blacklist
    }

    #[must_use]
    pub fn min_size(&self) -> u64 {
        self.min_size
    }

    #[must_use]
    pub fn hash_threads(&self) -> usize {
        self.hash_threads.get()
    }

    #[must_use]
    pub fn fingerprint_threads(&self) -> usize {
        self.hash_threads.get().min(MAX_FINGERPRINT_THREADS)
    }

    #[must_use]
    pub fn progress_batch_size(&self) -> usize {
        self.progress_batch_size
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub path: PathBuf,
    pub size: u64,
    pub created_unix_ms: Option<u64>,
    pub modified_unix_ms: Option<u64>,
    #[serde(serialize_with = "serialize_optional_u64_hex")]
    pub head_tail: Option<u64>,
    #[serde(serialize_with = "serialize_optional_hash")]
    pub full_hash: Option<[u8; 32]>,
    pub hard_link_count: u64,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    #[serde(serialize_with = "serialize_hash")]
    pub full_hash: [u8; 32],
    pub size: u64,
    pub files: Vec<FileEntry>,
    pub suggested_keep: usize,
}

impl DuplicateGroup {
    #[must_use]
    pub fn total_bytes(&self) -> u64 {
        self.size.saturating_mul(self.files.len() as u64)
    }

    #[must_use]
    pub fn reclaimable_bytes(&self) -> u64 {
        self.files
            .iter()
            .enumerate()
            .filter(|(index, file)| *index != self.suggested_keep && file.hard_link_count <= 1)
            .fold(0_u64, |total, (_, file)| total.saturating_add(file.size))
    }

    #[must_use]
    pub fn hash_hex(&self) -> String {
        hex_bytes(&self.full_hash)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanPhase {
    Discovering,
    Fingerprinting,
    FullHashing,
    Complete,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub phase: ScanPhase,
    pub processed: u64,
    pub total: Option<u64>,
    pub candidate_files: u64,
    pub bytes_read: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SkippedStage {
    Walk,
    Metadata,
    Identity,
    HeadTail,
    FullHash,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkippedFile {
    pub path: PathBuf,
    pub stage: SkippedStage,
    pub error: String,
    pub locked: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ScanStats {
    pub files_seen: u64,
    pub files_below_min_size: u64,
    pub unique_size_files: u64,
    pub size_candidate_files: u64,
    pub head_tail_candidate_files: u64,
    pub fully_hashed_files: u64,
    pub physical_duplicates_skipped: u64,
    pub blacklisted_entries_skipped: u64,
    pub symlinks_skipped: u64,
    pub bytes_read: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanReport {
    pub groups: Vec<DuplicateGroup>,
    pub skipped: Vec<SkippedFile>,
    pub stats: ScanStats,
    pub reclaimable_bytes: u64,
}

fn hex_bytes(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn serialize_hash<S>(hash: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&hex_bytes(hash))
}

fn serialize_optional_hash<S>(hash: &Option<[u8; 32]>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match hash {
        Some(hash) => serializer.serialize_some(&hex_bytes(hash)),
        None => serializer.serialize_none(),
    }
}

fn serialize_optional_u64_hex<S>(value: &Option<u64>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        Some(value) => serializer.serialize_some(&format!("{value:016x}")),
        None => serializer.serialize_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_HASH_THREADS, ScanConfig};

    #[test]
    fn hashing_parallelism_is_always_bounded() {
        assert_eq!(
            ScanConfig::new(["."])
                .with_hash_threads(usize::MAX)
                .hash_threads(),
            MAX_HASH_THREADS
        );
        assert_eq!(
            ScanConfig::new(["."]).with_hash_threads(0).hash_threads(),
            1
        );
    }
}
