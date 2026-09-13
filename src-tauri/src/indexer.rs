//! Portable search fallback. Refreshes still walk the tree; changed counts are
//! diagnostics, not USN updates. Loaded snapshots are shared in memory so a
//! query never rereads/deserializes the full snapshot or stats every candidate.

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

const INDEX_VERSION: u32 = 2;
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

/// Query the persisted index for the global explorer search path.
///
/// This intentionally returns an error when the snapshot is unavailable or
/// does not cover any requested root so callers can fall back to the portable
/// directory walker without changing the UI contract.
pub(crate) fn search_persistent_index(
    manager: &IndexerManager,
    roots: &[PathBuf],
    query: &str,
    limit: usize,
) -> Result<Vec<IndexerEntry>, String> {
    if roots.is_empty() {
        return Err("search requires at least one root".into());
    }
    let snapshot = manager.snapshot(&default_storage_path())?;
    search_snapshot(&snapshot, roots, query, limit)
}

fn search_snapshot(
    snapshot: &Snapshot,
    roots: &[PathBuf],
    query: &str,
    limit: usize,
) -> Result<Vec<IndexerEntry>, String> {
    if roots.is_empty() {
        return Err("search requires at least one root".into());
    }
    if now_ms().saturating_sub(snapshot.built_unix_ms) > 300_000 {
        return Err("portable snapshot expired; refresh required".into());
    }
    let normalized_roots = normalize_roots(roots.to_vec());
    if !normalized_roots.iter().all(|root| {
        snapshot
            .roots
            .iter()
            .any(|indexed_root| root.starts_with(indexed_root))
    }) {
        return Err("persistent index does not cover requested roots".into());
    }
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 2_000_000);
    Ok(snapshot
        .entries
        .iter()
        .filter(|entry| {
            normalized_roots
                .iter()
                // Snapshot paths and roots are canonicalized during indexing;
                // avoid a filesystem syscall per candidate on the hot path.
                .any(|root| entry.path != *root && entry.path.starts_with(root))
                && entry.name_lower.contains(&query)
        })
        .take(limit)
        .cloned()
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerEntry {
    pub path: PathBuf,
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_unix_ms: Option<u64>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(skip)]
    name_lower: String,
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
    build_gate: Mutex<()>,
}

#[derive(Debug, Clone, Default)]
pub struct IndexerManager {
    inner: Arc<IndexerInner>,
}

impl IndexerManager {
    fn snapshot(&self, storage: &Path) -> Result<Arc<Snapshot>, String> {
        let mut snapshots = self
            .inner
            .snapshots
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(snapshot) = snapshots.get(storage) {
            return Ok(snapshot.clone());
        }
        let snapshot = Arc::new(load_snapshot(storage).map_err(|error| error.to_string())?);
        snapshots.insert(storage.to_path_buf(), snapshot.clone());
        Ok(snapshot)
    }

