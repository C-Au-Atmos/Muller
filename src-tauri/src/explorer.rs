use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

use muller_core::CancellationToken;
use pinyin::ToPinyin as _;
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

const MAX_DIRECTORY_PAGE_SIZE: usize = 512;
const MAX_SEARCH_RESULTS: usize = 200_000;
const MAX_SEARCH_INDEX_ENTRIES: usize = 2_000_000;
const SEARCH_INDEX_MAX_AGE: Duration = Duration::from_secs(5 * 60);

fn pinyin_initials(value: &str) -> String {
    value
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() {
                Some(character.to_ascii_lowercase())
            } else {
                character
                    .to_pinyin()
                    .and_then(|value| value.first_letter().chars().next())
            }
        })
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartDirectoryRequest {
    path: PathBuf,
    #[serde(default)]
    filter: Option<DirectoryQueryFilter>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartDirectorySearchRequest {
    roots: Vec<PathBuf>,
    query: String,
    #[serde(default)]
    recursive: bool,
    #[serde(default)]
    indexed: bool,
    #[serde(default)]
    filter: Option<DirectoryQueryFilter>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectoryQueryFilter {
    #[serde(default)]
    extensions: Vec<String>,
    modified_before_unix_ms: Option<u64>,
    modified_after_unix_ms: Option<u64>,
    #[serde(default)]
    files_only: bool,
    #[serde(default)]
    sort_by: DirectorySortField,
    #[serde(default)]
    sort_direction: DirectorySortDirection,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum DirectorySortField {
    #[default]
    Name,
    Type,
    Size,
    Modified,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum DirectorySortDirection {
    #[default]
    Ascending,
    Descending,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDirectoryResponse {
    task_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelDirectoryResponse {
    task_id: u64,
    cancelled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryEntryKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    path: PathBuf,
    name: String,
    kind: DirectoryEntryKind,
    extension: Option<String>,
    size: u64,
    modified_unix_ms: Option<u64>,
    hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPageResponse {
    session_id: u64,
    offset: usize,
    total_entries: usize,
    entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySearchPageResponse {
    session_id: u64,
    query: String,
    offset: usize,
    total_entries: usize,
    entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveDirectoryEntriesRequest {
    session_id: u64,
    #[serde(default)]
    query: String,
    positions: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryExtensionCount {
    extension: String,
    count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocatedDirectoryEntry {
    position: usize,
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DirectoryEvent {
    Started {
        task_id: u64,
    },
    Ready {
        task_id: u64,
        session_id: u64,
        path: PathBuf,
        parent: Option<PathBuf>,
        total_entries: usize,
    },
    Cancelled {
        task_id: u64,
    },
    Error {
        task_id: u64,
        message: String,
    },
}

#[derive(Debug)]
struct DirectorySession {
    path: PathBuf,
    entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Clone)]
struct IndexedDirectoryEntry {
    path: PathBuf,
    name: String,
    name_lower: String,
    kind: DirectoryEntryKind,
    extension: Option<String>,
}

#[derive(Debug)]
struct SearchIndex {
    built_at: Instant,
    entries: Vec<IndexedDirectoryEntry>,
}

#[derive(Debug, Default)]
enum SearchIndexState {
    #[default]
    Empty,
    Building,
    Ready(Arc<SearchIndex>),
}

#[derive(Debug, Default)]
struct SearchIndexSlot {
    state: Mutex<SearchIndexState>,
    ready: Condvar,
}

#[derive(Debug, Default)]
struct ExplorerManagerInner {
    next_id: AtomicU64,
    active: Mutex<HashMap<u64, CancellationToken>>,
    sessions: Mutex<HashMap<u64, Arc<DirectorySession>>>,
    search_indexes: Mutex<HashMap<String, Arc<SearchIndexSlot>>>,
}

#[derive(Debug, Clone, Default)]
pub struct ExplorerManager {
    inner: Arc<ExplorerManagerInner>,
}

impl ExplorerManager {
    fn begin(&self) -> (u64, CancellationToken) {
        let task_id = self
            .inner
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1);
        let cancellation = CancellationToken::default();
        lock_unpoisoned(&self.inner.active).insert(task_id, cancellation.clone());
        (task_id, cancellation)
    }

    fn cancel(&self, task_id: u64) -> bool {
        let cancelled =
            if let Some(cancellation) = lock_unpoisoned(&self.inner.active).get(&task_id) {
                cancellation.cancel();
                true
            } else {
                false
            };
        let closed = lock_unpoisoned(&self.inner.sessions)
            .remove(&task_id)
            .is_some();
        cancelled || closed
    }

    fn finish(&self, task_id: u64) {
        lock_unpoisoned(&self.inner.active).remove(&task_id);
    }

    fn store(&self, session_id: u64, session: DirectorySession) {
        lock_unpoisoned(&self.inner.sessions).insert(session_id, Arc::new(session));
    }

    fn search_index(
        &self,
        roots: &[PathBuf],
        cancellation: &CancellationToken,
    ) -> Result<Arc<SearchIndex>, DirectoryBuildError> {
        let key = search_roots_key(roots);
        let slot = lock_unpoisoned(&self.inner.search_indexes)
            .entry(key)
            .or_default()
            .clone();
        loop {
            if cancellation.is_cancelled() {
                return Err(DirectoryBuildError::Cancelled);
            }
            let mut state = lock_unpoisoned(&slot.state);
            match &*state {
                SearchIndexState::Ready(index)
                    if index.built_at.elapsed() <= SEARCH_INDEX_MAX_AGE =>
                {
                    return Ok(index.clone());
                }
                SearchIndexState::Ready(_) => {
                    *state = SearchIndexState::Empty;
                }
                SearchIndexState::Empty => {
                    *state = SearchIndexState::Building;
                    drop(state);
                    let result = build_search_index(roots, cancellation).map(Arc::new);
                    let mut state = lock_unpoisoned(&slot.state);
                    *state = match &result {
                        Ok(index) => SearchIndexState::Ready(index.clone()),
                        Err(_) => SearchIndexState::Empty,
                    };
                    slot.ready.notify_all();
                    return result;
                }
                SearchIndexState::Building => {
                    let waited = slot
                        .ready
                        .wait_timeout(state, Duration::from_millis(80))
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    drop(waited.0);
                }
            }
        }
    }

    fn build_indexed_search_session(
        &self,
        request: &StartDirectorySearchRequest,
        cancellation: &CancellationToken,
    ) -> Result<DirectorySession, DirectoryBuildError> {
        let index = self.search_index(&request.roots, cancellation)?;
        filter_search_index(request, &index, cancellation)
    }

    fn close(&self, session_id: u64) -> bool {
        lock_unpoisoned(&self.inner.sessions)
            .remove(&session_id)
            .is_some()
    }

    fn page(
        &self,
        session_id: u64,
        offset: usize,
        limit: usize,
    ) -> Result<DirectoryPageResponse, String> {
        let session = lock_unpoisoned(&self.inner.sessions)
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("directory session {session_id} was not found"))?;
        let total_entries = session.entries.len();
        let start = offset.min(total_entries);
        let end = start
            .saturating_add(limit.clamp(1, MAX_DIRECTORY_PAGE_SIZE))
            .min(total_entries);
        Ok(DirectoryPageResponse {
            session_id,
            offset: start,
            total_entries,
            entries: session.entries[start..end].to_vec(),
        })
    }

    fn search(
        &self,
        session_id: u64,
        query: &str,
        offset: usize,
        limit: usize,
    ) -> Result<DirectorySearchPageResponse, String> {
        let session = lock_unpoisoned(&self.inner.sessions)
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("directory session {session_id} was not found"))?;
        let query = query.trim().to_lowercase();
        let limit = limit.clamp(1, MAX_DIRECTORY_PAGE_SIZE);
        let mut total_entries = 0_usize;
        let mut entries = Vec::with_capacity(limit);
        for entry in &session.entries {
            if !query.is_empty() && !entry.name.to_lowercase().contains(&query) {
                continue;
            }
            if total_entries >= offset && entries.len() < limit {
                entries.push(entry.clone());
            }
            total_entries = total_entries.saturating_add(1);
        }
        Ok(DirectorySearchPageResponse {
            session_id,
            query,
            offset: offset.min(total_entries),
            total_entries,
            entries,
        })
    }

    fn resolve_entries(
        &self,
        request: &ResolveDirectoryEntriesRequest,
    ) -> Result<Vec<DirectoryEntry>, String> {
        let session = lock_unpoisoned(&self.inner.sessions)
            .get(&request.session_id)
            .cloned()
            .ok_or_else(|| format!("directory session {} was not found", request.session_id))?;
        let requested = request
            .positions
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>();
        let query = request.query.trim().to_lowercase();
        let mut visible_position = 0_usize;
        let mut entries = Vec::with_capacity(requested.len());
        for entry in &session.entries {
            if !query.is_empty() && !entry.name.to_lowercase().contains(&query) {
                continue;
            }
            if requested.contains(&visible_position) {
                entries.push(entry.clone());
            }
            visible_position = visible_position.saturating_add(1);
        }
        Ok(entries)
    }

    pub(crate) fn resolve_paths(
        &self,
        session_id: u64,
        query: &str,
        positions: &[usize],
    ) -> Result<Vec<PathBuf>, String> {
        let request = ResolveDirectoryEntriesRequest {
            session_id,
            query: query.to_owned(),
            positions: positions.to_vec(),
        };
        self.resolve_entries(&request)
            .map(|entries| entries.into_iter().map(|entry| entry.path).collect())
    }

    fn locate(
        &self,
        session_id: u64,
        prefix: &str,
        start_after: Option<usize>,
        query: &str,
    ) -> Result<Option<LocatedDirectoryEntry>, String> {
        let session = lock_unpoisoned(&self.inner.sessions)
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("directory session {session_id} was not found"))?;
        let prefix = prefix.trim().to_lowercase();
        if prefix.is_empty() {
            return Ok(None);
        }
        let query = query.trim().to_lowercase();
        let visible = session
            .entries
            .iter()
            .filter(|entry| query.is_empty() || entry.name.to_lowercase().contains(&query))
            .enumerate()
            .collect::<Vec<_>>();
        if visible.is_empty() {
            return Ok(None);
        }
        let mut direct = Vec::new();
        let mut phonetic = Vec::new();
        for (position, entry) in visible {
            let name = entry.name.to_lowercase();
            if name.starts_with(&prefix) {
                direct.push((position, entry));
            } else if pinyin_initials(&name).starts_with(&prefix) {
                phonetic.push((position, entry));
            }
        }
        direct.extend(phonetic);
        if direct.is_empty() {
            return Ok(None);
        }
        let next = start_after
            .and_then(|current| direct.iter().position(|(position, _)| *position == current))
            .map_or(0, |index| (index + 1) % direct.len());
        let (position, entry) = direct[next];
        Ok(Some(LocatedDirectoryEntry {
            position,
            path: entry.path.clone(),
        }))
    }
}

#[tauri::command]
pub fn start_directory_query(
    manager: State<'_, ExplorerManager>,
    request: StartDirectoryRequest,
    on_event: Channel<DirectoryEvent>,
) -> StartDirectoryResponse {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        if on_event.send(DirectoryEvent::Started { task_id }).is_err() {
            cancellation.cancel();
        }
        match build_directory_session(&request.path, request.filter.as_ref(), &cancellation) {
            Ok(session) if !cancellation.is_cancelled() => {
                let path = session.path.clone();
                let parent = directory_parent(&path);
                let total_entries = session.entries.len();
                manager.store(task_id, session);
                if on_event
                    .send(DirectoryEvent::Ready {
                        task_id,
                        session_id: task_id,
                        path,
                        parent,
                        total_entries,
                    })
                    .is_err()
                {
                    manager.close(task_id);
                }
            }
            Ok(_) | Err(DirectoryBuildError::Cancelled) => {
                let _ = on_event.send(DirectoryEvent::Cancelled { task_id });
            }
            Err(error) => {
                let _ = on_event.send(DirectoryEvent::Error {
                    task_id,
                    message: error.to_string(),
                });
            }
        }
        manager.finish(task_id);
    });
    StartDirectoryResponse { task_id }
}

#[tauri::command]
pub fn start_directory_search(
    manager: State<'_, ExplorerManager>,
    request: StartDirectorySearchRequest,
    on_event: Channel<DirectoryEvent>,
) -> StartDirectoryResponse {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    let root_count = request.roots.len();
    let query_length = request.query.chars().count();
    let indexed = request.indexed;
    let recursive = request.recursive;
    tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        log::debug!(
            target: "muller::search",
            "event=search.native_started task_id={task_id} root_count={root_count} query_length={query_length} indexed={indexed} recursive={recursive}"
        );
        if on_event.send(DirectoryEvent::Started { task_id }).is_err() {
            cancellation.cancel();
        }
        let result = if request.indexed {
            manager.build_indexed_search_session(&request, &cancellation)
        } else {
            build_search_session(&request, &cancellation)
        };
        match result {
            Ok(session) if !cancellation.is_cancelled() => {
                let path = session.path.clone();
                let parent = directory_parent(&path);
                let total_entries = session.entries.len();
                log::debug!(
                    target: "muller::search",
                    "event=search.native_ready task_id={task_id} result_count={total_entries} duration_ms={}",
                    started_at.elapsed().as_millis()
                );
                manager.store(task_id, session);
                if on_event
                    .send(DirectoryEvent::Ready {
                        task_id,
                        session_id: task_id,
                        path,
                        parent,
                        total_entries,
                    })
                    .is_err()
                {
                    manager.close(task_id);
                }
            }
            Ok(_) | Err(DirectoryBuildError::Cancelled) => {
                log::debug!(
                    target: "muller::search",
                    "event=search.native_cancelled task_id={task_id} duration_ms={}",
                    started_at.elapsed().as_millis()
                );
                let _ = on_event.send(DirectoryEvent::Cancelled { task_id });
            }
            Err(error) => {
                log::warn!(
                    target: "muller::search",
                    "event=search.native_failed task_id={task_id} error_kind=build duration_ms={}",
                    started_at.elapsed().as_millis()
                );
                let _ = on_event.send(DirectoryEvent::Error {
                    task_id,
                    message: error.to_string(),
                });
            }
        }
        manager.finish(task_id);
    });
    StartDirectoryResponse { task_id }
}

#[tauri::command]
pub fn warm_global_search_index(manager: State<'_, ExplorerManager>, roots: Vec<PathBuf>) {
    if roots.is_empty() {
        return;
    }
    let root_count = roots.len();
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        match manager.search_index(&roots, &CancellationToken::default()) {
            Ok(index) => log::debug!(
                target: "muller::search",
                "event=search.index_warmed root_count={root_count} entry_count={} duration_ms={}",
                index.entries.len(),
                started_at.elapsed().as_millis()
            ),
            Err(_) => log::warn!(
                target: "muller::search",
                "event=search.index_warm_failed root_count={root_count} duration_ms={}",
                started_at.elapsed().as_millis()
            ),
        }
    });
}

#[tauri::command]
pub fn cancel_directory_query(
    manager: State<'_, ExplorerManager>,
    task_id: u64,
) -> CancelDirectoryResponse {
    let response = CancelDirectoryResponse {
        task_id,
        cancelled: manager.cancel(task_id),
    };
    log::debug!(
        target: "muller::search",
        "event=search.cancel_requested task_id={task_id} cancelled={}",
        response.cancelled
    );
    response
}

#[tauri::command]
pub fn read_directory_page(
    manager: State<'_, ExplorerManager>,
    session_id: u64,
    offset: usize,
    limit: usize,
) -> Result<DirectoryPageResponse, String> {
    manager.page(session_id, offset, limit)
}

#[tauri::command]
pub fn search_directory_page(
    manager: State<'_, ExplorerManager>,
    session_id: u64,
    query: String,
    offset: usize,
    limit: usize,
) -> Result<DirectorySearchPageResponse, String> {
    manager.search(session_id, &query, offset, limit)
}

#[tauri::command]
pub fn resolve_directory_entries(
    manager: State<'_, ExplorerManager>,
    request: ResolveDirectoryEntriesRequest,
) -> Result<Vec<DirectoryEntry>, String> {
    manager.resolve_entries(&request)
}

#[tauri::command]
pub fn locate_directory_entry(
    manager: State<'_, ExplorerManager>,
    session_id: u64,
    prefix: String,
    start_after: Option<usize>,
    query: String,
) -> Result<Option<LocatedDirectoryEntry>, String> {
    manager.locate(session_id, &prefix, start_after, &query)
}

#[tauri::command]
pub fn close_directory_session(manager: State<'_, ExplorerManager>, session_id: u64) -> bool {
    manager.close(session_id)
}

#[tauri::command]
pub fn list_directory_extensions(path: PathBuf) -> Result<Vec<DirectoryExtensionCount>, String> {
    let mut counts = BTreeMap::<String, u64>::new();
    let entries =
        fs::read_dir(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    for result in entries {
        let entry = result.map_err(|error| format!("cannot read {}: {error}", path.display()))?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let Some(extension) = entry
            .path()
            .extension()
            .map(|value| value.to_string_lossy().to_lowercase())
        else {
            continue;
        };
        if extension.is_empty() {
            continue;
        }
        let count = counts.entry(extension).or_default();
        *count = count.saturating_add(1);
    }
    Ok(counts
        .into_iter()
        .map(|(extension, count)| DirectoryExtensionCount { extension, count })
        .collect())
}

#[derive(Debug)]
enum DirectoryBuildError {
    Cancelled,
    Message(String),
}

impl std::fmt::Display for DirectoryBuildError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("directory query cancelled"),
            Self::Message(message) => formatter.write_str(message),
        }
    }
}

