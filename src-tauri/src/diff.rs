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
    FolderDiffEntry, FolderDiffProgress, FolderDiffReport, FolderDiffStats, FolderDiffStatus,
    TextDiffReport, TextDiffRow, compare_folders_cancellable_with_progress, compare_text_files,
    inspect_file_pair, read_binary_diff_range,
};
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

const MAX_FOLDER_DIFF_PAGE_SIZE: usize = 256;
const MAX_TEXT_DIFF_PAGE_SIZE: usize = 512;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderDiffFilter {
    #[default]
    All,
    Differences,
    Different,
    Added,
    Deleted,
    Time,
    Same,
    Error,
}

impl FolderDiffFilter {
    fn matches(self, entry: &FolderDiffEntry) -> bool {
        match self {
            Self::All => true,
            Self::Differences => entry.status != FolderDiffStatus::Equal,
            Self::Different => entry.status == FolderDiffStatus::Different,
            Self::Added => entry.status == FolderDiffStatus::RightOnly,
            Self::Deleted => entry.status == FolderDiffStatus::LeftOnly,
            Self::Time => entry
                .left
                .as_ref()
                .and_then(|side| side.modified_unix_ms)
                .zip(entry.right.as_ref().and_then(|side| side.modified_unix_ms))
                .is_some_and(|(left, right)| left != right),
            Self::Same => entry.status == FolderDiffStatus::Equal,
            Self::Error => entry.status == FolderDiffStatus::Error,
        }
    }
}

#[derive(Debug, Default)]
struct FolderProjection {
    filter: FolderDiffFilter,
    indices: Vec<usize>,
}

#[derive(Debug)]
struct FolderDiffSession {
    // Retain one canonical report. Strict time mode is a presentation of metadata-only
    // rows, so the content/type filter remains meaningful in either mode.
    report: FolderDiffReport,
    treat_mtime_as_diff: bool,
    projection: Mutex<FolderProjection>,
}

impl FolderDiffSession {
    fn new(report: FolderDiffReport, treat_mtime_as_diff: bool) -> Self {
        Self {
            report,
            treat_mtime_as_diff,
            projection: Mutex::default(),
        }
    }

    fn stats(&self) -> FolderDiffStats {
        let mut stats = self.report.stats.clone();
        if self.treat_mtime_as_diff {
            stats.different = stats.different.saturating_add(stats.metadata_only);
            stats.metadata_only = 0;
        }
        stats
    }

    fn project(&self, filter: FolderDiffFilter) -> std::sync::MutexGuard<'_, FolderProjection> {
        let mut projection = lock_unpoisoned(&self.projection);
        if projection.filter != filter {
            // A single index, bounded by report.entries.len(); never cache an index
            // per filter or clone the report. All needs no derived storage at all.
            projection.indices.clear();
            if filter == FolderDiffFilter::All {
                projection.indices = Vec::new();
            } else {
                for (position, entry) in self.report.entries.iter().enumerate() {
                    if filter.matches(entry) {
                        projection.indices.push(position);
                    }
                }
            }
            projection.filter = filter;
        }
        projection
    }

    fn entry_at(&self, projection: &FolderProjection, position: usize) -> &FolderDiffEntry {
        let source = if projection.filter == FolderDiffFilter::All {
            position
        } else {
            projection.indices[position]
        };
        &self.report.entries[source]
    }

    fn projected_len(&self, projection: &FolderProjection) -> usize {
        if projection.filter == FolderDiffFilter::All {
            self.report.entries.len()
        } else {
            projection.indices.len()
        }
    }

    fn presented_entry(&self, entry: &FolderDiffEntry) -> FolderDiffEntry {
        let mut entry = entry.clone();
        if self.treat_mtime_as_diff && entry.status == FolderDiffStatus::MetadataOnly {
            entry.status = FolderDiffStatus::Different;
        }
        entry
    }

    fn page(
        &self,
        session_id: u64,
        offset: usize,
        limit: usize,
        filter: FolderDiffFilter,
    ) -> FolderDiffPageResponse {
        let projection = self.project(filter);
        let total_entries = self.projected_len(&projection);
        let start = offset.min(total_entries);
        let end = start
            .saturating_add(limit.clamp(1, MAX_FOLDER_DIFF_PAGE_SIZE))
            .min(total_entries);
        FolderDiffPageResponse {
            session_id,
            offset: start,
            total_entries,
            filter,
            entries: (start..end)
                .map(|position| self.presented_entry(self.entry_at(&projection, position)))
                .collect(),
        }
    }

    fn find_difference(
        &self,
        from: usize,
        direction: i8,
        filter: FolderDiffFilter,
    ) -> Option<usize> {
        let projection = self.project(filter);
        find_position(
            self.projected_len(&projection),
            from,
            direction,
            |position| {
                filter == FolderDiffFilter::Time
                    || self.entry_at(&projection, position).status != FolderDiffStatus::Equal
            },
        )
    }
}

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
    filter: FolderDiffFilter,
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

