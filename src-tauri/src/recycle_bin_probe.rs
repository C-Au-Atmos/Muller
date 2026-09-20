//! Opt-in end-to-end probe. Only uniquely created fixtures are ever mutated.

use crate::recycle_bin::{RecycleBinManager, RecycleEntry, RecycleKind, RecycleRequest};
use muller_core::CancellationToken;
use muller_mutate::{EntryExpectation, EntryKind, MutationPolicy, recycle_entry};
use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn entry() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|arg| arg != "--recycle-bin-probe") {
        return false;
    }
    if args.len() != 4 {
        eprintln!("Usage: Muller.exe --recycle-bin-probe <fixture-parent> <report.json>");
        return true;
    }
    let result = probe(Path::new(&args[2]));
    let report = result.unwrap_or_else(|error| json!({"passed":false,"error":error}));
    if let Ok(bytes) = serde_json::to_vec_pretty(&report) {
        let _ = fs::write(&args[3], bytes);
    }
    true
}

fn same_path(left: &str, right: &Path) -> bool {
    let normalize = |value: &str| {
        value
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_lowercase()
    };
    normalize(left) == normalize(&right.to_string_lossy())
}

fn find(manager: &RecycleBinManager, path: &Path) -> Result<RecycleEntry, String> {
    let snapshot = manager.list()?;
    snapshot
        .entries
        .into_iter()
        .find(|entry| same_path(&entry.original_path, path))
        .ok_or_else(|| {
            format!(
                "Fixture missing from Windows Recycle Bin: {}",
                path.display()
            )
        })
}

fn probe(parent: &Path) -> Result<Value, String> {
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    let marker = format!(
        "muller_recycle_probe_{}_{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    let fixture = parent.join(&marker);
    fs::create_dir(&fixture).map_err(|e| e.to_string())?;
    let result = probe_fixture(&fixture);
    // Never clean a caller-selected directory. The sole recursive target was
    // freshly created above, has the exact generated marker, and stays in parent.
    if result.is_ok()
        && fixture.parent() == Some(parent.as_path())
        && fixture
            .file_name()
            .is_some_and(|name| name == marker.as_str())
    {
        fs::remove_dir_all(&fixture).map_err(|e| e.to_string())?;
    }
    result.map(|mut report| {
        report["fixture"] = json!(fixture);
        report
    })
}

fn probe_fixture(fixture: &Path) -> Result<Value, String> {
    let manager = RecycleBinManager::default();
    let before = manager.list()?;
    let file = fixture.join("響喜乱舞 空间验证.zip");
    let folder = fixture.join("还原文件夹");
    let nested = folder.join("内容.txt");
    fs::write(&file, b"Muller recycle test file").map_err(|e| e.to_string())?;
    fs::create_dir(&folder).map_err(|e| e.to_string())?;
    fs::write(&nested, b"Muller folder payload").map_err(|e| e.to_string())?;
    recycle_fixture(&file)?;
    recycle_fixture(&folder)?;
    if file.exists() || folder.exists() {
        return Err("Fixture was not moved to Windows Recycle Bin".into());
    }
    let file_entry = find(&manager, &file)?;
    let folder_entry = find(&manager, &folder)?;
    if file_entry.name != "響喜乱舞 空间验证.zip"
        || file_entry.size != Some(24)
        || file_entry.deleted_ms.is_none()
        || file_entry.kind != RecycleKind::File
        || folder_entry.kind != RecycleKind::Folder
    {
        return Err(format!(
            "Unexpected fixture metadata: {}",
            serde_json::to_string(&file_entry).unwrap_or_default()
        ));
    }
    let restore = manager.restore(RecycleRequest {
        ids: vec![file_entry.id.clone(), folder_entry.id.clone()],
        confirmed: false,
    })?;
    if restore.succeeded_ids.len() != 2 || !restore.failures.is_empty() {
        return Err(format!(
            "Restore failed: {}",
            serde_json::to_string(&restore).unwrap_or_default()
        ));
    }
    if fs::read(&file).map_err(|e| e.to_string())? != b"Muller recycle test file"
        || fs::read(&nested).map_err(|e| e.to_string())? != b"Muller folder payload"
    {
        return Err("Restored content did not match fixture".into());
    }
    recycle_fixture(&file)?;
    recycle_fixture(&folder)?;
    let file_entry = find(&manager, &file)?;
    let folder_entry = find(&manager, &folder)?;
    let ids = vec![file_entry.id, folder_entry.id];
    if manager
        .delete(RecycleRequest {
            ids: ids.clone(),
            confirmed: false,
        })
        .is_ok()
    {
        return Err("Permanent deletion accepted without confirmation".into());
    }
    let deleted = manager.delete(RecycleRequest {
        ids,
        confirmed: true,
    })?;
    if deleted.succeeded_ids.len() != 2 || !deleted.failures.is_empty() {
        return Err(format!(
            "Permanent delete failed: {}",
            serde_json::to_string(&deleted).unwrap_or_default()
        ));
    }
    let after = manager.list()?;
    if after
        .entries
        .iter()
        .any(|entry| same_path(&entry.original_parent, fixture))
    {
        return Err("Fixture still exists in Windows Recycle Bin after permanent deletion".into());
    }
    // Other users' or applications' new arrivals are allowed. Pre-existing IDs
    // must still be present; the probe never invokes a whole-bin empty command.
    let untouched = before
        .entries
        .iter()
        .all(|old| after.entries.iter().any(|new| new.id == old.id));
    if !untouched {
        return Err(
            "A pre-existing Recycle Bin entry disappeared during probe; check external changes"
                .into(),
        );
    }
    Ok(
        json!({"passed":true,"nativeShell":true,"unicodeMetadata":true,"guardedFileAndFolderRecycle":true,"missingModificationTimeRejected":true,"restoredFileAndFolder":true,"restoredContentMatches":true,"unconfirmedDeleteRejected":true,"permanentlyDeletedFixtureOnly":true,"preExistingEntriesPreserved":true,"initialCount":before.total_count,"finalCount":after.total_count}),
    )
}

fn recycle_fixture(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let mut expectation = EntryExpectation {
        path: path.to_owned(),
        kind: if metadata.is_dir() {
            EntryKind::Directory
        } else {
            EntryKind::File
        },
        // Space folders carry recursive size, not directory metadata length.
        size: if metadata.is_dir() {
            100_000
        } else {
            metadata.len()
        },
        modified_unix_ms: None,
        expected_blake3: None,
    };
    let policy = MutationPolicy::default();
    let cancellation = CancellationToken::default();
    if recycle_entry(&expectation, &policy, &cancellation).is_ok() || !path.exists() {
        return Err("Missing modification time did not preserve the fixture".into());
    }
    expectation.modified_unix_ms = metadata
        .modified()
        .ok()
        .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
        .and_then(|v| u64::try_from(v.as_millis()).ok());
    recycle_entry(&expectation, &policy, &cancellation).map_err(|e| e.to_string())?;
    Ok(())
}
