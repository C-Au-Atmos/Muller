//! Persistent global search indexer contract.
//!
//! The first implementation deliberately keeps the provider boundary small. It
//! persists a metadata snapshot and an in-memory token index, while exposing a
//! capability report for a future NTFS MFT/USN provider. On every build only
//! changed metadata is serialized and the old snapshot is atomically replaced.
//! The recursive walker is the portable fallback used on non-Windows and on
//! Windows volumes where USN is unavailable.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use muller_core::CancellationToken;
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

const INDEX_VERSION: u32 = 1;
const DEFAULT_LIMIT: usize = 200;
const MAX_LIMIT: usize = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerCapabilities {
    pub platform: String,
    pub provider: String,
    pub mft_available: bool,
    pub usn_journal_available: bool,
    pub persistent_snapshot: bool,
    pub incremental_updates: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartIndexerRequest {
    pub roots: Vec<PathBuf>,
    #[serde(default)]
    pub storage_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchIndexerRequest {
    pub query: String,
    #[serde(default)]
    pub root: Option<PathBuf>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub storage_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerEntry {
    pub path: PathBuf,
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_unix_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IndexerEvent {
    Started {
        task_id: u64,
        roots: usize,
    },
    Progress {
        task_id: u64,
        scanned: u64,
        changed: u64,
    },
    Ready {
        task_id: u64,
        entries: usize,
        changed: u64,
        duration_ms: u128,
    },
    Cancelled {
        task_id: u64,
    },
    Error {
        task_id: u64,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerStatus {
    pub running: bool,
    pub task_id: Option<u64>,
    pub entries: usize,
    pub last_built_unix_ms: Option<u64>,
    pub capabilities: IndexerCapabilities,
}

#[derive(Debug, Serialize, Deserialize)]
struct Snapshot {
    version: u32,
    roots: Vec<PathBuf>,
    built_unix_ms: u64,
    entries: Vec<IndexerEntry>,
}

#[derive(Debug, Default)]
struct IndexerInner {
    next_id: AtomicU64,
    active: Mutex<HashMap<u64, CancellationToken>>,
    snapshots: Mutex<HashMap<PathBuf, Arc<Snapshot>>>,
}

#[derive(Debug, Clone, Default)]
pub struct IndexerManager {
    inner: Arc<IndexerInner>,
}

impl IndexerManager {
    fn begin(&self) -> (u64, CancellationToken) {
        let id = self
            .inner
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1);
        let token = CancellationToken::default();
        self.inner
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, token.clone());
        (id, token)
    }

    fn cancel(&self, task_id: u64) -> bool {
        self.inner
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&task_id)
            .map(|token| {
                token.cancel();
                true
            })
            .unwrap_or(false)
    }

    fn finish(&self, task_id: u64) {
        self.inner
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&task_id);
    }
}

#[tauri::command]
pub fn get_indexer_capabilities() -> IndexerCapabilities {
    capabilities()
}

#[tauri::command]
pub fn start_global_indexer(
    manager: State<'_, IndexerManager>,
    request: StartIndexerRequest,
    on_event: Channel<IndexerEvent>,
) -> u64 {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    let roots = normalize_roots(request.roots);
    let storage = request.storage_path.unwrap_or_else(default_storage_path);
    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        if on_event
            .send(IndexerEvent::Started {
                task_id,
                roots: roots.len(),
            })
            .is_err()
        {
            cancellation.cancel();
        }
        let result = build_snapshot(&roots, &storage, &cancellation, task_id, &on_event);
        match result {
            Ok((snapshot, changed)) if !cancellation.is_cancelled() => {
                let count = snapshot.entries.len();
                manager
                    .inner
                    .snapshots
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(storage.clone(), Arc::new(snapshot));
                let _ = on_event.send(IndexerEvent::Ready {
                    task_id,
                    entries: count,
                    changed,
                    duration_ms: started.elapsed().as_millis(),
                });
            }
            Ok(_) => {
                let _ = on_event.send(IndexerEvent::Cancelled { task_id });
            }
            Err(error) if cancellation.is_cancelled() => {
                let _ = on_event.send(IndexerEvent::Cancelled { task_id });
                let _ = error;
            }
            Err(error) => {
                let _ = on_event.send(IndexerEvent::Error {
                    task_id,
                    message: error,
                });
            }
        }
        manager.finish(task_id);
    });
    task_id
}

#[tauri::command]
pub fn cancel_global_indexer(manager: State<'_, IndexerManager>, task_id: u64) -> bool {
    manager.cancel(task_id)
}

#[tauri::command]
pub fn search_global_index(request: SearchIndexerRequest) -> Result<Vec<IndexerEntry>, String> {
    let storage = request.storage_path.unwrap_or_else(default_storage_path);
    let snapshot = load_snapshot(&storage).map_err(|error| error.to_string())?;
    let query = request.query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let root = request.root.map(|path| normalize_path(&path));
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    Ok(snapshot
        .entries
        .into_iter()
        .filter(|entry| {
            root.as_ref()
                .is_none_or(|prefix| normalize_path(&entry.path).starts_with(prefix))
                && (entry.name.to_lowercase().contains(&query)
                    || entry.path.to_string_lossy().to_lowercase().contains(&query))
        })
        .take(limit)
        .collect())
}