#[derive(Debug, Clone)]
enum DiffSession {
    Folder(Arc<FolderDiffSession>),
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

    #[cfg(test)]
    fn store(&self, session_id: u64, session: DiffSession) {
        lock_unpoisoned(&self.inner.sessions).insert(session_id, session);
    }

    fn complete(&self, task_id: u64, session: DiffSession) -> bool {
        // Serialize publication against cancellation. Otherwise a task cancelled
        // just after comparison could resurrect its already-closed session.
        let mut active = lock_unpoisoned(&self.inner.active);
        if active
            .get(&task_id)
            .is_none_or(|cancellation| cancellation.is_cancelled())
        {
            return false;
        }
        lock_unpoisoned(&self.inner.sessions).insert(task_id, session);
        active.remove(&task_id);
        true
    }

    fn close(&self, session_id: u64) -> bool {
        lock_unpoisoned(&self.inner.sessions)
            .remove(&session_id)
            .is_some()
    }

    fn session(&self, session_id: u64) -> Result<DiffSession, String> {
        lock_unpoisoned(&self.inner.sessions)
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("diff session {session_id} was not found"))
    }

    fn folder_page(
        &self,
        session_id: u64,
        offset: usize,
        limit: usize,
        filter: FolderDiffFilter,
    ) -> Result<FolderDiffPageResponse, String> {
        let DiffSession::Folder(session) = self.session(session_id)? else {
            return Err(format!(
                "diff session {session_id} is not a folder comparison"
            ));
        };
        Ok(session.page(session_id, offset, limit, filter))
    }

    fn text_page(
        &self,
        session_id: u64,
        offset: usize,
        limit: usize,
    ) -> Result<TextDiffPageResponse, String> {
        let DiffSession::Text(report) = self.session(session_id)? else {
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
        let DiffSession::Binary(inspection) = self.session(session_id)? else {
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
        filter: FolderDiffFilter,
    ) -> Result<Option<usize>, String> {
        let session = self.session(session_id)?;
        let result = match session {
            DiffSession::Folder(session) => session.find_difference(from, direction, filter),
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
    let treat_mtime_as_diff = request.treat_mtime_as_diff;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(report) = prepare_folder_diff_task(task_id, request, &cancellation, |event| {
            on_event.send(event).is_ok()
        }) {
            let total_entries = report.entries.len();
            let issue_count = report.issues.len();
            let session = FolderDiffSession::new(report, treat_mtime_as_diff);
            let stats = session.stats();
            if !manager.complete(task_id, DiffSession::Folder(Arc::new(session))) {
                let _ = on_event.send(FolderDiffEvent::Cancelled { task_id });
            } else if on_event
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
            if !manager.complete(task_id, session) {
                let _ = on_event.send(FileDiffEvent::Cancelled { task_id });
            } else if on_event
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
pub async fn read_folder_diff_page(
    manager: State<'_, DiffManager>,
    session_id: u64,
    offset: usize,
    limit: usize,
    filter: Option<FolderDiffFilter>,
) -> Result<FolderDiffPageResponse, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.folder_page(session_id, offset, limit, filter.unwrap_or_default())
    })
    .await
    .map_err(|error| error.to_string())?
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
pub async fn find_diff_position(
    manager: State<'_, DiffManager>,
    session_id: u64,
    from: usize,
    direction: i8,
    filter: Option<FolderDiffFilter>,
) -> Result<Option<usize>, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.find_difference(session_id, from, direction, filter.unwrap_or_default())
    })
    .await
    .map_err(|error| error.to_string())?
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
    // Keep metadata-only identity in the sole report even in strict mode. The
    // session projects its public status/stats without another filesystem pass.
    let config = FolderDiffConfig::new(request.left_root, request.right_root);
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
        (from.saturating_add(1).min(length)..length).find(|position| matches(*position))
    } else {
        (0..from.min(length))
            .rev()
            .find(|position| matches(*position))
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Mutex};

    use tempfile::tempdir;

    use super::{
        DiffManager, DiffSession, FileDiffEvent, FolderDiffEvent, FolderDiffFilter,
        FolderDiffSession, StartFileDiffRequest, StartFolderDiffRequest, lock_unpoisoned,
        prepare_file_diff_task, prepare_folder_diff_task,
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
        manager.store(
            4,
            DiffSession::Folder(FolderDiffSession::new(report, false).into()),
        );
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
        assert_eq!(
            manager
                .folder_page(4, 0, 1, FolderDiffFilter::All)
                .expect("page")
                .entries
                .len(),
            1
        );
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

        assert_eq!(
            manager
                .find_difference(12, 0, 1, FolderDiffFilter::All)
                .expect("next"),
            Some(1)
        );
        assert_eq!(
            manager
                .find_difference(12, 2, -1, FolderDiffFilter::All)
                .expect("previous"),
            Some(1)
        );
        assert!(manager.cancel(12));
        assert!(
            manager
                .find_difference(12, 0, 1, FolderDiffFilter::All)
                .is_err()
        );
    }

    fn folder_entry(
        position: usize,
        status: muller_diff::FolderDiffStatus,
        left_time: Option<u64>,
        right_time: Option<u64>,
    ) -> muller_diff::FolderDiffEntry {
        use muller_diff::{FolderDiffStatus, FolderEntryKind, FolderSide};
        muller_diff::FolderDiffEntry {
            relative_path: format!("{position:06}.txt").into(),
            kind: FolderEntryKind::File,
            left: (status != FolderDiffStatus::RightOnly).then(|| FolderSide {
                path: format!("left/{position:06}.txt").into(),
                size: 1,
                modified_unix_ms: left_time,
            }),
            right: (status != FolderDiffStatus::LeftOnly).then(|| FolderSide {
                path: format!("right/{position:06}.txt").into(),
                size: 1,
                modified_unix_ms: right_time,
            }),
            status,
            error: (status == FolderDiffStatus::Error).then(|| "unreadable".into()),
        }
    }

    fn folder_report(entries: Vec<muller_diff::FolderDiffEntry>) -> muller_diff::FolderDiffReport {
        use muller_diff::{FolderDiffStats, FolderDiffStatus};
        let mut stats = FolderDiffStats {
            total_entries: entries.len() as u64,
            ..Default::default()
        };
        for entry in &entries {
            let count = match entry.status {
                FolderDiffStatus::Equal => &mut stats.equal,
                FolderDiffStatus::MetadataOnly => &mut stats.metadata_only,
                FolderDiffStatus::Different => &mut stats.different,
                FolderDiffStatus::LeftOnly => &mut stats.left_only,
                FolderDiffStatus::RightOnly => &mut stats.right_only,
                FolderDiffStatus::Error => &mut stats.errors,
            };
            *count += 1;
        }
        muller_diff::FolderDiffReport {
            left_root: "left".into(),
            right_root: "right".into(),
            entries,
            issues: vec![],
            stats,
        }
    }

    #[test]
    fn folder_filters_keep_direction_and_actual_time_independent_of_strict_mode() {
        use muller_diff::{FolderDiffStatus as Status, FolderEntryKind};
        for strict in [false, true] {
            let mut entries = vec![
                folder_entry(0, Status::Equal, Some(10), Some(10)),
                folder_entry(1, Status::MetadataOnly, Some(10), Some(11)),
                folder_entry(2, Status::Different, Some(10), Some(11)),
                folder_entry(3, Status::Different, Some(10), Some(10)),
                folder_entry(4, Status::LeftOnly, Some(10), None),
                folder_entry(5, Status::RightOnly, None, Some(10)),
                folder_entry(6, Status::Error, Some(10), Some(10)),
                folder_entry(7, Status::Equal, Some(10), Some(11)),
                folder_entry(8, Status::Equal, None, Some(11)),
            ];
            entries[7].kind = FolderEntryKind::Directory;
            let session = FolderDiffSession::new(folder_report(entries), strict);
            for (filter, expected) in [
                (FolderDiffFilter::All, vec![0, 1, 2, 3, 4, 5, 6, 7, 8]),
                (FolderDiffFilter::Differences, vec![1, 2, 3, 4, 5, 6]),
                (FolderDiffFilter::Different, vec![2, 3]),
                (FolderDiffFilter::Added, vec![5]),
                (FolderDiffFilter::Deleted, vec![4]),
                (FolderDiffFilter::Time, vec![1, 2, 7]),
                (FolderDiffFilter::Same, vec![0, 7, 8]),
                (FolderDiffFilter::Error, vec![6]),
            ] {
                let page = session.page(1, 0, usize::MAX, filter);
                assert_eq!(page.filter, filter);
                assert_eq!(page.total_entries, expected.len());
                assert_eq!(
                    page.entries
                        .iter()
                        .map(|entry| entry.relative_path.clone())
                        .collect::<Vec<_>>(),
                    expected
                        .into_iter()
                        .map(|position| format!("{position:06}.txt").into())
                        .collect::<Vec<std::path::PathBuf>>()
                );
            }
            let page = session.page(1, 0, 10, FolderDiffFilter::All);
            assert_eq!(
                page.entries[1].status,
                if strict {
                    Status::Different
                } else {
                    Status::MetadataOnly
                }
            );
            let stats = session.stats();
            assert_eq!(stats.different, if strict { 3 } else { 2 });
            assert_eq!(stats.metadata_only, if strict { 0 } else { 1 });
            assert_eq!(session.report.entries[1].status, Status::MetadataOnly);
            // Directories retain the core Equal status, but are still relevant
            // targets when navigating actual modification-time mismatches.
            assert_eq!(
                session.find_difference(1, 1, FolderDiffFilter::Time),
                Some(2)
            );
            assert_eq!(
                session.find_difference(2, -1, FolderDiffFilter::Time),
                Some(1)
            );
        }
    }

    #[test]
    fn folder_filter_pages_and_navigation_use_the_same_complete_order() {
        use muller_diff::FolderDiffStatus as Status;
        let report = folder_report(
            (0..600)
                .map(|position| {
                    folder_entry(
                        position,
                        if position % 2 == 0 {
                            Status::Equal
                        } else {
                            Status::RightOnly
                        },
                        Some(1),
                        Some(1),
                    )
                })
                .collect(),
        );
        let manager = DiffManager::default();
        manager.store(
            2,
            DiffSession::Folder(FolderDiffSession::new(report, false).into()),
        );
        let page = manager
            .folder_page(2, 128, 128, FolderDiffFilter::Added)
            .expect("middle page");
        assert_eq!(page.total_entries, 300);
        assert_eq!(page.offset, 128);
        assert_eq!(
            page.entries[0].relative_path.to_string_lossy(),
            "000257.txt"
        );
        assert_eq!(
            page.entries[127].relative_path.to_string_lossy(),
            "000511.txt"
        );
        assert_eq!(
            manager
                .find_difference(2, 127, 1, FolderDiffFilter::Added)
                .expect("next"),
            Some(128)
        );
        assert_eq!(
            manager
                .find_difference(2, 256, -1, FolderDiffFilter::Added)
                .expect("previous"),
            Some(255)
        );
        assert_eq!(
            manager
                .find_difference(2, 299, 1, FolderDiffFilter::Added)
                .expect("end"),
            None
        );
        assert_eq!(
            manager
                .find_difference(2, 10, 1, FolderDiffFilter::Same)
                .expect("same"),
            None
        );
        assert_eq!(
            manager
                .find_difference(2, 128, 1, FolderDiffFilter::All)
                .expect("all"),
            Some(129)
        );
        let empty = manager
            .folder_page(2, usize::MAX, usize::MAX, FolderDiffFilter::Time)
            .expect("empty");
        assert_eq!(empty.total_entries, 0);
        assert_eq!(empty.offset, 0);
        assert!(empty.entries.is_empty());
        let capped = manager
            .folder_page(2, 0, usize::MAX, FolderDiffFilter::All)
            .expect("capped");
        assert_eq!(capped.entries.len(), 256);
        let end = manager
            .folder_page(2, usize::MAX, 0, FolderDiffFilter::Added)
            .expect("beyond end");
        assert_eq!(end.offset, 300);
        assert!(end.entries.is_empty());
    }

    #[test]
    fn large_folder_retains_one_current_projection_and_reuses_it_between_pages() {
        use muller_diff::FolderDiffStatus as Status;
        let report = folder_report(
            (0..100_000)
                .map(|position| {
                    folder_entry(
                        position,
                        if position % 2 == 0 {
                            Status::LeftOnly
                        } else {
                            Status::RightOnly
                        },
                        None,
                        None,
                    )
                })
                .collect(),
        );
        let session = FolderDiffSession::new(report, false);
        let started = std::time::Instant::now();
        assert_eq!(
            session
                .page(3, 0, 128, FolderDiffFilter::Added)
                .total_entries,
            50_000
        );
        let first_projection = started.elapsed();
        let index_pointer = lock_unpoisoned(&session.projection).indices.as_ptr();
        let repeated = std::time::Instant::now();
        for offset in (128..2048).step_by(128) {
            let page = session.page(3, offset, 128, FolderDiffFilter::Added);
            assert_eq!(page.entries.len(), 128);
            let projection = lock_unpoisoned(&session.projection);
            assert_eq!(projection.indices.len(), 50_000);
            assert_eq!(projection.indices.as_ptr(), index_pointer);
        }
        let repeated_pages = repeated.elapsed();
        let index_bytes =
            lock_unpoisoned(&session.projection).indices.capacity() * std::mem::size_of::<usize>();
        assert_eq!(
            session
                .page(3, 0, 128, FolderDiffFilter::Deleted)
                .total_entries,
            50_000
        );
        assert_eq!(lock_unpoisoned(&session.projection).indices.len(), 50_000);
        assert_eq!(
            session.page(3, 0, 128, FolderDiffFilter::All).total_entries,
            100_000
        );
        let projection = lock_unpoisoned(&session.projection);
        assert!(projection.indices.is_empty());
        assert_eq!(projection.indices.capacity(), 0);
        eprintln!(
            "folder-filter fixture=100000 matches=50000 first_projection_us={} repeated_15_pages_us={} index_capacity_bytes={} all_index_bytes=0",
            first_projection.as_micros(),
            repeated_pages.as_micros(),
            index_bytes
        );
    }

    #[test]
    fn actual_strict_folder_comparison_keeps_time_only_out_of_content_filter() {
        use std::time::{Duration, UNIX_EPOCH};
        let fixture = tempdir().expect("fixture");
        let left = fixture.path().join("left");
        let right = fixture.path().join("right");
        fs::create_dir(&left).expect("left");
        fs::create_dir(&right).expect("right");
        for (root, seconds) in [(&left, 10), (&right, 20)] {
            let path = root.join("same.txt");
            fs::write(&path, "same bytes").expect("file");
            fs::File::options()
                .write(true)
                .open(path)
                .expect("open")
                .set_modified(UNIX_EPOCH + Duration::from_secs(seconds))
                .expect("mtime");
        }
        let report = prepare_folder_diff_task(
            5,
            StartFolderDiffRequest {
                left_root: left,
                right_root: right,
                treat_mtime_as_diff: true,
            },
            &Default::default(),
            |_| true,
        )
        .expect("comparison");
        let session = FolderDiffSession::new(report, true);
        assert_eq!(session.stats().different, 1);
        assert_eq!(session.stats().metadata_only, 0);
        assert_eq!(
            session
                .page(5, 0, 128, FolderDiffFilter::Different)
                .total_entries,
            0
        );
        let page = session.page(5, 0, 128, FolderDiffFilter::Time);
        assert_eq!(page.total_entries, 1);
        assert_eq!(
            page.entries[0].status,
            muller_diff::FolderDiffStatus::Different
        );
    }

    #[test]
    fn concurrent_filter_requests_each_return_the_requested_order() {
        use muller_diff::FolderDiffStatus as Status;
        let session = std::sync::Arc::new(FolderDiffSession::new(
            folder_report(
                (0..1000)
                    .map(|position| {
                        folder_entry(
                            position,
                            if position % 2 == 0 {
                                Status::LeftOnly
                            } else {
                                Status::RightOnly
                            },
                            None,
                            None,
                        )
                    })
                    .collect(),
            ),
            false,
        ));
        std::thread::scope(|scope| {
            for (filter, status) in [
                (FolderDiffFilter::Added, Status::RightOnly),
                (FolderDiffFilter::Deleted, Status::LeftOnly),
            ] {
                let session = session.clone();
                scope.spawn(move || {
                    for offset in (0..500).step_by(32).cycle().take(64) {
                        let page = session.page(1, offset, 32, filter);
                        assert_eq!(page.filter, filter);
                        assert_eq!(page.total_entries, 500);
                        assert!(page.entries.iter().all(|entry| entry.status == status));
                    }
                });
            }
        });
    }

    #[test]
    fn cancellation_cannot_resurrect_a_session_when_comparison_completes() {
        let manager = DiffManager::default();
        let session =
            || DiffSession::Folder(FolderDiffSession::new(folder_report(vec![]), false).into());
        let (cancelled, _) = manager.begin();
        assert!(manager.cancel(cancelled));
        assert!(!manager.complete(cancelled, session()));
        assert!(manager.session(cancelled).is_err());
        manager.finish(cancelled);
        let (completed, _) = manager.begin();
        assert!(manager.complete(completed, session()));
        assert!(manager.cancel(completed));
        assert!(manager.session(completed).is_err());
    }

    #[test]
    fn difference_navigation_stops_at_first_match_in_either_direction() {
        let inspected = std::cell::Cell::new(0);
        let matches = |_| {
            inspected.set(inspected.get() + 1);
            true
        };
        assert_eq!(super::find_position(100_000, 10, 1, matches), Some(11));
        assert_eq!(inspected.get(), 1);
        inspected.set(0);
        assert_eq!(super::find_position(100_000, 10, -1, matches), Some(9));
        assert_eq!(inspected.get(), 1);
    }
}
