use std::{
    cell::Cell,
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use muller_core::{
    CancellationToken, DuplicateGroup, ProgressEvent, ScanConfig, ScanError, ScanStats,
    SkippedFile, scan_cancellable_with_progress_and_groups,
};
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartScanRequest {
    roots: Vec<PathBuf>,
    #[serde(default = "default_min_size")]
    min_size: u64,
    #[serde(default)]
    hash_threads: Option<usize>,
    #[serde(default)]
    blacklist: Vec<PathBuf>,
}

impl StartScanRequest {
    fn into_config(self) -> ScanConfig {
        let mut config = ScanConfig::new(self.roots).with_min_size(self.min_size);
        if let Some(threads) = self.hash_threads {
            config = config.with_hash_threads(threads);
        }
        for path in self.blacklist {
            config = config.with_blacklist_path(path);
        }
        config
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartScanResponse {
    task_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelScanResponse {
    task_id: u64,
    cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DesktopScanEvent {
    Started {
        task_id: u64,
    },
    Progress {
        task_id: u64,
        progress: ProgressEvent,
    },
    GroupFound {
        task_id: u64,
        group_index: u32,
        group: DuplicateGroup,
    },
    Done {
        task_id: u64,
        group_count: u32,
        group_order: Vec<String>,
        reclaimable_bytes: u64,
        skipped: Vec<SkippedFile>,
        stats: ScanStats,
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
struct ScanManagerInner {
    next_id: AtomicU64,
    active: Mutex<HashMap<u64, CancellationToken>>,
}

#[derive(Debug, Clone, Default)]
pub struct ScanManager {
    inner: Arc<ScanManagerInner>,
}

impl ScanManager {
    fn begin(&self) -> (u64, CancellationToken) {
        let task_id = self
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
        active.insert(task_id, token.clone());
        (task_id, token)
    }

    fn cancel(&self, task_id: u64) -> bool {
        let active = lock_unpoisoned(&self.inner.active);
        if let Some(token) = active.get(&task_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    fn finish(&self, task_id: u64) {
        lock_unpoisoned(&self.inner.active).remove(&task_id);
    }
}

#[tauri::command]
pub fn start_scan(
    manager: State<'_, ScanManager>,
    request: StartScanRequest,
    on_event: Channel<DesktopScanEvent>,
) -> Result<StartScanResponse, String> {
    if request.roots.is_empty() {
        return Err("at least one scan root is required".to_owned());
    }

    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        run_scan_task(task_id, request, &cancellation, |event| {
            on_event.send(event).is_ok()
        });
        manager.finish(task_id);
    });

    Ok(StartScanResponse { task_id })
}

#[tauri::command]
pub fn cancel_scan(manager: State<'_, ScanManager>, task_id: u64) -> CancelScanResponse {
    CancelScanResponse {
        task_id,
        cancelled: manager.cancel(task_id),
    }
}

fn run_scan_task<F>(
    task_id: u64,
    request: StartScanRequest,
    cancellation: &CancellationToken,
    send: F,
) where
    F: Fn(DesktopScanEvent) -> bool,
{
    if !send(DesktopScanEvent::Started { task_id }) {
        cancellation.cancel();
    }

    let config = request.into_config();
    let progressive_index = Cell::new(0_u32);
    let result = scan_cancellable_with_progress_and_groups(
        &config,
        cancellation,
        |progress| {
            if !send(DesktopScanEvent::Progress {
                task_id,
                progress: progress.clone(),
            }) {
                cancellation.cancel();
            }
        },
        |group| {
            let group_index = progressive_index.get();
            if !send(DesktopScanEvent::GroupFound {
                task_id,
                group_index,
                group: group.clone(),
            }) {
                cancellation.cancel();
            }
            progressive_index.set(group_index.saturating_add(1));
        },
    );

    match result {
        Ok(report) => {
            let group_count = report.groups.len() as u32;
            if cancellation.is_cancelled() {
                let _ = send(DesktopScanEvent::Cancelled { task_id });
                return;
            }
            let _ = send(DesktopScanEvent::Done {
                task_id,
                group_count,
                group_order: report.groups.iter().map(DuplicateGroup::hash_hex).collect(),
                reclaimable_bytes: report.reclaimable_bytes,
                skipped: report.skipped,
                stats: report.stats,
            });
        }
        Err(ScanError::Cancelled) => {
            let _ = send(DesktopScanEvent::Cancelled { task_id });
        }
        Err(error) => {
            let _ = send(DesktopScanEvent::Error {
                task_id,
                message: error.to_string(),
            });
        }
    }
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

const fn default_min_size() -> u64 {
    1
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Mutex};

    use tempfile::tempdir;

    use super::{DesktopScanEvent, ScanManager, StartScanRequest, lock_unpoisoned, run_scan_task};

    #[test]
    fn starting_a_new_scan_cancels_and_retires_the_previous_token() {
        let manager = ScanManager::default();
        let (first_id, first) = manager.begin();
        let (second_id, second) = manager.begin();

        assert_ne!(first_id, second_id);
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
        assert!(!manager.cancel(first_id));
        assert!(manager.cancel(second_id));
    }

    #[test]
    fn scan_task_streams_group_before_done() {
        let directory = tempdir().expect("temporary directory");
        fs::write(directory.path().join("a.bin"), b"same").expect("write fixture");
        fs::write(directory.path().join("b.bin"), b"same").expect("write fixture");
        let events = Mutex::new(Vec::new());

        run_scan_task(
            7,
            StartScanRequest {
                roots: vec![directory.path().to_path_buf()],
                min_size: 1,
                hash_threads: Some(2),
                blacklist: Vec::new(),
            },
            &Default::default(),
            |event| {
                lock_unpoisoned(&events).push(event);
                true
            },
        );

        let events = events.into_inner().expect("events");
        assert!(matches!(
            events.first(),
            Some(DesktopScanEvent::Started { task_id: 7 })
        ));
        let group_index = events
            .iter()
            .position(|event| matches!(event, DesktopScanEvent::GroupFound { .. }))
            .expect("group event");
        let done_index = events
            .iter()
            .position(|event| matches!(event, DesktopScanEvent::Done { .. }))
            .expect("done event");
        assert!(group_index < done_index);
    }

    #[test]
    fn cancelled_task_never_emits_done() {
        let directory = tempdir().expect("temporary directory");
        let cancellation = muller_core::CancellationToken::default();
        cancellation.cancel();
        let events = Mutex::new(Vec::new());

        run_scan_task(
            9,
            StartScanRequest {
                roots: vec![directory.path().to_path_buf()],
                min_size: 1,
                hash_threads: None,
                blacklist: Vec::new(),
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
                .any(|event| matches!(event, DesktopScanEvent::Cancelled { task_id: 9 }))
        );
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, DesktopScanEvent::Done { .. }))
        );
    }

    #[test]
    fn event_envelope_is_camel_case_while_core_progress_stays_snake_case() {
        let value = serde_json::to_value(DesktopScanEvent::Progress {
            task_id: 11,
            progress: muller_core::ProgressEvent {
                phase: muller_core::ScanPhase::FullHashing,
                processed: 2,
                total: Some(4),
                candidate_files: 4,
                bytes_read: 1024,
            },
        })
        .expect("serialize event");

        assert_eq!(value["type"], "progress");
        assert_eq!(value["taskId"], 11);
        assert_eq!(value["progress"]["phase"], "full_hashing");
        assert_eq!(value["progress"]["candidate_files"], 4);
        assert!(value["progress"].get("candidateFiles").is_none());
    }
}