fn build_directory_session(
    requested: &Path,
    filter: Option<&DirectoryQueryFilter>,
    cancellation: &CancellationToken,
) -> Result<DirectorySession, DirectoryBuildError> {
    if cancellation.is_cancelled() {
        return Err(DirectoryBuildError::Cancelled);
    }
    #[cfg(windows)]
    if let Some(server) = unc_server_name(requested) {
        return build_unc_server_session(&server, filter, cancellation);
    }
    let metadata = fs::metadata(requested).map_err(|error| {
        DirectoryBuildError::Message(format!("cannot inspect {}: {error}", requested.display()))
    })?;
    if !metadata.is_dir() {
        return Err(DirectoryBuildError::Message(format!(
            "path is not a directory: {}",
            requested.display()
        )));
    }
    let resolved_path = fs::canonicalize(requested).map_err(|error| {
        DirectoryBuildError::Message(format!("cannot resolve {}: {error}", requested.display()))
    })?;
    let read_dir = fs::read_dir(&resolved_path).map_err(|error| {
        DirectoryBuildError::Message(format!("cannot read {}: {error}", resolved_path.display()))
    })?;
    let mut entries = Vec::new();
    for result in read_dir {
        if cancellation.is_cancelled() {
            return Err(DirectoryBuildError::Cancelled);
        }
        let entry = result.map_err(|error| {
            DirectoryBuildError::Message(format!(
                "cannot read {}: {error}",
                resolved_path.display()
            ))
        })?;
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
            DirectoryBuildError::Message(format!(
                "cannot inspect {}: {error}",
                entry_path.display()
            ))
        })?;
        let file_type = metadata.file_type();
        let kind = if file_type.is_symlink() {
            DirectoryEntryKind::Symlink
        } else if file_type.is_dir() {
            DirectoryEntryKind::Directory
        } else if file_type.is_file() {
            DirectoryEntryKind::File
        } else {
            DirectoryEntryKind::Other
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let extension = entry_path
            .extension()
            .map(|value| value.to_string_lossy().to_lowercase());
        let modified = modified_unix_ms(&metadata);
        if !matches_directory_filter(kind, extension.as_deref(), modified, filter) {
            continue;
        }
        entries.push(DirectoryEntry {
            extension,
            size: if kind == DirectoryEntryKind::File {
                metadata.len()
            } else {
                0
            },
            modified_unix_ms: modified,
            hidden: is_hidden(&name, &metadata),
            path: path_for_user(&entry_path),
            name,
            kind,
        });
    }
    sort_directory_entries(&mut entries, filter);
    Ok(DirectorySession {
        path: path_for_user(&resolved_path),
        entries,
    })
}

