use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

use muller_core::CancellationToken;
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

const DEFAULT_BATCH_SIZE: usize = 128;
const MAX_BATCH_SIZE: usize = 4096;
const MAX_DEPTH: u32 = 256;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(80);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartSpaceScanRequest {
    pub root: PathBuf,
    #[serde(default)]
    pub batch_size: Option<usize>,
    #[serde(default)]
    pub max_depth: Option<u32>,
    /// Limit emitted tree levels without limiting the recursive measurement.
    #[serde(default)]
    pub display_depth: Option<u32>,
}

impl StartSpaceScanRequest {
    fn display_depth(&self) -> u32 {
        self.display_depth.unwrap_or(MAX_DEPTH).clamp(1, MAX_DEPTH)
    }

    fn batch_size(&self) -> usize {
        self.batch_size
            .unwrap_or(DEFAULT_BATCH_SIZE)
            .clamp(1, MAX_BATCH_SIZE)
    }
    fn max_depth(&self) -> u32 {
        self.max_depth.unwrap_or(MAX_DEPTH).min(MAX_DEPTH)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSpaceScanResponse {
    pub task_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelSpaceScanResponse {
    pub task_id: u64,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceNode {
    pub path: PathBuf,
    pub parent: Option<PathBuf>,
    pub name: String,
    pub kind: SpaceNodeKind,
    pub bytes: u64,
    /// The entry's timestamp at enumeration, retained for guarded file operations.
    pub modified_unix_ms: Option<u64>,
    pub depth: u32,
    pub child_count: u32,
    pub partial: bool,
    pub scanning: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpaceNodeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SpaceScanEvent {
    Started {
        task_id: u64,
        root: PathBuf,
    },
    Batch {
        task_id: u64,
        items: Vec<SpaceNode>,
        total_bytes: u64,
        file_count: u64,
        directory_count: u64,
        skipped_count: u64,
    },
    Cached {
        task_id: u64,
        items: Vec<SpaceNode>,
        total_bytes: u64,
    },
    Done {
        task_id: u64,
        root: SpaceNode,
        total_bytes: u64,
        file_count: u64,
        directory_count: u64,
        skipped_count: u64,
    },
    Cancelled {
        task_id: u64,
    },
    Error {
        task_id: u64,
        message: String,
    },
}

#[derive(Debug, Default)]
struct SpaceSnifferInner {
    next_id: AtomicU64,
    active: Mutex<HashMap<u64, CancellationToken>>,
}

#[derive(Debug, Clone, Default)]
pub struct SpaceSnifferManager {
    inner: Arc<SpaceSnifferInner>,
}

impl SpaceSnifferManager {
    fn begin(&self) -> (u64, CancellationToken) {
        let id = self
            .inner
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1);
        let token = CancellationToken::default();
        let mut active = lock_unpoisoned(&self.inner.active);
        for previous in active.values() {
            previous.cancel();
        }
        active.clear();
        active.insert(id, token.clone());
        (id, token)
    }
    fn cancel(&self, task_id: u64) -> bool {
        let active = lock_unpoisoned(&self.inner.active);
        active
            .get(&task_id)
            .map(|token| {
                token.cancel();
                true
            })
            .unwrap_or(false)
    }
    fn finish(&self, task_id: u64) {
        lock_unpoisoned(&self.inner.active).remove(&task_id);
    }
}

#[tauri::command]
pub fn start_space_scan(
    manager: State<'_, SpaceSnifferManager>,
    request: StartSpaceScanRequest,
    on_event: Channel<SpaceScanEvent>,
) -> Result<StartSpaceScanResponse, String> {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        run_cached_space_scan(task_id, request, &cancellation, |event| {
            on_event.send(event).is_ok()
        });
        manager.finish(task_id);
    });
    Ok(StartSpaceScanResponse { task_id })
}

#[tauri::command]
pub fn cancel_space_scan(
    manager: State<'_, SpaceSnifferManager>,
    task_id: u64,
) -> CancelSpaceScanResponse {
    CancelSpaceScanResponse {
        task_id,
        cancelled: manager.cancel(task_id),
    }
}

#[derive(Debug)]
struct NodeState {
    node: SpaceNode,
    parent: Option<usize>,
    dirty: bool,
}

enum Work {
    Enter(usize),
    Exit(usize),
}

struct ScanProgress {
    states: Vec<NodeState>,
    dirty: Vec<usize>,
    file_count: u64,
    directory_count: u64,
    skipped_count: u64,
    batch_size: usize,
    display_depth: u32,
    last_flush: Instant,
}

impl ScanProgress {
    fn mark_dirty(&mut self, index: usize) {
        if self.states[index].node.depth > self.display_depth {
            return;
        }
        if !self.states[index].dirty {
            self.states[index].dirty = true;
            self.dirty.push(index);
        }
    }

    // Each file contributes once, at discovery. Closing directories never adds
    // their bytes again. The parent chain is bounded by the scan depth limit.
    fn update_ancestors(&mut self, mut index: Option<usize>, bytes: u64, partial: bool) {
        while let Some(current) = index {
            let state = &mut self.states[current];
            state.node.bytes = state.node.bytes.saturating_add(bytes);
            state.node.partial |= partial;
            index = state.parent;
            self.mark_dirty(current);
        }
    }

    fn flush<F>(
        &mut self,
        task_id: u64,
        cancellation: &CancellationToken,
        force: bool,
        send: &mut F,
    ) where
        F: FnMut(SpaceScanEvent) -> bool,
    {
        if self.dirty.is_empty()
            || (!force
                && self.dirty.len() < self.batch_size
                && self.last_flush.elapsed() < PROGRESS_INTERVAL)
        {
            return;
        }
        // Upserts use absolute totals. A node is queued at most once per flush,
        // so wide directories cannot create quadratic snapshots or append work.
        for chunk in self.dirty.chunks(self.batch_size) {
            if cancellation.is_cancelled() {
                break;
            }
            let items = chunk
                .iter()
                .map(|&index| {
                    self.states[index].dirty = false;
                    self.states[index].node.clone()
                })
                .collect();
            if !send(SpaceScanEvent::Batch {
                task_id,
                items,
                total_bytes: self.states[0].node.bytes,
                file_count: self.file_count,
                directory_count: self.directory_count,
                skipped_count: self.skipped_count,
            }) {
                cancellation.cancel();
                break;
            }
        }
        self.dirty.clear();
        self.last_flush = Instant::now();
    }
}

fn run_cached_space_scan<F>(
    task_id: u64,
    request: StartSpaceScanRequest,
    cancellation: &CancellationToken,
    mut send: F,
) where
    F: FnMut(SpaceScanEvent) -> bool,
{
    // This function runs on a blocking worker. Even the first metadata read
    // may wait on a slow/unavailable drive and must not block the IPC thread.
    if cancellation.is_cancelled() {
        let _ = send(SpaceScanEvent::Cancelled { task_id });
        return;
    }
    let validation = fs::symlink_metadata(&request.root)
        .map_err(|error| format!("cannot inspect {}: {error}", request.root.display()))
        .and_then(|metadata| {
            if is_link_or_reparse(&metadata) || !metadata.is_dir() {
                Err(format!("{} is not a directory", request.root.display()))
            } else {
                Ok(())
            }
        });
    if cancellation.is_cancelled() {
        let _ = send(SpaceScanEvent::Cancelled { task_id });
        return;
    }
    if let Err(message) = validation {
        let _ = send(SpaceScanEvent::Error { task_id, message });
        return;
    }
    let cache_path = crate::space_cache::path_for(&request.root);
    run_scan_with_cache(
        task_id,
        request,
        cancellation,
        cache_path,
        |root| crate::native_broker::native_space_stamp(root, cancellation).ok(),
        send,
    );
}

fn run_scan_with_cache<F, S>(
    task_id: u64,
    request: StartSpaceScanRequest,
    cancellation: &CancellationToken,
    cache_path: Option<PathBuf>,
    mut stamp: S,
    mut send: F,
) where
    F: FnMut(SpaceScanEvent) -> bool,
    S: FnMut(&std::path::Path) -> Option<String>,
{
    let root = request.root.clone();
    let depth = request.max_depth();
    let display_depth = request.display_depth();
    if !send(SpaceScanEvent::Started {
        task_id,
        root: root.clone(),
    }) {
        cancellation.cancel();
    }
    let before = if cancellation.is_cancelled() || cache_path.is_none() {
        None
    } else {
        stamp(&root)
    };
    if let (Some(path), Some(watermark)) = (&cache_path, &before)
        && let Some(cache) = crate::space_cache::load(path, &root, depth, display_depth, watermark)
    {
        let total_bytes = cache.nodes[0].bytes;
        for chunk in cache.nodes.chunks(request.batch_size()) {
            if cancellation.is_cancelled() {
                break;
            }
            if !send(SpaceScanEvent::Cached {
                task_id,
                items: chunk.to_vec(),
                total_bytes,
            }) {
                cancellation.cancel();
                break;
            }
        }
    }
    let mut measurements: HashMap<PathBuf, SpaceNode> = HashMap::new();
    let mut collect = before.is_some();
    let mut complete = false;
    run_space_scan_task(task_id, request, cancellation, |event| {
        match &event {
            SpaceScanEvent::Started { .. } => return true,
            SpaceScanEvent::Batch { items, .. } if collect => {
                for node in items {
                    measurements.insert(node.path.clone(), node.clone());
                    if measurements.len() > crate::space_cache::MAX_NODES {
                        collect = false;
                        measurements.clear();
                        break;
                    }
                }
            }
            SpaceScanEvent::Done {
                root,
                skipped_count,
                ..
            } => {
                complete = collect && *skipped_count == 0 && !root.partial;
                if complete {
                    measurements.insert(root.path.clone(), root.clone());
                }
            }
            _ => {}
        }
        send(event)
    });
    if complete
        && !cancellation.is_cancelled()
        && let (Some(path), Some(before)) = (cache_path, before)
        && stamp(&root).as_ref() == Some(&before)
        && !cancellation.is_cancelled()
    {
        let mut nodes: Vec<_> = measurements.into_values().collect();
        nodes.sort_unstable_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.path.cmp(&b.path)));
        if let Err(error) =
            crate::space_cache::save(&path, root, depth, display_depth, before, nodes)
        {
            log::debug!("Space preview cache skipped: {error}");
        }
    }
}

