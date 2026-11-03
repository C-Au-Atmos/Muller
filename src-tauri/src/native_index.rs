//! Ordinary-privilege Tauri entry points for the isolated native indexer.

use std::path::PathBuf;
use tauri::State;

use crate::{indexer::IndexerManager, native_broker};

#[tauri::command]
pub async fn enable_native_indexer(
    manager: State<'_, IndexerManager>,
    roots: Vec<PathBuf>,
) -> Result<(), String> {
    if roots.is_empty() {
        return Err("No local drives are available for indexing".into());
    }
    // This action is user initiated. Stop the optional portable warm scan
    // before launching the independent worker; never elevate the GUI.
    manager.cancel_all();
    tauri::async_runtime::spawn_blocking(move || native_broker::launch_native_indexer(roots))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_native_indexer_status() -> Result<native_broker::NativeStatus, String> {
    tauri::async_runtime::spawn_blocking(native_broker::native_status)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn stop_native_indexer() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(native_broker::cancel_native_indexer)
        .await
        .map_err(|error| error.to_string())?
}