fn build_search_session(
    request: &StartDirectorySearchRequest,
    cancellation: &CancellationToken,
) -> Result<DirectorySession, DirectoryBuildError> {
    let query = request.query.trim().to_lowercase();
    if query.is_empty() {
        return Err(DirectoryBuildError::Message(
            "search query cannot be empty".into(),
        ));
    }
    if request.roots.is_empty() {
        return Err(DirectoryBuildError::Message(
            "search requires at least one root".into(),
        ));
    }

    let mut entries = Vec::new();
    let mut readable_roots = 0_usize;
    let mut first_error = None;
    for requested in &request.roots {
        if cancellation.is_cancelled() {
            return Err(DirectoryBuildError::Cancelled);
        }
        let metadata = match fs::metadata(requested) {
            Ok(metadata) if metadata.is_dir() => metadata,
            Ok(_) => {
                first_error.get_or_insert_with(|| {
                    format!("path is not a directory: {}", requested.display())
                });
                continue;
            }
            Err(error) => {
                first_error.get_or_insert_with(|| {
                    format!("cannot inspect {}: {error}", requested.display())
                });
                continue;
            }
        };
        let _ = metadata;
        let root = match fs::canonicalize(requested) {
            Ok(path) => path,
            Err(error) => {
                first_error.get_or_insert_with(|| {
                    format!("cannot resolve {}: {error}", requested.display())
                });
                continue;
            }
        };
        readable_roots = readable_roots.saturating_add(1);
        let mut pending = vec![root];
        while let Some(directory) = pending.pop() {
            if cancellation.is_cancelled() {
                return Err(DirectoryBuildError::Cancelled);
            }
            let read_dir = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for result in read_dir {
                if cancellation.is_cancelled() {
                    return Err(DirectoryBuildError::Cancelled);
                }
                let Ok(entry) = result else { continue };
                let entry_path = entry.path();
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                let kind = entry_kind_from_file_type(file_type);
                if request.recursive && kind == DirectoryEntryKind::Directory {
                    pending.push(entry_path.clone());
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.to_lowercase().contains(&query) {
                    continue;
                }
                let metadata = fs::symlink_metadata(&entry_path).ok();
                let extension = entry_path
                    .extension()
                    .map(|value| value.to_string_lossy().to_lowercase());
                let modified = metadata.as_ref().and_then(modified_unix_ms);
                if !matches_directory_filter(
                    kind,
                    extension.as_deref(),
                    modified,
                    request.filter.as_ref(),
                ) {
                    continue;
                }
                entries.push(DirectoryEntry {
                    extension,
                    size: if kind == DirectoryEntryKind::File {
                        metadata.as_ref().map_or(0, fs::Metadata::len)
                    } else {
                        0
                    },
                    modified_unix_ms: modified,
                    hidden: metadata
                        .as_ref()
                        .is_some_and(|metadata| is_hidden(&name, metadata)),
                    path: path_for_user(&entry_path),
                    name,
                    kind,
                });
                if entries.len() >= MAX_SEARCH_RESULTS {
                    break;
                }
            }
            if entries.len() >= MAX_SEARCH_RESULTS {
                break;
            }
        }
        if entries.len() >= MAX_SEARCH_RESULTS {
            break;
        }
    }
    if readable_roots == 0 {
        return Err(DirectoryBuildError::Message(
            first_error.unwrap_or_else(|| "none of the search roots can be read".into()),
        ));
    }
    sort_directory_entries(&mut entries, request.filter.as_ref());
    Ok(DirectorySession {
        path: path_for_user(&request.roots[0]),
        entries,
    })
}

fn search_roots_key(roots: &[PathBuf]) -> String {
    let mut values = roots
        .iter()
        .map(|root| path_for_user(root).to_string_lossy().to_lowercase())
        .collect::<Vec<_>>();
    values.sort_unstable();
    values.dedup();
    values.join("\u{0}")
}

fn build_search_index(
    roots: &[PathBuf],
    cancellation: &CancellationToken,
) -> Result<SearchIndex, DirectoryBuildError> {
    if roots.is_empty() {
        return Err(DirectoryBuildError::Message(
            "search requires at least one root".into(),
        ));
    }
    let mut entries = Vec::new();
    let mut readable_roots = 0_usize;
    let mut first_error = None;
    for requested in roots {
        if cancellation.is_cancelled() {
            return Err(DirectoryBuildError::Cancelled);
        }
        let root = match fs::canonicalize(requested) {
            Ok(path) if path.is_dir() => path,
            Ok(_) => {
                first_error.get_or_insert_with(|| {
                    format!("path is not a directory: {}", requested.display())
                });
                continue;
            }
            Err(error) => {
                first_error.get_or_insert_with(|| {
                    format!("cannot inspect {}: {error}", requested.display())
                });
                continue;
            }
        };
        readable_roots = readable_roots.saturating_add(1);
        let mut pending = vec![root];
        while let Some(directory) = pending.pop() {
            if cancellation.is_cancelled() {
                return Err(DirectoryBuildError::Cancelled);
            }
            let Ok(read_dir) = fs::read_dir(directory) else {
                continue;
            };
            for result in read_dir {
                if cancellation.is_cancelled() {
                    return Err(DirectoryBuildError::Cancelled);
                }
                let Ok(entry) = result else { continue };
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                let kind = entry_kind_from_file_type(file_type);
                let path = entry.path();
                if kind == DirectoryEntryKind::Directory {
                    pending.push(path.clone());
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                entries.push(IndexedDirectoryEntry {
                    extension: path
                        .extension()
                        .map(|value| value.to_string_lossy().to_lowercase()),
                    path,
                    name_lower: name.to_lowercase(),
                    name,
                    kind,
                });
                if entries.len() >= MAX_SEARCH_INDEX_ENTRIES {
                    break;
                }
            }
            if entries.len() >= MAX_SEARCH_INDEX_ENTRIES {
                break;
            }
        }
        if entries.len() >= MAX_SEARCH_INDEX_ENTRIES {
            break;
        }
    }
    if readable_roots == 0 {
        return Err(DirectoryBuildError::Message(
            first_error.unwrap_or_else(|| "none of the search roots can be read".into()),
        ));
    }
    Ok(SearchIndex {
        built_at: Instant::now(),
        entries,
    })
}

fn filter_search_index(
    request: &StartDirectorySearchRequest,
    index: &SearchIndex,
    cancellation: &CancellationToken,
) -> Result<DirectorySession, DirectoryBuildError> {
    let query = request.query.trim().to_lowercase();
    if query.is_empty() {
        return Err(DirectoryBuildError::Message(
            "search query cannot be empty".into(),
        ));
    }
    let mut entries = Vec::new();
    for indexed in &index.entries {
        if cancellation.is_cancelled() {
            return Err(DirectoryBuildError::Cancelled);
        }
        if !indexed.name_lower.contains(&query) {
            continue;
        }
        let metadata = fs::symlink_metadata(&indexed.path).ok();
        let modified = metadata.as_ref().and_then(modified_unix_ms);
        if !matches_directory_filter(
            indexed.kind,
            indexed.extension.as_deref(),
            modified,
            request.filter.as_ref(),
        ) {
            continue;
        }
        entries.push(DirectoryEntry {
            path: path_for_user(&indexed.path),
            name: indexed.name.clone(),
            kind: indexed.kind,
            extension: indexed.extension.clone(),
            size: if indexed.kind == DirectoryEntryKind::File {
                metadata.as_ref().map_or(0, fs::Metadata::len)
            } else {
                0
            },
            modified_unix_ms: modified,
            hidden: metadata
                .as_ref()
                .is_some_and(|metadata| is_hidden(&indexed.name, metadata)),
        });
        if entries.len() >= MAX_SEARCH_RESULTS {
            break;
        }
    }
    sort_directory_entries(&mut entries, request.filter.as_ref());
    Ok(DirectorySession {
        path: path_for_user(&request.roots[0]),
        entries,
    })
}

fn entry_kind_from_file_type(file_type: fs::FileType) -> DirectoryEntryKind {
    if file_type.is_symlink() {
        DirectoryEntryKind::Symlink
    } else if file_type.is_dir() {
        DirectoryEntryKind::Directory
    } else if file_type.is_file() {
        DirectoryEntryKind::File
    } else {
        DirectoryEntryKind::Other
    }
}

fn sort_directory_entries(entries: &mut [DirectoryEntry], filter: Option<&DirectoryQueryFilter>) {
    let sort_by = filter.map_or(DirectorySortField::Name, |value| value.sort_by);
    let sort_direction = filter.map_or(DirectorySortDirection::Ascending, |value| {
        value.sort_direction
    });
    entries.sort_by(|left, right| {
        let kind_order = entry_kind_order(left.kind).cmp(&entry_kind_order(right.kind));
        if !kind_order.is_eq() {
            return kind_order;
        }
        let field_order = match sort_by {
            DirectorySortField::Name => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
            DirectorySortField::Type => left
                .extension
                .as_deref()
                .unwrap_or("")
                .cmp(right.extension.as_deref().unwrap_or("")),
            DirectorySortField::Size => left.size.cmp(&right.size),
            DirectorySortField::Modified => left.modified_unix_ms.cmp(&right.modified_unix_ms),
        };
        let directed = if sort_direction == DirectorySortDirection::Descending {
            field_order.reverse()
        } else {
            field_order
        };
        directed
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
}

#[cfg(windows)]
fn build_unc_server_session(
    server: &str,
    filter: Option<&DirectoryQueryFilter>,
    cancellation: &CancellationToken,
) -> Result<DirectorySession, DirectoryBuildError> {
    let shares =
        crate::windows_navigation::list_unc_shares(server).map_err(DirectoryBuildError::Message)?;
    let mut entries = Vec::new();
    for path in shares {
        if cancellation.is_cancelled() {
            return Err(DirectoryBuildError::Cancelled);
        }
        if !matches_directory_filter(DirectoryEntryKind::Directory, None, None, filter) {
            continue;
        }
        let name = path.file_name().map_or_else(
            || path.to_string_lossy().into_owned(),
            |value| value.to_string_lossy().into_owned(),
        );
        entries.push(DirectoryEntry {
            path,
            name,
            kind: DirectoryEntryKind::Directory,
            extension: None,
            size: 0,
            modified_unix_ms: None,
            hidden: false,
        });
    }
    sort_directory_entries(&mut entries, filter);
    Ok(DirectorySession {
        path: PathBuf::from(format!(r"\\{}", server.trim_matches(['\\', '/']))),
        entries,
    })
}

#[cfg(windows)]
fn unc_server_name(path: &Path) -> Option<String> {
    let normalized = path.as_os_str().to_string_lossy().replace('/', "\\");
    let remainder = normalized.strip_prefix(r"\\")?;
    let parts = remainder
        .split('\\')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    (parts.len() == 1).then(|| parts[0].to_owned())
}

fn directory_parent(path: &Path) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let normalized = path.as_os_str().to_string_lossy().replace('/', "\\");
        if let Some(remainder) = normalized.strip_prefix(r"\\") {
            let parts = remainder
                .split('\\')
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>();
            return match parts.len() {
                0 | 1 => None,
                2 => Some(PathBuf::from(format!(r"\\{}", parts[0]))),
                _ => Some(PathBuf::from(format!(
                    r"\\{}\{}",
                    parts[0],
                    parts[1..parts.len() - 1].join("\\")
                ))),
            };
        }
    }
    path.parent().map(path_for_user)
}

fn matches_directory_filter(
    kind: DirectoryEntryKind,
    extension: Option<&str>,
    modified_unix_ms: Option<u64>,
    filter: Option<&DirectoryQueryFilter>,
) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    if filter.files_only && kind != DirectoryEntryKind::File {
        return false;
    }
    if kind != DirectoryEntryKind::File {
        return true;
    }
    if !filter.extensions.is_empty()
        && !extension.is_some_and(|value| {
            filter
                .extensions
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(value))
        })
    {
        return false;
    }
    if let Some(before) = filter.modified_before_unix_ms
        && modified_unix_ms.is_none_or(|value| value > before)
    {
        return false;
    }
    if let Some(after) = filter.modified_after_unix_ms
        && modified_unix_ms.is_none_or(|value| value < after)
    {
        return false;
    }
    true
}