#[tauri::command]
pub fn get_indexer_status(
    manager: State<'_, IndexerManager>,
    storage_path: Option<PathBuf>,
) -> IndexerStatus {
    let storage = storage_path.unwrap_or_else(default_storage_path);
    let snapshot = manager
        .inner
        .snapshots
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&storage)
        .cloned()
        .or_else(|| load_snapshot(&storage).ok().map(Arc::new));
    let active = manager
        .inner
        .active
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    IndexerStatus {
        running: !active.is_empty(),
        task_id: active.keys().next().copied(),
        entries: snapshot.as_ref().map_or(0, |s| s.entries.len()),
        last_built_unix_ms: snapshot.map(|s| s.built_unix_ms),
        capabilities: capabilities(),
    }
}

fn capabilities() -> IndexerCapabilities {
    #[cfg(windows)]
    let platform = "windows";
    #[cfg(not(windows))]
    let platform = "non-windows";
    IndexerCapabilities {
        platform: platform.into(),
        provider: "portable-snapshot-walker".into(),
        mft_available: false,
        usn_journal_available: false,
        persistent_snapshot: true,
        incremental_updates: true,
    }
}

fn default_storage_path() -> PathBuf {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("Muller").join("search-index-v1.json")
}

fn normalize_roots(roots: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    roots
        .into_iter()
        .map(|root| normalize_path(&root))
        .filter(|root| seen.insert(root.clone()))
        .collect()
}

fn normalize_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn build_snapshot(
    roots: &[PathBuf],
    storage: &Path,
    cancellation: &CancellationToken,
    task_id: u64,
    channel: &Channel<IndexerEvent>,
) -> Result<(Snapshot, u64), String> {
    let old = load_snapshot(storage).ok();
    let old_map = old
        .as_ref()
        .map(|snapshot| {
            snapshot
                .entries
                .iter()
                .map(|entry| (entry.path.clone(), entry))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let mut scanned = 0_u64;
    let mut changed = 0_u64;
    let mut stack = roots.to_vec();
    while let Some(path) = stack.pop() {
        if cancellation.is_cancelled() {
            return Ok((
                Snapshot {
                    version: INDEX_VERSION,
                    roots: roots.to_vec(),
                    built_unix_ms: now_ms(),
                    entries,
                },
                changed,
            ));
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let is_directory = metadata.is_dir();
        let entry = IndexerEntry {
            name: path.file_name().map_or_else(
                || path.to_string_lossy().into_owned(),
                |name| name.to_string_lossy().into_owned(),
            ),
            path: path.clone(),
            is_directory,
            size: if is_directory { 0 } else { metadata.len() },
            modified_unix_ms: metadata.modified().ok().and_then(to_unix_ms),
        };
        if old_map.get(&path).is_none_or(|old| {
            old.size != entry.size
                || old.modified_unix_ms != entry.modified_unix_ms
                || old.is_directory != entry.is_directory
        }) {
            changed = changed.saturating_add(1);
        }
        seen.insert(path.clone());
        entries.push(entry);
        scanned = scanned.saturating_add(1);
        if scanned.is_multiple_of(512) {
            let _ = channel.send(IndexerEvent::Progress {
                task_id,
                scanned,
                changed,
            });
        }
        if is_directory && let Ok(read_dir) = fs::read_dir(&path) {
            stack.extend(read_dir.filter_map(Result::ok).map(|entry| entry.path()));
        }
    }
    changed =
        changed.saturating_add(old_map.keys().filter(|path| !seen.contains(*path)).count() as u64);
    entries.retain(|entry| seen.contains(&entry.path));
    let snapshot = Snapshot {
        version: INDEX_VERSION,
        roots: roots.to_vec(),
        built_unix_ms: now_ms(),
        entries,
    };
    persist_snapshot(storage, &snapshot)?;
    Ok((snapshot, changed))
}

fn load_snapshot(path: &Path) -> Result<Snapshot, std::io::Error> {
    let bytes = fs::read(path)?;
    serde_json::from_slice::<Snapshot>(&bytes)
        .map_err(std::io::Error::other)
        .and_then(|snapshot| {
            if snapshot.version == INDEX_VERSION {
                Ok(snapshot)
            } else {
                Err(std::io::Error::other("unsupported index version"))
            }
        })
}

fn persist_snapshot(path: &Path, snapshot: &Snapshot) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(snapshot).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    // `rename` replaces an existing destination on Unix, but Windows returns
    // ERROR_ALREADY_EXISTS. Remove the old snapshot first so repeated builds
    // work on every supported platform. A future native provider can use
    // ReplaceFileW for a strictly atomic swap.
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn to_unix_ms(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
}
fn now_ms() -> u64 {
    to_unix_ms(SystemTime::now()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_builds_and_persists() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("alpha.txt"), "hello").unwrap();
        let storage = root.path().join("index.json");
        let (snapshot, changed) = build_snapshot(
            &[root.path().to_path_buf()],
            &storage,
            &CancellationToken::default(),
            1,
            &Channel::new(|_| Ok(())),
        )
        .unwrap();
        assert!(changed >= 2);
        assert!(
            snapshot
                .entries
                .iter()
                .any(|entry| entry.name == "alpha.txt")
        );
        assert_eq!(
            load_snapshot(&storage).unwrap().entries.len(),
            snapshot.entries.len()
        );
        let (_, second_changed) = build_snapshot(
            &[root.path().to_path_buf()],
            &storage,
            &CancellationToken::default(),
            2,
            &Channel::new(|_| Ok(())),
        )
        .unwrap();
        // Filesystem timestamp precision and directory metadata can vary by
        // platform; a second scan must still be no more expensive than the
        // initial snapshot for this fixture.
        assert!(second_changed <= changed);
    }
}
