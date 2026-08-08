use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use muller_core::CancellationToken;
use muller_diff::{
    BinaryDiffRange, DiffError, FileDiffKind, FilePairInspection, FolderDiffConfig,
    FolderDiffEntry, FolderDiffProgress, FolderDiffReport, FolderDiffStats, TextDiffReport,
    TextDiffRow, compare_folders_cancellable_with_progress, compare_text_files, inspect_file_pair,
    read_binary_diff_range,
};
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

const MAX_FOLDER_DIFF_PAGE_SIZE: usize = 256;
const MAX_TEXT_DIFF_PAGE_SIZE: usize = 512;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartFolderDiffRequest {
    left_root: PathBuf,
    right_root: PathBuf,
    #[serde(default)]
    treat_mtime_as_diff: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartFileDiffRequest {
    left_path: PathBuf,
    right_path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDiffResponse {
    task_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelDiffResponse {
    task_id: u64,
    cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FolderDiffEvent {
    Started {
        task_id: u64,
    },
    Progress {
        task_id: u64,
        progress: FolderDiffProgress,
    },
    Ready {
        task_id: u64,
        session_id: u64,
        total_entries: usize,
        issue_count: usize,
        stats: FolderDiffStats,
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
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FileDiffEvent {
    Started {
        task_id: u64,
    },
    Ready {
        task_id: u64,
        session_id: u64,
        inspection: FilePairInspection,
        total_rows: Option<usize>,
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
pub struct FolderDiffPageResponse {
    session_id: u64,
    offset: usize,
    total_entries: usize,
    entries: Vec<FolderDiffEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDiffPageResponse {
    session_id: u64,
    offset: usize,
    total_rows: usize,
    rows: Vec<TextDiffRow>,
}

#[derive(Debug)]
enum DiffSession {
    Folder(Arc<FolderDiffReport>),
    Text(Arc<TextDiffReport>),
    Binary(FilePairInspection),
}

#[derive(Debug, Default)]
struct DiffManagerInner {
    next_id: AtomicU64,
    active: Mutex<HashMap<u64, CancellationToken>>,
    sessions: Mutex<HashMap<u64, DiffSession>>,
}

#[derive(Debug, Clone, Default)]
pub struct DiffManager {
    inner: Arc<DiffManagerInner>,
}

impl DiffManager {
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

    fn store(&self, session_id: u64, session: DiffSession) {
        lock_unpoisoned(&self.inner.sessions).insert(session_id, session);
    }

    fn close(&self, session_id: u64) -> bool {
        lock_unpoisoned(&self.inner.sessions)
            .remove(&session_id)
            .is_some()
    }

    fn folder_page(
        &self,
        session_id: u64,
        offset: usize,
        limit: usize,
    ) -> Result<FolderDiffPageResponse, String> {
        let sessions = lock_unpoisoned(&self.inner.sessions);
        let DiffSession::Folder(report) = sessions
            .get(&session_id)
            .ok_or_else(|| format!("diff session {session_id} was not found"))?
        else {
            return Err(format!(
                "diff session {session_id} is not a folder comparison"
            ));
        };
        let total_entries = report.entries.len();
        let start = offset.min(total_entries);
        let end = start
            .saturating_add(limit.clamp(1, MAX_FOLDER_DIFF_PAGE_SIZE))
            .min(total_entries);
        Ok(FolderDiffPageResponse {
            session_id,
            offset: start,
            total_entries,
            entries: report.entries[start..end].to_vec(),
        })
    }

    fn text_page(
        &self,
        session_id: u64,
        offset: usize,
        limit: usize,
    ) -> Result<TextDiffPageResponse, String> {
        let sessions = lock_unpoisoned(&self.inner.sessions);
        let DiffSession::Text(report) = sessions
            .get(&session_id)
            .ok_or_else(|| format!("diff session {session_id} was not found"))?
        else {
            return Err(format!(
                "diff session {session_id} is not a text comparison"
            ));
        };
        let total_rows = report.rows.len();
        let start = offset.min(total_rows);
        let end = start
            .saturating_add(limit.clamp(1, MAX_TEXT_DIFF_PAGE_SIZE))
            .min(total_rows);
        Ok(TextDiffPageResponse {
            session_id,
            offset: start,
            total_rows,
            rows: report.rows[start..end].to_vec(),
        })
    }

    fn binary_range(
        &self,
        session_id: u64,
        offset: u64,
        length: usize,
    ) -> Result<BinaryDiffRange, String> {
        let sessions = lock_unpoisoned(&self.inner.sessions);
        let DiffSession::Binary(inspection) = sessions
            .get(&session_id)
            .ok_or_else(|| format!("diff session {session_id} was not found"))?
        else {
            return Err(format!(
                "diff session {session_id} is not a binary comparison"
            ));
        };
        read_binary_diff_range(
            &inspection.left_path,
            &inspection.right_path,
            offset,
            length,
            &CancellationToken::default(),
        )
        .map_err(|error| error.to_string())
    }

    fn find_difference(
        &self,
        session_id: u64,
        from: usize,
        direction: i8,
    ) -> Result<Option<usize>, String> {
        let sessions = lock_unpoisoned(&self.inner.sessions);
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| format!("diff session {session_id} was not found"))?;
        let result = match session {
            DiffSession::Folder(report) => {
                find_position(report.entries.len(), from, direction, |position| {
                    report.entries[position].status != muller_diff::FolderDiffStatus::Equal
                })
            }
            DiffSession::Text(report) => {
                find_position(report.rows.len(), from, direction, |position| {
                    report.rows[position].tag != muller_diff::TextDiffTag::Equal
                })
            }
            DiffSession::Binary(_) => None,
        };
        Ok(result)
    }
}

#[tauri::command]
pub fn start_folder_diff(
    manager: State<'_, DiffManager>,
    request: StartFolderDiffRequest,
    on_event: Channel<FolderDiffEvent>,
) -> StartDiffResponse {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(report) = prepare_folder_diff_task(task_id, request, &cancellation, |event| {
            on_event.send(event).is_ok()
        }) {
            let total_entries = report.entries.len();
            let issue_count = report.issues.len();
            let stats = report.stats.clone();
            manager.store(task_id, DiffSession::Folder(Arc::new(report)));
            if on_event
                .send(FolderDiffEvent::Ready {
                    task_id,
                    session_id: task_id,
                    total_entries,
                    issue_count,
                    stats,
                })
                .is_err()
            {
                manager.close(task_id);
            }
        }
        manager.finish(task_id);
    });
    StartDiffResponse { task_id }
}

#[tauri::command]
pub fn start_file_diff(
    manager: State<'_, DiffManager>,
    request: StartFileDiffRequest,
    on_event: Channel<FileDiffEvent>,
) -> StartDiffResponse {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some((session, inspection, total_rows)) =
            prepare_file_diff_task(task_id, request, &cancellation, |event| {
                on_event.send(event).is_ok()
            })
        {
            manager.store(task_id, session);
            if on_event
                .send(FileDiffEvent::Ready {
                    task_id,
                    session_id: task_id,
                    inspection,
                    total_rows,
                })
                .is_err()
            {
                manager.close(task_id);
            }
        }
        manager.finish(task_id);
    });
    StartDiffResponse { task_id }
}

#[tauri::command]
pub fn cancel_diff(manager: State<'_, DiffManager>, task_id: u64) -> CancelDiffResponse {
    CancelDiffResponse {
        task_id,
        cancelled: manager.cancel(task_id),
    }
}

#[tauri::command]
pub fn read_folder_diff_page(
    manager: State<'_, DiffManager>,
    session_id: u64,
    offset: usize,
    limit: usize,
) -> Result<FolderDiffPageResponse, String> {
    manager.folder_page(session_id, offset, limit)
}

#[tauri::command]
pub fn read_text_diff_page(
    manager: State<'_, DiffManager>,
    session_id: u64,
    offset: usize,
    limit: usize,
) -> Result<TextDiffPageResponse, String> {
    manager.text_page(session_id, offset, limit)
}

#[tauri::command]
pub fn read_binary_range(
    manager: State<'_, DiffManager>,
    session_id: u64,
    offset: u64,
    length: usize,
) -> Result<BinaryDiffRange, String> {
    manager.binary_range(session_id, offset, length)
}

#[tauri::command]
pub fn find_diff_position(
    manager: State<'_, DiffManager>,
    session_id: u64,
    from: usize,
    direction: i8,
) -> Result<Option<usize>, String> {
    manager.find_difference(session_id, from, direction)
}

#[tauri::command]
pub fn close_diff_session(manager: State<'_, DiffManager>, session_id: u64) -> bool {
    manager.close(session_id)
}

fn prepare_folder_diff_task<F>(
    task_id: u64,
    request: StartFolderDiffRequest,
    cancellation: &CancellationToken,
    send: F,
) -> Option<FolderDiffReport>
where
    F: Fn(FolderDiffEvent) -> bool,
{
    if !send(FolderDiffEvent::Started { task_id }) {
        cancellation.cancel();
    }
    let config = FolderDiffConfig::new(request.left_root, request.right_root)
        .with_mtime_as_diff(request.treat_mtime_as_diff);
    let result = compare_folders_cancellable_with_progress(&config, cancellation, |progress| {
        if !send(FolderDiffEvent::Progress {
            task_id,
            progress: progress.clone(),
        }) {
            cancellation.cancel();
        }
    });
    match result {
        Ok(report) if !cancellation.is_cancelled() => Some(report),
        Ok(_) | Err(DiffError::Cancelled) => {
            let _ = send(FolderDiffEvent::Cancelled { task_id });
            None
        }
        Err(error) => {
            let _ = send(FolderDiffEvent::Error {
                task_id,
                message: error.to_string(),
            });
            None
        }
    }
}

fn prepare_file_diff_task<F>(
    task_id: u64,
    request: StartFileDiffRequest,
    cancellation: &CancellationToken,
    send: F,
) -> Option<(DiffSession, FilePairInspection, Option<usize>)>
where
    F: Fn(FileDiffEvent) -> bool,
{
    if !send(FileDiffEvent::Started { task_id }) {
        cancellation.cancel();
    }
    let inspection = match inspect_file_pair(&request.left_path, &request.right_path, cancellation)
    {
        Ok(inspection) => inspection,
        Err(DiffError::Cancelled) => {
            let _ = send(FileDiffEvent::Cancelled { task_id });
            return None;
        }
        Err(error) => {
            let _ = send(FileDiffEvent::Error {
                task_id,
                message: error.to_string(),
            });
            return None;
        }
    };
    if cancellation.is_cancelled() {
        let _ = send(FileDiffEvent::Cancelled { task_id });
        return None;
    }

    let (session, inspection, total_rows) = match inspection.kind {
        FileDiffKind::Text => {
            match compare_text_files(&request.left_path, &request.right_path, cancellation) {
                Ok(report) => {
                    let total_rows = report.rows.len();
                    let inspection = report.inspection.clone();
                    (
                        DiffSession::Text(Arc::new(report)),
                        inspection,
                        Some(total_rows),
                    )
                }
                Err(DiffError::Cancelled) => {
                    let _ = send(FileDiffEvent::Cancelled { task_id });
                    return None;
                }
                Err(error) => {
                    let _ = send(FileDiffEvent::Error {
                        task_id,
                        message: error.to_string(),
                    });
                    return None;
                }
            }
        }
        FileDiffKind::Binary => (DiffSession::Binary(inspection.clone()), inspection, None),
    };
    if cancellation.is_cancelled() {
        let _ = send(FileDiffEvent::Cancelled { task_id });
        return None;
    }
    Some((session, inspection, total_rows))
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn find_position<F>(length: usize, from: usize, direction: i8, matches: F) -> Option<usize>
where
    F: Fn(usize) -> bool,
{
    if direction >= 0 {
        from.saturating_add(1).min(length)..length
    } else {
        0..from.min(length)
    }
    .filter(|position| matches(*position))
    .reduce(|left, right| {
        if direction >= 0 {
            left.min(right)
        } else {
            left.max(right)
        }
    })
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Mutex};

    use tempfile::tempdir;

    use super::{
        DiffManager, DiffSession, FileDiffEvent, FolderDiffEvent, StartFileDiffRequest,
        StartFolderDiffRequest, lock_unpoisoned, prepare_file_diff_task, prepare_folder_diff_task,
    };

    #[test]
    fn folder_task_streams_progress_before_ready_and_pages_the_session() {
        let fixture = tempdir().expect("fixture");
        let left = fixture.path().join("left");
        let right = fixture.path().join("right");
        fs::create_dir_all(&left).expect("left");
        fs::create_dir_all(&right).expect("right");
        fs::write(left.join("a.txt"), "left").expect("left file");
        fs::write(right.join("a.txt"), "right").expect("right file");
        let events = Mutex::new(Vec::new());
        let report = prepare_folder_diff_task(
            4,
            StartFolderDiffRequest {
                left_root: left,
                right_root: right,
                treat_mtime_as_diff: false,
            },
            &Default::default(),
            |event| {
                lock_unpoisoned(&events).push(event);
                true
            },
        )
        .expect("report");
        let manager = DiffManager::default();
        let total_entries = report.entries.len();
        let stats = report.stats.clone();
        manager.store(4, DiffSession::Folder(report.into()));
        lock_unpoisoned(&events).push(FolderDiffEvent::Ready {
            task_id: 4,
            session_id: 4,
            total_entries,
            issue_count: 0,
            stats,
        });
        let events = events.into_inner().expect("events");
        let ready = events
            .iter()
            .position(|event| matches!(event, FolderDiffEvent::Ready { .. }))
            .expect("ready");
        let progress = events
            .iter()
            .position(|event| matches!(event, FolderDiffEvent::Progress { .. }))
            .expect("progress");
        assert!(progress < ready);
        assert_eq!(manager.folder_page(4, 0, 1).expect("page").entries.len(), 1);
    }

    #[test]
    fn file_task_routes_text_and_serializes_the_event_contract() {
        let fixture = tempdir().expect("fixture");
        let left = fixture.path().join("left.txt");
        let right = fixture.path().join("right.txt");
        fs::write(&left, "a\n").expect("left");
        fs::write(&right, "b\n").expect("right");
        let events = Mutex::new(Vec::new());
        let (session, inspection, total_rows) = prepare_file_diff_task(
            8,
            StartFileDiffRequest {
                left_path: left,
                right_path: right,
            },
            &Default::default(),
            |event| {
                lock_unpoisoned(&events).push(event);
                true
            },
        )
        .expect("session");
        assert!(matches!(session, DiffSession::Text(_)));
        let manager = DiffManager::default();
        manager.store(8, session);
        assert!(
            manager
                .text_page(8, 0, usize::MAX)
                .expect("page")
                .rows
                .len()
                <= 512
        );
        lock_unpoisoned(&events).push(FileDiffEvent::Ready {
            task_id: 8,
            session_id: 8,
            inspection,
            total_rows,
        });
        let events = events.into_inner().expect("events");
        let ready = events
            .iter()
            .find(|event| matches!(event, FileDiffEvent::Ready { .. }))
            .expect("ready");
        let value = serde_json::to_value(ready).expect("serialize");
        assert_eq!(value["type"], "ready");
        assert_eq!(value["taskId"], 8);
        assert_eq!(value["inspection"]["kind"], "text");
        assert!(value["inspection"].get("left_path").is_some());
    }

    #[test]
    fn cancelled_file_task_never_emits_ready() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("file.txt");
        fs::write(&path, "text").expect("file");
        let cancellation = muller_core::CancellationToken::default();
        cancellation.cancel();
        let events = Mutex::new(Vec::new());
        let session = prepare_file_diff_task(
            9,
            StartFileDiffRequest {
                left_path: path.clone(),
                right_path: path,
            },
            &cancellation,
            |event| {
                lock_unpoisoned(&events).push(event);
                true
            },
        );
        assert!(session.is_none());
        assert!(
            !events
                .into_inner()
                .expect("events")
                .iter()
                .any(|event| matches!(event, FileDiffEvent::Ready { .. }))
        );
    }

    #[test]
    fn session_finds_differences_without_loading_intermediate_pages() {
        let fixture = tempdir().expect("fixture");
        let left = fixture.path().join("left.txt");
        let right = fixture.path().join("right.txt");
        fs::write(&left, "same\nleft\nsame\n").expect("left");
        fs::write(&right, "same\nright\nsame\n").expect("right");
        let (session, _, _) = prepare_file_diff_task(
            12,
            StartFileDiffRequest {
                left_path: left,
                right_path: right,
            },
            &Default::default(),
            |_| true,
        )
        .expect("session");
        let manager = DiffManager::default();
        manager.store(12, session);

        assert_eq!(manager.find_difference(12, 0, 1).expect("next"), Some(1));
        assert_eq!(
            manager.find_difference(12, 2, -1).expect("previous"),
            Some(1)
        );
        assert!(manager.cancel(12));
        assert!(manager.find_difference(12, 0, 1).is_err());
    }
}