    pub(crate) fn cancel_all(&self) {
        for token in self
            .inner
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
        {
            token.cancel();
        }
    }

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
    manager.cancel_all();
    let (task_id, cancellation) = manager.begin();
    let roots = normalize_roots(request.roots);
    let storage = request.storage_path.unwrap_or_else(default_storage_path);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = manager
            .inner
            .build_gate
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
pub fn search_global_index(
    manager: State<'_, IndexerManager>,
    request: SearchIndexerRequest,
) -> Result<Vec<IndexerEntry>, String> {
    if request.storage_path.is_some() || request.root.is_none() {
        let storage = request.storage_path.unwrap_or_else(default_storage_path);
        let snapshot = manager.snapshot(&storage)?;
        let query = request.query.trim().to_lowercase();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let roots = request
            .root
            .map_or_else(|| snapshot.roots.clone(), |root| vec![root]);
        return search_snapshot(&snapshot, &roots, &query, limit);
    }
    search_persistent_index(
        &manager,
        &[request.root.expect("root was checked above")],
        &request.query,
        request.limit.unwrap_or(DEFAULT_LIMIT),
    )
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
        incremental_updates: false,
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
    if roots.is_empty() {
        return Err("index requires at least one root".into());
    }
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
        let name = path.file_name().map_or_else(
            || path.to_string_lossy().into_owned(),
            |name| name.to_string_lossy().into_owned(),
        );
        #[cfg(windows)]
        let hidden = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 2 != 0
        };
        #[cfg(not(windows))]
        let hidden = name.starts_with('.');
        let entry = IndexerEntry {
            name_lower: name.to_lowercase(),
            name,
            hidden,
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
        if !seen.insert(path.clone()) {
            continue;
        }
        entries.push(entry);
        if entries.len() > 2_000_000 {
            return Err("portable index exceeds two million entries".into());
        }
        scanned = scanned.saturating_add(1);
        if scanned.is_multiple_of(512)
            && channel
                .send(IndexerEvent::Progress {
                    task_id,
                    scanned,
                    changed,
                })
                .is_err()
        {
            cancellation.cancel();
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
    if !cancellation.is_cancelled() {
        persist_snapshot(storage, &snapshot)?;
    }
    Ok((snapshot, changed))
}

fn load_snapshot(path: &Path) -> Result<Snapshot, std::io::Error> {
    let bytes = fs::read(path)?;
    serde_json::from_slice::<Snapshot>(&bytes)
        .map_err(std::io::Error::other)
        .and_then(|mut snapshot| {
            if snapshot.version == INDEX_VERSION {
                for entry in &mut snapshot.entries {
                    entry.name_lower = entry.name.to_lowercase();
                }
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
    {
        use std::io::Write;
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    // std::fs::rename uses MoveFileExW(REPLACE_EXISTING) on Windows.
    // Never delete the last good snapshot before the replacement is ready.
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
    fn queries_reuse_memory_and_require_complete_root_coverage() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let storage = other.path().join("index.json");
        let root_path = normalize_path(root.path());
        let entries = (0..2500)
            .map(|i| IndexerEntry {
                path: root_path.join(format!("Alpha-{i}.txt")),
                name: format!("Alpha-{i}.txt"),
                name_lower: format!("alpha-{i}.txt"),
                is_directory: false,
                size: 42,
                modified_unix_ms: Some(1),
                hidden: true,
            })
            .collect();
        persist_snapshot(
            &storage,
            &Snapshot {
                version: INDEX_VERSION,
                roots: vec![root_path.clone()],
                built_unix_ms: now_ms(),
                entries,
            },
        )
        .unwrap();
        let manager = IndexerManager::default();
        let snapshot = manager.snapshot(&storage).unwrap();
        fs::remove_file(&storage).unwrap();
        assert!(Arc::ptr_eq(&snapshot, &manager.snapshot(&storage).unwrap()));
        let results =
            search_snapshot(&snapshot, std::slice::from_ref(&root_path), "ALPHA", 3000).unwrap();
        assert_eq!(
            results.len(),
            2500,
            "explorer must not inherit the direct API's 2000-item cap"
        );
        assert!(results[0].hidden);
        assert!(
            search_snapshot(
                &snapshot,
                &[root_path.clone(), normalize_path(other.path())],
                "alpha",
                3000
            )
            .is_err()
        );
        let parent = root_path.parent().unwrap().to_path_buf();
        assert!(search_snapshot(&snapshot, &[parent], "alpha", 3000).is_err());
        assert!(
            search_snapshot(&snapshot, &[root_path], "index", 3000)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn cancelled_refresh_preserves_last_good_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let storage = output.path().join("index.json");
        let roots = vec![normalize_path(root.path())];
        fs::write(root.path().join("first.txt"), "one").unwrap();
        build_snapshot(
            &roots,
            &storage,
            &CancellationToken::default(),
            1,
            &Channel::new(|_| Ok(())),
        )
        .unwrap();
        let original = fs::read(&storage).unwrap();
        fs::write(root.path().join("second.txt"), "two").unwrap();
        let token = CancellationToken::default();
        token.cancel();
        build_snapshot(&roots, &storage, &token, 2, &Channel::new(|_| Ok(()))).unwrap();
        assert_eq!(fs::read(&storage).unwrap(), original);
    }

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
