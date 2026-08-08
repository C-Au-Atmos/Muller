use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use muller_core::CancellationToken;
use muller_mutate::{
    EditableDocument, EditableDocumentInfo, MutationPolicy, RecycleCandidate, RecycleReport,
    RollbackReport, SaveReport, SystemRecycler, open_document, recycle_candidates,
    rollback_document, save_document,
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditSide {
    Left,
    Right,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenEditSessionRequest {
    left_path: PathBuf,
    right_path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenEditSessionResponse {
    session_id: u64,
    left: EditableDocumentInfo,
    right: EditableDocumentInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveEditSideRequest {
    session_id: u64,
    side: EditSide,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackEditSideRequest {
    session_id: u64,
    side: EditSide,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecycleDuplicatesRequest {
    confirmed: bool,
    candidates: Vec<RecycleCandidate>,
}

#[derive(Debug)]
struct EditPair {
    left: EditableDocument,
    right: EditableDocument,
}

impl EditPair {
    fn document_mut(&mut self, side: EditSide) -> &mut EditableDocument {
        match side {
            EditSide::Left => &mut self.left,
            EditSide::Right => &mut self.right,
        }
    }
}

#[derive(Debug, Default)]
struct MutationManagerInner {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<u64, Arc<Mutex<EditPair>>>>,
}

#[derive(Debug, Clone, Default)]
pub struct MutationManager {
    inner: Arc<MutationManagerInner>,
}

impl MutationManager {
    fn insert(&self, pair: EditPair) -> u64 {
        let session_id = self
            .inner
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1);
        lock_unpoisoned(&self.inner.sessions).insert(session_id, Arc::new(Mutex::new(pair)));
        session_id
    }

    fn session(&self, session_id: u64) -> Result<Arc<Mutex<EditPair>>, String> {
        lock_unpoisoned(&self.inner.sessions)
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("edit session {session_id} was not found"))
    }

    fn close(&self, session_id: u64) -> bool {
        lock_unpoisoned(&self.inner.sessions)
            .remove(&session_id)
            .is_some()
    }
}

#[tauri::command]
pub async fn open_edit_session(
    manager: State<'_, MutationManager>,
    request: OpenEditSessionRequest,
) -> Result<OpenEditSessionResponse, String> {
    let manager = manager.inner().clone();
    run_blocking(move || {
        let policy = MutationPolicy::default();
        let cancellation = CancellationToken::default();
        let left = open_document(&request.left_path, &policy, &cancellation)
            .map_err(|error| error.to_string())?;
        let right = open_document(&request.right_path, &policy, &cancellation)
            .map_err(|error| error.to_string())?;
        let response_left = left.info();
        let response_right = right.info();
        let session_id = manager.insert(EditPair { left, right });
        Ok(OpenEditSessionResponse {
            session_id,
            left: response_left,
            right: response_right,
        })
    })
    .await
}

#[tauri::command]
pub async fn save_edit_side(
    manager: State<'_, MutationManager>,
    request: SaveEditSideRequest,
) -> Result<SaveReport, String> {
    let session = manager.session(request.session_id)?;
    run_blocking(move || {
        let policy = MutationPolicy::default();
        let cancellation = CancellationToken::default();
        save_document(
            lock_unpoisoned(&session).document_mut(request.side),
            &request.text,
            &policy,
            &cancellation,
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn rollback_edit_side(
    manager: State<'_, MutationManager>,
    request: RollbackEditSideRequest,
) -> Result<RollbackReport, String> {
    let session = manager.session(request.session_id)?;
    run_blocking(move || {
        let policy = MutationPolicy::default();
        let cancellation = CancellationToken::default();
        rollback_document(
            lock_unpoisoned(&session).document_mut(request.side),
            &policy,
            &cancellation,
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub fn close_edit_session(manager: State<'_, MutationManager>, session_id: u64) -> bool {
    manager.close(session_id)
}

#[tauri::command]
pub async fn recycle_duplicates(
    request: RecycleDuplicatesRequest,
) -> Result<RecycleReport, String> {
    if !request.confirmed {
        return Err("recycle operation requires explicit confirmation".to_owned());
    }
    run_blocking(move || {
        recycle_candidates(
            &request.candidates,
            &MutationPolicy::default(),
            &SystemRecycler,
            &CancellationToken::default(),
        )
        .map_err(|error| error.to_string())
    })
    .await
}

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("mutation task failed: {error}"))?
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use muller_core::CancellationToken;
    use muller_mutate::{MutationPolicy, open_document};
    use tempfile::tempdir;

    use super::{EditPair, EditSide, MutationManager};

    #[test]
    fn stores_independent_left_and_right_documents() {
        let directory = tempdir().expect("temporary directory");
        let left_path = directory.path().join("left.txt");
        let right_path = directory.path().join("right.txt");
        fs::write(&left_path, "left").expect("write left fixture");
        fs::write(&right_path, "right").expect("write right fixture");
        let policy = MutationPolicy::default();
        let cancellation = CancellationToken::default();
        let left = open_document(&left_path, &policy, &cancellation).expect("open left");
        let right = open_document(&right_path, &policy, &cancellation).expect("open right");
        let manager = MutationManager::default();

        let session_id = manager.insert(EditPair { left, right });
        let session = manager.session(session_id).expect("stored session");
        let mut pair = super::lock_unpoisoned(&session);

        assert_eq!(pair.document_mut(EditSide::Left).info().text, "left");
        assert_eq!(pair.document_mut(EditSide::Right).info().text, "right");
        drop(pair);
        assert!(manager.close(session_id));
        assert!(manager.session(session_id).is_err());
    }
}