#[cfg(windows)]
fn path_for_user(path: &Path) -> PathBuf {
    let value = path.as_os_str().to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    if let Some(local) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(local);
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn path_for_user(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn entry_kind_order(kind: DirectoryEntryKind) -> u8 {
    match kind {
        DirectoryEntryKind::Directory => 0,
        DirectoryEntryKind::File => 1,
        DirectoryEntryKind::Symlink => 2,
        DirectoryEntryKind::Other => 3,
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

#[cfg(windows)]
fn is_hidden(_name: &str, metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;

    metadata.file_attributes() & 0x2 != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _metadata: &fs::Metadata) -> bool {
    name.starts_with('.')
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use tempfile::tempdir;

    use super::{
        DirectoryEntryKind, DirectoryQueryFilter, ExplorerManager, StartDirectorySearchRequest,
        build_directory_session, build_search_session,
    };

    #[test]
    fn directory_snapshot_sorts_directories_first_and_pages_results() {
        let fixture = tempdir().expect("fixture");
        fs::write(fixture.path().join("z.txt"), "z").expect("file");
        fs::create_dir(fixture.path().join("Folder")).expect("directory");
        fs::write(fixture.path().join("a.txt"), "a").expect("file");
        let manager = ExplorerManager::default();
        let session = build_directory_session(fixture.path(), None, &Default::default())
            .expect("directory session");
        assert_eq!(session.entries[0].kind, DirectoryEntryKind::Directory);
        assert_eq!(session.entries[1].name, "a.txt");
        manager.store(7, session);

        let page = manager.page(7, 1, 1).expect("page");
        assert_eq!(page.total_entries, 3);
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].name, "a.txt");
    }

    #[test]
    fn cancelled_snapshot_stops_before_enumeration() {
        let fixture = tempdir().expect("fixture");
        let cancellation = muller_core::CancellationToken::default();
        cancellation.cancel();
        assert!(
            build_directory_session(fixture.path(), None, &cancellation).is_err(),
            "cancelled query must not build a session"
        );
    }

    #[test]
    fn cancelling_a_completed_task_closes_its_session() {
        let fixture = tempdir().expect("fixture");
        let manager = ExplorerManager::default();
        let session = build_directory_session(fixture.path(), None, &Default::default())
            .expect("directory session");
        manager.store(22, session);

        assert!(manager.cancel(22));
        assert!(manager.page(22, 0, 1).is_err());
    }

    #[test]
    fn directory_search_covers_the_complete_session_and_pages_matches() {
        let fixture = tempdir().expect("fixture");
        fs::write(fixture.path().join("Alpha.md"), "a").expect("file");
        fs::write(fixture.path().join("beta.txt"), "b").expect("file");
        fs::write(fixture.path().join("alphabet.txt"), "c").expect("file");
        let manager = ExplorerManager::default();
        let session = build_directory_session(fixture.path(), None, &Default::default())
            .expect("directory session");
        manager.store(31, session);

        let first = manager.search(31, "ALPHA", 0, 1).expect("first page");
        assert_eq!(first.total_entries, 2);
        assert_eq!(first.entries.len(), 1);
        let second = manager.search(31, "alpha", 1, 1).expect("second page");
        assert_eq!(second.total_entries, 2);
        assert_eq!(second.entries.len(), 1);
        assert_ne!(first.entries[0].name, second.entries[0].name);
    }

    #[test]
    fn recursive_search_builds_a_paginated_session_from_nested_entries() {
        let fixture = tempdir().expect("fixture");
        fs::create_dir(fixture.path().join("nested")).expect("nested directory");
        fs::write(fixture.path().join("nested").join("needle.txt"), "match").expect("nested file");
        fs::write(fixture.path().join("other.txt"), "other").expect("other file");
        let request = StartDirectorySearchRequest {
            roots: vec![fixture.path().to_path_buf()],
            query: "NEEDLE".into(),
            recursive: true,
            indexed: false,
            filter: None,
        };
        let session = build_search_session(&request, &Default::default()).expect("search session");
        assert_eq!(session.entries.len(), 1);
        assert_eq!(session.entries[0].name, "needle.txt");
    }

    #[test]
    fn global_search_index_is_reused_until_its_refresh_window_expires() {
        let fixture = tempdir().expect("fixture");
        fs::write(fixture.path().join("first.txt"), "first").expect("first file");
        let manager = ExplorerManager::default();
        let roots = vec![fixture.path().to_path_buf()];
        let cancellation = Default::default();

        let first = manager
            .search_index(&roots, &cancellation)
            .expect("initial index");
        fs::write(fixture.path().join("created-after-index.txt"), "later").expect("later file");
        let second = manager
            .search_index(&roots, &cancellation)
            .expect("cached index");

        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(second.entries.len(), 1);
    }

    #[test]
    fn prefix_location_uses_the_complete_filtered_session_and_cycles() {
        let fixture = tempdir().expect("fixture");
        fs::write(fixture.path().join("Alpha.md"), "a").expect("file");
        fs::write(fixture.path().join("Alpine.txt"), "b").expect("file");
        fs::write(fixture.path().join("beta.txt"), "c").expect("file");
        let manager = ExplorerManager::default();
        let session = build_directory_session(fixture.path(), None, &Default::default())
            .expect("directory session");
        manager.store(41, session);

        let first = manager
            .locate(41, "al", None, "")
            .expect("first locate")
            .expect("first match");
        let second = manager
            .locate(41, "AL", Some(first.position), "")
            .expect("second locate")
            .expect("second match");
        let wrapped = manager
            .locate(41, "al", Some(second.position), "")
            .expect("wrapped locate")
            .expect("wrapped match");

        assert_ne!(first.path, second.path);
        assert_eq!(first.position, wrapped.position);

        let filtered = manager
            .locate(41, "be", None, "txt")
            .expect("filtered locate")
            .expect("filtered match");
        assert_eq!(
            filtered.path.file_name().expect("filtered file name"),
            "beta.txt"
        );
    }

    #[test]
    fn prefix_location_supports_pinyin_initials_after_direct_matches() {
        let fixture = tempdir().expect("fixture");
        fs::create_dir(fixture.path().join("CS-English")).expect("english directory");
        fs::create_dir(fixture.path().join("测试资料")).expect("chinese directory");
        let manager = ExplorerManager::default();
        let session = build_directory_session(fixture.path(), None, &Default::default())
            .expect("directory session");
        manager.store(42, session);

        let direct = manager
            .locate(42, "cs", None, "")
            .expect("direct locate")
            .expect("direct match");
        assert_eq!(
            direct.path.file_name().expect("direct file name"),
            "CS-English"
        );
        let phonetic = manager
            .locate(42, "cs", Some(direct.position), "")
            .expect("pinyin locate")
            .expect("pinyin match");
        assert_eq!(
            phonetic.path.file_name().expect("pinyin file name"),
            "测试资料"
        );
    }

    #[test]
    fn directory_filter_applies_extensions_and_files_only_before_paging() {
        let fixture = tempdir().expect("fixture");
        fs::create_dir(fixture.path().join("nested")).expect("directory");
        fs::write(fixture.path().join("image.PNG"), "png").expect("image");
        fs::write(fixture.path().join("notes.md"), "notes").expect("notes");
        let filter = DirectoryQueryFilter {
            extensions: vec!["png".into()],
            files_only: true,
            ..Default::default()
        };
        let session = build_directory_session(fixture.path(), Some(&filter), &Default::default())
            .expect("filtered session");
        assert_eq!(session.entries.len(), 1);
        assert_eq!(session.entries[0].name, "image.PNG");
    }

    #[test]
    fn directory_snapshot_sorts_fields_before_paging() {
        let fixture = tempdir().expect("fixture");
        fs::write(fixture.path().join("small.txt"), "1").expect("small file");
        fs::write(fixture.path().join("large.txt"), "123456").expect("large file");
        let filter = DirectoryQueryFilter {
            sort_by: super::DirectorySortField::Size,
            sort_direction: super::DirectorySortDirection::Descending,
            ..Default::default()
        };
        let session = build_directory_session(fixture.path(), Some(&filter), &Default::default())
            .expect("sorted session");
        assert_eq!(session.entries[0].name, "large.txt");
        assert_eq!(session.entries[1].name, "small.txt");
    }

    #[cfg(windows)]
    #[test]
    fn extended_windows_paths_are_returned_in_user_form() {
        assert_eq!(
            super::path_for_user(std::path::Path::new(r"\\?\D:\Muller")),
            std::path::PathBuf::from(r"D:\Muller")
        );
        assert_eq!(
            super::path_for_user(std::path::Path::new(r"\\?\UNC\server\share\folder")),
            std::path::PathBuf::from(r"\\server\share\folder")
        );
    }

    #[cfg(windows)]
    #[test]
    fn unc_roots_have_this_pc_as_parent_and_shares_return_to_the_server() {
        assert_eq!(
            super::unc_server_name(std::path::Path::new(r"\\10.1.10.8")),
            Some("10.1.10.8".into())
        );
        assert_eq!(
            super::directory_parent(std::path::Path::new(r"\\10.1.10.8")),
            None
        );
        assert_eq!(
            super::directory_parent(std::path::Path::new(r"\\10.1.10.8\Public")),
            Some(std::path::PathBuf::from(r"\\10.1.10.8"))
        );
    }
}
