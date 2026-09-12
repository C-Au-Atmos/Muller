use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use muller_core::CancellationToken;
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

const DEFAULT_BATCH_SIZE: usize = 128;
const MAX_BATCH_SIZE: usize = 4096;
const MAX_DEPTH: u32 = 256;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartSpaceScanRequest {
    pub root: PathBuf,
    #[serde(default)]
    pub batch_size: Option<usize>,
    #[serde(default)]
    pub max_depth: Option<u32>,
}

impl StartSpaceScanRequest {
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceNode {
    pub path: PathBuf,
    pub parent: Option<PathBuf>,
    pub name: String,
    pub kind: SpaceNodeKind,
    pub bytes: u64,
    pub depth: u32,
    pub child_count: u32,
    pub partial: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
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
    let metadata = fs::symlink_metadata(&request.root)
        .map_err(|error| format!("cannot inspect {}: {error}", request.root.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{} is not a directory", request.root.display()));
    }
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        run_space_scan_task(task_id, request, &cancellation, |event| {
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
    children: Vec<usize>,
}

enum Work {
    Enter(usize),
    Exit(usize),
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
        depth: 0,
        child_count: 0,
        partial: false,
    };
    let mut states = vec![NodeState {
        node: root_node,
        children: Vec::new(),
    }];
    let mut work = vec![Work::Enter(0)];
    let mut batch = Vec::with_capacity(request.batch_size());
    let mut skipped_count = 0_u64;
    let mut file_count = 0_u64;
    let mut directory_count = 0_u64;

    while let Some(step) = work.pop() {
        if cancellation.is_cancelled() {
            let _ = send(SpaceScanEvent::Cancelled { task_id });
            return;
        }
        match step {
            Work::Enter(index) => {
                if states[index].node.kind == SpaceNodeKind::Directory {
                    let path = states[index].node.path.clone();
                    let depth = states[index].node.depth;
                    if depth >= request.max_depth() {
                        states[index].node.partial = true;
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
                            skipped_count = skipped_count.saturating_add(1);
                            states[index].node.partial = true;
                            work.push(Work::Exit(index));
                            continue;
                        }
                    };
                    work.push(Work::Exit(index));
                    let mut children = Vec::new();
                    for entry in entries.flatten() {
                        if cancellation.is_cancelled() {
                            let _ = send(SpaceScanEvent::Cancelled { task_id });
                            return;
                        }
                        let child_path = entry.path();
                        let metadata = match fs::symlink_metadata(&child_path) {
                            Ok(metadata) => metadata,
                            Err(_) => {
                                skipped_count = skipped_count.saturating_add(1);
                                continue;
                            }
                        };
                        if metadata.file_type().is_symlink() {
                            continue;
                        }
                        let kind = if metadata.is_dir() {
                            SpaceNodeKind::Directory
                        } else if metadata.is_file() {
                            SpaceNodeKind::File
                        } else {
                            continue;
                        };
                        let child_index = states.len();
                        let name = entry.file_name().to_string_lossy().into_owned();
                        states.push(NodeState {
                            node: SpaceNode {
                                path: child_path.clone(),
                                parent: Some(path.clone()),
                                name,
                                kind,
                                bytes: if kind == SpaceNodeKind::File {
                                    metadata.len()
                                } else {
                                    0
                                },
                                depth: depth.saturating_add(1),
                                child_count: 0,
                                partial: false,
                            },
                            children: Vec::new(),
                        });
                        children.push(child_index);
                        if kind == SpaceNodeKind::File {
                            file_count = file_count.saturating_add(1);
                        } else {
                            directory_count = directory_count.saturating_add(1);
                        }
                    }
                    states[index].children = children.clone();
                    for child_index in children.into_iter().rev() {
                        work.push(Work::Enter(child_index));
                    }
                }
            }
            Work::Exit(index) => {
                let (mut bytes, mut partial) = (
                    if states[index].node.kind == SpaceNodeKind::File {
                        states[index].node.bytes
                    } else {
                        0
                    },
                    states[index].node.partial,
                );
                for &child in &states[index].children {
                    bytes = bytes.saturating_add(states[child].node.bytes);
                    partial |= states[child].node.partial;
                }
                states[index].node.bytes = bytes;
                states[index].node.child_count = states[index].children.len() as u32;
                states[index].node.partial = partial;
                if index != 0 {
                    batch.push(states[index].node.clone());
                    if batch.len() >= request.batch_size() {
                        if !send(SpaceScanEvent::Batch {
                            task_id,
                            items: std::mem::take(&mut batch),
                        }) {
                            cancellation.cancel();
                        }
                    }
                }
            }
        }
    }
    if cancellation.is_cancelled() {
        let _ = send(SpaceScanEvent::Cancelled { task_id });
        return;
    }
    if !batch.is_empty()
        && !send(SpaceScanEvent::Batch {
            task_id,
            items: batch,
        })
    {
        cancellation.cancel();
        let _ = send(SpaceScanEvent::Cancelled { task_id });
        return;
    }
    let root = states.remove(0).node;
    let _ = send(SpaceScanEvent::Done {
        task_id,
        total_bytes: root.bytes,
        root,
        file_count,
        directory_count,
        skipped_count,
    });
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
                if let SpaceScanEvent::Done { root, .. } = event {
                    Some(root)
                } else {
                    None
                }
            })
            .expect("done");
        assert_eq!(done.bytes, 10);
        assert!(
            events
                .iter()
                .any(|event| matches!(event, SpaceScanEvent::Batch { .. }))
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
}