fn run_space_scan_task<F>(
    task_id: u64,
    request: StartSpaceScanRequest,
    cancellation: &CancellationToken,
    mut send: F,
) where
    F: FnMut(SpaceScanEvent) -> bool,
{
    if !send(SpaceScanEvent::Started {
        task_id,
        root: request.root.clone(),
    }) {
        cancellation.cancel();
    }
    let root = request.root.clone();
    let root_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| root.to_str().unwrap_or("/"));
    let root_node = SpaceNode {
        path: root.clone(),
        parent: None,
        name: root_name.to_owned(),
        kind: SpaceNodeKind::Directory,
        bytes: 0,
        modified_unix_ms: fs::symlink_metadata(&root)
            .ok()
            .as_ref()
            .and_then(modified_unix_ms),
        depth: 0,
        child_count: 0,
        partial: false,
        scanning: true,
    };
    let mut progress = ScanProgress {
        states: vec![NodeState {
            node: root_node,
            parent: None,
            dirty: true,
        }],
        dirty: vec![0],
        file_count: 0,
        directory_count: 0,
        skipped_count: 0,
        batch_size: request.batch_size(),
        display_depth: request.display_depth(),
        last_flush: Instant::now(),
    };
    let mut work = vec![Work::Enter(0)];
    progress.flush(task_id, cancellation, true, &mut send);

    while let Some(step) = work.pop() {
        if cancellation.is_cancelled() {
            let _ = send(SpaceScanEvent::Cancelled { task_id });
            return;
        }
        match step {
            Work::Enter(index) => {
                if progress.states[index].node.kind == SpaceNodeKind::Directory {
                    let path = progress.states[index].node.path.clone();
                    let depth = progress.states[index].node.depth;
                    if depth >= request.max_depth() {
                        progress.update_ancestors(Some(index), 0, true);
                        work.push(Work::Exit(index));
                        continue;
                    }
                    let entries = match fs::read_dir(&path) {
                        Ok(entries) => entries,
                        Err(error) => {
                            if index == 0 {
                                let _ = send(SpaceScanEvent::Error {
                                    task_id,
                                    message: format!("cannot read {}: {error}", path.display()),
                                });
                                return;
                            }
                            progress.skipped_count = progress.skipped_count.saturating_add(1);
                            progress.update_ancestors(Some(index), 0, true);
                            work.push(Work::Exit(index));
                            continue;
                        }
                    };
                    work.push(Work::Exit(index));
                    let mut children = Vec::new();
                    for entry in entries {
                        if cancellation.is_cancelled() {
                            let _ = send(SpaceScanEvent::Cancelled { task_id });
                            return;
                        }
                        let entry = match entry {
                            Ok(entry) => entry,
                            Err(_) => {
                                progress.skipped_count = progress.skipped_count.saturating_add(1);
                                progress.update_ancestors(Some(index), 0, true);
                                progress.flush(task_id, cancellation, false, &mut send);
                                continue;
                            }
                        };
                        // On Windows DirEntry metadata reuses enumeration data;
                        // unlike fs::metadata it never follows a symbolic link.
                        let metadata = match entry.metadata() {
                            Ok(metadata) => metadata,
                            Err(_) => {
                                progress.skipped_count = progress.skipped_count.saturating_add(1);
                                progress.update_ancestors(Some(index), 0, true);
                                progress.flush(task_id, cancellation, false, &mut send);
                                continue;
                            }
                        };
                        if is_link_or_reparse(&metadata) {
                            continue;
                        }
                        let kind = if metadata.is_dir() {
                            SpaceNodeKind::Directory
                        } else if metadata.is_file() {
                            SpaceNodeKind::File
                        } else {
                            continue;
                        };
                        let child_index = progress.states.len();
                        // Deep file records only contribute bytes/counts. They
                        // have no descendants and are outside the requested
                        // display, so retaining one state per file wastes RAM.
                        if kind == SpaceNodeKind::File
                            && depth.saturating_add(1) > progress.display_depth
                        {
                            progress.states[index].node.child_count =
                                progress.states[index].node.child_count.saturating_add(1);
                            progress.file_count = progress.file_count.saturating_add(1);
                            progress.update_ancestors(Some(index), metadata.len(), false);
                            progress.flush(task_id, cancellation, false, &mut send);
                            continue;
                        }
                        let child_path = entry.path();
                        let name = entry.file_name().to_string_lossy().into_owned();
                        let bytes = if kind == SpaceNodeKind::File {
                            metadata.len()
                        } else {
                            0
                        };
                        progress.states.push(NodeState {
                            node: SpaceNode {
                                path: child_path.clone(),
                                parent: Some(path.clone()),
                                name,
                                kind,
                                bytes,
                                modified_unix_ms: modified_unix_ms(&metadata),
                                depth: depth.saturating_add(1),
                                child_count: 0,
                                partial: false,
                                scanning: kind == SpaceNodeKind::Directory,
                            },
                            parent: Some(index),
                            dirty: false,
                        });
                        progress.mark_dirty(child_index);
                        progress.states[index].node.child_count =
                            progress.states[index].node.child_count.saturating_add(1);
                        progress.update_ancestors(Some(index), bytes, false);
                        if kind == SpaceNodeKind::File {
                            progress.file_count = progress.file_count.saturating_add(1);
                        } else {
                            progress.directory_count = progress.directory_count.saturating_add(1);
                            children.push(child_index);
                        }
                        progress.flush(task_id, cancellation, false, &mut send);
                    }
                    // Discover the root's children before traversing any child
                    // subtree, even when there are fewer than one full batch.
                    progress.flush(task_id, cancellation, index == 0, &mut send);
                    for child_index in children.into_iter().rev() {
                        work.push(Work::Enter(child_index));
                    }
                }
            }
            Work::Exit(index) => {
                progress.states[index].node.scanning = false;
                progress.mark_dirty(index);
                progress.flush(task_id, cancellation, false, &mut send);
            }
        }
    }
    if cancellation.is_cancelled() {
        let _ = send(SpaceScanEvent::Cancelled { task_id });
        return;
    }
    progress.flush(task_id, cancellation, true, &mut send);
    if cancellation.is_cancelled() {
        let _ = send(SpaceScanEvent::Cancelled { task_id });
        return;
    }
    let root = progress.states.remove(0).node;
    let _ = send(SpaceScanEvent::Done {
        task_id,
        total_bytes: root.bytes,
        root,
        file_count: progress.file_count,
        directory_count: progress.directory_count,
        skipped_count: progress.skipped_count,
    });
}

fn modified_unix_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::Mutex};
    use tempfile::tempdir;

    #[test]
    fn cached_preview_is_always_followed_by_fresh_measurements() {
        let fixture = tempdir().unwrap();
        let root = fixture.path().join("measured");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("old.txt"), b"old").unwrap();
        let cache = fixture.path().join("cache.json");
        let request = || StartSpaceScanRequest {
            root: root.clone(),
            batch_size: Some(2),
            max_depth: None,
            display_depth: None,
        };
        run_scan_with_cache(
            1,
            request(),
            &CancellationToken::default(),
            Some(cache.clone()),
            |_| Some("stamp".into()),
            |_| true,
        );
        assert!(cache.exists());
        fs::remove_file(root.join("old.txt")).unwrap();
        fs::write(root.join("new.txt"), b"replacement").unwrap();
        let mut events = Vec::new();
        run_scan_with_cache(
            2,
            request(),
            &CancellationToken::default(),
            Some(cache.clone()),
            |_| Some("stamp".into()),
            |event| {
                events.push(event);
                true
            },
        );
        assert!(events.iter().any(|event| matches!(event, SpaceScanEvent::Cached { items, .. } if items.iter().any(|node| node.name == "old.txt"))));
        assert!(events.iter().any(|event| matches!(event, SpaceScanEvent::Batch { items, .. } if items.iter().any(|node| node.name == "new.txt"))));
        assert!(matches!(
            events.last(),
            Some(SpaceScanEvent::Done {
                total_bytes: 11,
                ..
            })
        ));
        let saved = crate::space_cache::load(&cache, &root, MAX_DEPTH, MAX_DEPTH, "stamp").unwrap();
        assert!(!saved.nodes.iter().any(|node| node.name == "old.txt"));
        events.clear();
        run_scan_with_cache(
            3,
            request(),
            &CancellationToken::default(),
            Some(cache),
            |_| Some("changed".into()),
            |event| {
                events.push(event);
                true
            },
        );
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, SpaceScanEvent::Cached { .. }))
        );
    }

    #[test]
    fn cancelled_or_changing_scans_do_not_replace_cache() {
        let fixture = tempdir().unwrap();
        let cache = fixture.path().join("cache.json");
        let request = || StartSpaceScanRequest {
            root: fixture.path().to_path_buf(),
            batch_size: None,
            max_depth: None,
            display_depth: None,
        };
        let mut revision = 0;
        run_scan_with_cache(
            1,
            request(),
            &CancellationToken::default(),
            Some(cache.clone()),
            |_| {
                revision += 1;
                Some(revision.to_string())
            },
            |_| true,
        );
        assert!(!cache.exists());
        let token = CancellationToken::default();
        token.cancel();
        let mut events = Vec::new();
        run_scan_with_cache(
            2,
            request(),
            &token,
            Some(cache.clone()),
            |_| panic!("cancelled scan must not query index"),
            |event| {
                events.push(event);
                true
            },
        );
        assert!(!cache.exists());
        assert!(matches!(
            events.last(),
            Some(SpaceScanEvent::Cancelled { .. })
        ));
    }

    #[test]
    fn streams_nodes_and_done_with_recursive_sizes() {
        let directory = tempdir().expect("fixture");
        fs::create_dir(directory.path().join("nested")).expect("nested");
        fs::write(directory.path().join("root.txt"), b"root").expect("root");
        fs::write(directory.path().join("nested").join("child.txt"), b"nested").expect("child");
        let events = Mutex::new(Vec::new());
        run_space_scan_task(
            7,
            StartSpaceScanRequest {
                root: directory.path().to_path_buf(),
                batch_size: Some(1),
                max_depth: None,
                display_depth: None,
            },
            &CancellationToken::default(),
            |event| {
                lock_unpoisoned(&events).push(event);
                true
            },
        );
        let events = events.into_inner().expect("events");
        assert!(matches!(
            events.first(),
            Some(SpaceScanEvent::Started { task_id: 7, .. })
        ));
        let done = events
            .iter()
            .find_map(|event| {
                if let SpaceScanEvent::Done {
                    root,
                    total_bytes,
                    file_count,
                    directory_count,
                    ..
                } = event
                {
                    Some((root, *total_bytes, *file_count, *directory_count))
                } else {
                    None
                }
            })
            .expect("done");
        assert_eq!(done.0.bytes, 10);
        assert_eq!((done.1, done.2, done.3), (10, 2, 1));
        let nodes: HashMap<_, _> = events
            .iter()
            .filter_map(|event| match event {
                SpaceScanEvent::Batch { items, .. } => Some(items),
                _ => None,
            })
            .flatten()
            .map(|node| (&node.path, node))
            .collect();
        assert_eq!(nodes.len(), 4);
        for (relative_path, kind, bytes, relative_parent) in [
            ("root.txt", SpaceNodeKind::File, 4, ""),
            ("nested/child.txt", SpaceNodeKind::File, 6, "nested"),
            ("nested", SpaceNodeKind::Directory, 6, ""),
        ] {
            let expected_path = directory.path().join(relative_path);
            let node = nodes.get(&expected_path).expect("node upsert");
            assert_eq!(node.kind, kind);
            assert_eq!(node.bytes, bytes);
            let metadata = fs::symlink_metadata(&expected_path).expect("entry metadata");
            assert!(node.modified_unix_ms.is_some());
            if node.kind == SpaceNodeKind::File {
                assert_eq!(
                    node.modified_unix_ms,
                    modified_unix_ms(&metadata),
                    "timestamp for {relative_path}"
                );
            }
            assert_eq!(
                node.parent.as_ref(),
                Some(&directory.path().join(relative_parent))
            );
            assert!(!node.partial);
            assert!(!node.scanning);
        }
    }

    #[test]
    fn directory_containing_only_files_emits_tiles_before_done() {
        let directory = tempdir().expect("fixture");
        fs::write(directory.path().join("only.txt"), b"visible tile").expect("file");
        let mut events = Vec::new();
        run_space_scan_task(
            8,
            StartSpaceScanRequest {
                root: directory.path().to_path_buf(),
                batch_size: Some(128),
                max_depth: None,
                display_depth: None,
            },
            &CancellationToken::default(),
            |event| {
                events.push(event);
                true
            },
        );
        let done_index = events
            .iter()
            .position(|event| matches!(event, SpaceScanEvent::Done { .. }))
            .expect("done");
        let file = events[..done_index]
            .iter()
            .filter_map(|event| match event {
                SpaceScanEvent::Batch { items, .. } => Some(items),
                _ => None,
            })
            .flatten()
            .find(|node| node.path == directory.path().join("only.txt"))
            .expect("file tile before done");
        assert_eq!(file.kind, SpaceNodeKind::File);
        assert_eq!(file.bytes, 12);
        assert!(file.modified_unix_ms.is_some());
        let SpaceScanEvent::Done {
            root,
            file_count,
            directory_count,
            ..
        } = &events[done_index]
        else {
            unreachable!()
        };
        assert_eq!(root.bytes, 12);
        assert!(root.modified_unix_ms.is_some());
        assert_eq!((*file_count, *directory_count), (1, 0));
    }

    #[test]
    fn discovers_directories_and_streams_their_growth_before_completion() {
        let directory = tempdir().expect("fixture");
        let nested = directory.path().join("nested");
        fs::create_dir(&nested).expect("nested");
        for name in ["a", "b", "c"] {
            fs::write(nested.join(name), b"four").expect("file");
        }
        let mut events = Vec::new();
        run_space_scan_task(
            11,
            StartSpaceScanRequest {
                root: directory.path().to_path_buf(),
                batch_size: Some(1),
                max_depth: None,
                display_depth: None,
            },
            &CancellationToken::default(),
            |event| {
                events.push(event);
                true
            },
        );
        let updates: Vec<_> = events
            .iter()
            .filter_map(|event| match event {
                SpaceScanEvent::Batch { items, .. } => Some(items),
                _ => None,
            })
            .flatten()
            .filter(|node| node.path == nested)
            .collect();
        assert!(updates[0].scanning);
        assert_eq!(updates[0].bytes, 0, "directory is visible before traversal");
        let in_progress: Vec<_> = updates
            .iter()
            .filter(|node| node.scanning)
            .map(|node| node.bytes)
            .collect();
        assert_eq!(in_progress, [0, 4, 8, 12]);
        assert!(!updates.last().expect("completed directory").scanning);
        assert_eq!(updates.last().expect("completed directory").bytes, 12);
        assert!(matches!(
            events.last(),
            Some(SpaceScanEvent::Done {
                total_bytes: 12,
                file_count: 3,
                directory_count: 1,
                ..
            })
        ));
        let root_sizes: Vec<_> = events
            .iter()
            .filter_map(|event| match event {
                SpaceScanEvent::Batch { total_bytes, .. } => Some(*total_bytes),
                _ => None,
            })
            .collect();
        assert!(root_sizes.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(root_sizes.contains(&4) && root_sizes.contains(&8));
    }

    #[test]
    fn wide_directory_emits_during_enumeration_with_bounded_upserts() {
        let directory = tempdir().expect("fixture");
        for index in 0..300 {
            fs::write(directory.path().join(format!("{index}.txt")), b"x").expect("file");
        }
        let mut saw_partial_enumeration = false;
        let mut emitted_nodes = 0;
        run_space_scan_task(
            12,
            StartSpaceScanRequest {
                root: directory.path().to_path_buf(),
                batch_size: Some(32),
                max_depth: None,
                display_depth: None,
            },
            &CancellationToken::default(),
            |event| {
                if let SpaceScanEvent::Batch {
                    items,
                    file_count,
                    total_bytes,
                    ..
                } = event
                {
                    assert!(items.len() <= 32);
                    emitted_nodes += items.len();
                    assert_eq!(file_count, total_bytes);
                    if file_count > 0 && file_count < 300 {
                        saw_partial_enumeration = true;
                    }
                }
                true
            },
        );
        assert!(saw_partial_enumeration);
        assert!(emitted_nodes < 650, "no repeated whole-directory snapshots");
    }

    #[test]
    fn depth_limit_propagates_partial_separately_from_scanning() {
        let directory = tempdir().expect("fixture");
        fs::create_dir(directory.path().join("nested")).expect("nested");
        fs::write(directory.path().join("nested/hidden.txt"), b"hidden").expect("file");
        let mut events = Vec::new();
        run_space_scan_task(
            13,
            StartSpaceScanRequest {
                root: directory.path().to_path_buf(),
                batch_size: None,
                max_depth: Some(1),
                display_depth: None,
            },
            &CancellationToken::default(),
            |event| {
                events.push(event);
                true
            },
        );
        let Some(SpaceScanEvent::Done {
            root,
            file_count,
            total_bytes,
            ..
        }) = events.last()
        else {
            panic!("expected done");
        };
        assert!(root.partial);
        assert!(!root.scanning);
        assert_eq!((*file_count, *total_bytes), (0, 0));
        let final_nested = events
            .iter()
            .filter_map(|event| match event {
                SpaceScanEvent::Batch { items, .. } => Some(items),
                _ => None,
            })
            .flatten()
            .rfind(|node| node.depth == 1)
            .expect("nested");
        assert!(final_nested.partial);
        assert!(!final_nested.scanning);
    }

    #[test]
    fn cancelling_on_live_progress_never_publishes_done() {
        let directory = tempdir().expect("fixture");
        for name in ["first", "second", "third"] {
            fs::write(directory.path().join(name), b"data").expect("file");
        }
        let cancellation = CancellationToken::default();
        let mut events = Vec::new();
        run_space_scan_task(
            14,
            StartSpaceScanRequest {
                root: directory.path().to_path_buf(),
                batch_size: Some(1),
                max_depth: None,
                display_depth: None,
            },
            &cancellation,
            |event| {
                if matches!(event, SpaceScanEvent::Batch { file_count: 1, .. }) {
                    cancellation.cancel();
                }
                events.push(event);
                true
            },
        );
        assert!(matches!(
            events.last(),
            Some(SpaceScanEvent::Cancelled { .. })
        ));
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, SpaceScanEvent::Done { .. }))
        );
    }

    #[test]
    fn closed_channel_cancels_scanning_instead_of_publishing_done() {
        let directory = tempdir().expect("fixture");
        fs::write(directory.path().join("file"), b"data").expect("file");
        let cancellation = CancellationToken::default();
        let mut events = Vec::new();
        run_space_scan_task(
            15,
            StartSpaceScanRequest {
                root: directory.path().to_path_buf(),
                batch_size: None,
                max_depth: None,
                display_depth: None,
            },
            &cancellation,
            |event| {
                let accepted = !matches!(event, SpaceScanEvent::Batch { .. });
                events.push(event);
                accepted
            },
        );
        assert!(cancellation.is_cancelled());
        assert!(matches!(
            events.last(),
            Some(SpaceScanEvent::Cancelled { .. })
        ));
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, SpaceScanEvent::Done { .. }))
        );
    }

    #[test]
    fn cancellation_never_emits_done() {
        let directory = tempdir().expect("fixture");
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        let events = Mutex::new(Vec::new());
        run_space_scan_task(
            9,
            StartSpaceScanRequest {
                root: directory.path().to_path_buf(),
                batch_size: None,
                max_depth: None,
                display_depth: None,
            },
            &cancellation,
            |event| {
                lock_unpoisoned(&events).push(event);
                true
            },
        );
        let events = events.into_inner().expect("events");
        assert!(
            events
                .iter()
                .any(|event| matches!(event, SpaceScanEvent::Cancelled { task_id: 9 }))
        );
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, SpaceScanEvent::Done { .. }))
        );
    }

    #[test]
    fn manager_cancels_previous_task() {
        let manager = SpaceSnifferManager::default();
        let (first, token) = manager.begin();
        let (second, _) = manager.begin();
        assert_ne!(first, second);
        assert!(token.is_cancelled());
    }

    #[test]
    fn worker_reports_invalid_roots_and_cancels_superseded_validation() {
        let fixture = tempdir().expect("fixture");
        let missing = fixture.path().join("missing");
        let request = || StartSpaceScanRequest {
            root: missing.clone(),
            batch_size: None,
            max_depth: None,
            display_depth: Some(3),
        };
        let mut events = Vec::new();
        run_cached_space_scan(1, request(), &CancellationToken::default(), |event| {
            events.push(event);
            true
        });
        assert!(matches!(
            &events[..],
            [SpaceScanEvent::Error { task_id: 1, .. }]
        ));
        let manager = SpaceSnifferManager::default();
        let (old_id, cancelled) = manager.begin();
        let (new_id, current) = manager.begin();
        events.clear();
        run_cached_space_scan(old_id, request(), &cancelled, |event| {
            events.push(event);
            true
        });
        assert!(
            matches!(&events[..], [SpaceScanEvent::Cancelled { task_id }] if *task_id == old_id)
        );
        manager.finish(old_id);
        assert!(!current.is_cancelled());
        assert!(manager.cancel(new_id));
    }

    #[test]
    fn display_projection_reduces_payloads_without_truncating_recursive_measurements() {
        let fixture = tempdir().expect("fixture");
        let nested = fixture.path().join("one/two/three");
        fs::create_dir_all(&nested).expect("three levels");
        for index in 0..1000 {
            fs::write(nested.join(format!("file-{index}.bin")), b"full bytes").unwrap();
        }
        let mut projected = Vec::new();
        run_space_scan_task(
            21,
            StartSpaceScanRequest {
                root: fixture.path().to_path_buf(),
                batch_size: Some(256),
                max_depth: Some(64),
                display_depth: Some(3),
            },
            &CancellationToken::default(),
            |event| {
                projected.push(event);
                true
            },
        );
        let mut nodes = HashMap::new();
        let mut emitted = 0;
        for event in &projected {
            if let SpaceScanEvent::Batch { items, .. } = event {
                emitted += items.len();
                for node in items {
                    assert!(node.depth <= 3);
                    nodes.insert(&node.path, node);
                }
            }
        }
        assert_eq!(nodes.len(), 4);
        assert!(
            emitted < 100,
            "deep files must not cross IPC: {emitted} emitted nodes"
        );
        let deep = nodes.get(&nested).expect("last preview level");
        assert_eq!(deep.bytes, 10_000);
        assert_eq!(deep.child_count, 1000);
        assert!(!deep.partial && !deep.scanning);
        assert!(matches!(
            projected.last(),
            Some(SpaceScanEvent::Done {
                total_bytes: 10_000,
                file_count: 1000,
                directory_count: 3,
                skipped_count: 0,
                ..
            })
        ));
    }
}
