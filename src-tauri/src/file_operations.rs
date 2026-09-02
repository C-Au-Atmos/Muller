use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};

use muller_core::CancellationToken;
use muller_mutate::{
    ConflictStrategy, EntryExpectation, MutationPolicy, TransferMode, TransferReport,
    recycle_entry as recycle_entry_core, rename_entry as rename_entry_core,
    transfer_entry as transfer_entry_core, transfer_entry_as as transfer_entry_as_core,
};
use serde::{Deserialize, Serialize};

use crate::explorer::ExplorerManager;

const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_ARCHIVE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_RATIO: u64 = 1_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferEntryRequest {
    task_id: u64,
    source: PathBuf,
    destination_directory: PathBuf,
    mode: TransferMode,
    conflict: ConflictStrategy,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferDirectoryEntriesRequest {
    task_id: u64,
    source_session_id: u64,
    #[serde(default)]
    query: String,
    positions: Vec<usize>,
    destination_directory: PathBuf,
    mode: TransferMode,
    conflict: ConflictStrategy,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizeByKeywordRequest {
    task_id: u64,
    source_directory: PathBuf,
    destination_directory: PathBuf,
    keyword: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizeUndoEntry {
    source: PathBuf,
    destination: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoOrganizeRequest {
    task_id: u64,
    entries: Vec<OrganizeUndoEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFailure {
    source: PathBuf,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTransferReport {
    reports: Vec<TransferReport>,
    failures: Vec<TransferFailure>,
}

#[derive(Debug, Clone, Default)]
pub struct FileOperationManager {
    active: Arc<Mutex<HashMap<u64, CancellationToken>>>,
}

impl FileOperationManager {
    fn begin(&self, task_id: u64) -> Result<CancellationToken, String> {
        let mut active = lock_unpoisoned(&self.active);
        if active.contains_key(&task_id) {
            return Err(format!("file operation task {task_id} is already active"));
        }
        let cancellation = CancellationToken::default();
        active.insert(task_id, cancellation.clone());
        Ok(cancellation)
    }

    fn finish(&self, task_id: u64) {
        lock_unpoisoned(&self.active).remove(&task_id);
    }

    fn cancel(&self, task_id: u64) -> bool {
        if let Some(cancellation) = lock_unpoisoned(&self.active).get(&task_id) {
            cancellation.cancel();
            true
        } else {
            false
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameEntryRequest {
    source: PathBuf,
    new_name: String,
    conflict: ConflictStrategy,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreateEntryKind {
    Directory,
    TextFile,
    EmptyFile,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryStatistics {
    recursive_size: u64,
    child_file_count: u64,
    child_directory_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveRequest {
    task_id: u64,
    sources: Vec<PathBuf>,
    destination_directory: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtractArchiveRequest {
    task_id: u64,
    archive: PathBuf,
    destination_directory: PathBuf,
    mode: ExtractDestinationMode,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExtractDestinationMode {
    Current,
    Named,
}

#[tauri::command]
pub async fn transfer_entry(
    manager: tauri::State<'_, FileOperationManager>,
    request: TransferEntryRequest,
) -> Result<TransferReport, String> {
    let manager = manager.inner().clone();
    let cancellation = manager.begin(request.task_id)?;
    let task_id = request.task_id;
    let result = run_blocking(move || {
        transfer_entry_core(
            &request.source,
            &request.destination_directory,
            request.mode,
            request.conflict,
            &MutationPolicy::default(),
            &cancellation,
        )
        .map_err(|error| error.to_string())
    })
    .await;
    manager.finish(task_id);
    result
}

#[tauri::command]
pub async fn transfer_directory_entries(
    manager: tauri::State<'_, FileOperationManager>,
    explorer: tauri::State<'_, ExplorerManager>,
    request: TransferDirectoryEntriesRequest,
) -> Result<BatchTransferReport, String> {
    let sources = explorer.resolve_paths(
        request.source_session_id,
        &request.query,
        &request.positions,
    )?;
    if sources.is_empty() {
        return Err("the drag selection no longer exists in its directory session".to_owned());
    }
    let manager = manager.inner().clone();
    let cancellation = manager.begin(request.task_id)?;
    let task_id = request.task_id;
    let result = run_blocking(move || {
        let mut reports = Vec::with_capacity(sources.len());
        let mut failures = Vec::new();
        for source in sources {
            if cancellation.is_cancelled() {
                return Err("file transfer cancelled".to_owned());
            }
            match transfer_entry_core(
                &source,
                &request.destination_directory,
                request.mode,
                request.conflict,
                &MutationPolicy::default(),
                &cancellation,
            ) {
                Ok(report) => reports.push(report),
                Err(error) => failures.push(TransferFailure {
                    source,
                    message: error.to_string(),
                }),
            }
        }
        Ok(BatchTransferReport { reports, failures })
    })
    .await;
    manager.finish(task_id);
    result
}

#[tauri::command]
pub async fn organize_by_keyword(
    manager: tauri::State<'_, FileOperationManager>,
    request: OrganizeByKeywordRequest,
) -> Result<BatchTransferReport, String> {
    let manager = manager.inner().clone();
    let cancellation = manager.begin(request.task_id)?;
    let task_id = request.task_id;
    let result = run_blocking(move || {
        organize_files_by_keyword(
            &request.source_directory,
            &request.destination_directory,
            &request.keyword,
            &cancellation,
        )
    })
    .await;
    manager.finish(task_id);
    result
}

#[tauri::command]
pub async fn undo_organize_by_keyword(
    manager: tauri::State<'_, FileOperationManager>,
    request: UndoOrganizeRequest,
) -> Result<BatchTransferReport, String> {
    let manager = manager.inner().clone();
    let cancellation = manager.begin(request.task_id)?;
    let task_id = request.task_id;
    let result = run_blocking(move || undo_organized_files(request.entries, &cancellation)).await;
    manager.finish(task_id);
    result
}

#[tauri::command]
pub fn cancel_file_operation(
    manager: tauri::State<'_, FileOperationManager>,
    task_id: u64,
) -> bool {
    manager.cancel(task_id)
}

#[tauri::command]
pub async fn rename_entry(request: RenameEntryRequest) -> Result<TransferReport, String> {
    run_blocking(move || {
        rename_entry_core(
            &request.source,
            &request.new_name,
            request.conflict,
            &MutationPolicy::default(),
            &CancellationToken::default(),
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn recycle_entry(expectation: EntryExpectation) -> Result<PathBuf, String> {
    run_blocking(move || {
        recycle_entry_core(
            &expectation,
            &MutationPolicy::default(),
            &CancellationToken::default(),
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_entry(
    directory: PathBuf,
    kind: CreateEntryKind,
    name: Option<String>,
) -> Result<PathBuf, String> {
    run_blocking(move || {
        let directory = canonical_directory(&directory)?;
        let (stem, extension) = match kind {
            CreateEntryKind::Directory => ("New folder", ""),
            CreateEntryKind::TextFile => ("New Text Document", ".txt"),
            CreateEntryKind::EmptyFile => ("New file", ""),
        };
        let path = match name {
            Some(name) => {
                validate_entry_name(&name)?;
                let path = directory.join(name);
                if path.exists() {
                    return Err(format!("destination already exists: {}", path.display()));
                }
                path
            }
            None => unique_destination(&directory, stem, extension),
        };
        match kind {
            CreateEntryKind::Directory => fs::create_dir(&path),
            CreateEntryKind::TextFile | CreateEntryKind::EmptyFile => File::create(&path).map(drop),
        }
        .map_err(|error| format!("cannot create {}: {error}", path.display()))?;
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn directory_statistics(path: PathBuf) -> Result<DirectoryStatistics, String> {
    run_blocking(move || collect_directory_statistics(&path)).await
}

fn collect_directory_statistics(path: &Path) -> Result<DirectoryStatistics, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{} is not a directory", path.display()));
    }

    let mut statistics = DirectoryStatistics {
        recursive_size: 0,
        child_file_count: 0,
        child_directory_count: 0,
    };
    let mut stack = vec![(path.to_path_buf(), true)];
    while let Some((directory, immediate)) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if immediate => {
                return Err(format!("cannot read {}: {error}", directory.display()));
            }
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let child = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&child) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_file() {
                statistics.recursive_size =
                    statistics.recursive_size.saturating_add(metadata.len());
                if immediate {
                    statistics.child_file_count = statistics.child_file_count.saturating_add(1);
                }
            } else if metadata.is_dir() {
                if immediate {
                    statistics.child_directory_count =
                        statistics.child_directory_count.saturating_add(1);
                }
                stack.push((child, false));
            }
        }
    }
    Ok(statistics)
}

#[tauri::command]
pub async fn open_terminal(path: PathBuf) -> Result<(), String> {
    run_blocking(move || {
        let canonical = fs::canonicalize(&path)
            .map_err(|error| format!("cannot resolve {}: {error}", path.display()))?;
        let directory = if canonical.is_dir() {
            canonical
        } else {
            canonical
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| "selected file has no parent directory".to_owned())?
        };
        #[cfg(windows)]
        {
            if Command::new("wt.exe")
                .arg("-d")
                .arg(&directory)
                .spawn()
                .is_ok()
            {
                return Ok(());
            }
            Command::new("powershell.exe")
                .arg("-NoExit")
                .current_dir(&directory)
                .spawn()
                .map(|_| ())
                .map_err(|error| {
                    format!("cannot open a terminal in {}: {error}", directory.display())
                })
        }
        #[cfg(not(windows))]
        {
            Command::new("x-terminal-emulator")
                .current_dir(&directory)
                .spawn()
                .map(|_| ())
                .map_err(|error| {
                    format!("cannot open a terminal in {}: {error}", directory.display())
                })
        }
    })
    .await
}

#[tauri::command]
pub async fn create_zip(
    manager: tauri::State<'_, FileOperationManager>,
    request: ArchiveRequest,
) -> Result<PathBuf, String> {
    let manager = manager.inner().clone();
    let cancellation = manager.begin(request.task_id)?;
    let task_id = request.task_id;
    let result = run_blocking(move || create_zip_archive(&request, &cancellation)).await;
    manager.finish(task_id);
    result
}

#[tauri::command]
pub async fn extract_zip(
    manager: tauri::State<'_, FileOperationManager>,
    request: ExtractArchiveRequest,
) -> Result<PathBuf, String> {
    let manager = manager.inner().clone();
    let cancellation = manager.begin(request.task_id)?;
    let task_id = request.task_id;
    let result = run_blocking(move || extract_zip_archive(&request, &cancellation)).await;
    manager.finish(task_id);
    result
}

fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{} is not a writable directory", path.display()));
    }
    fs::canonicalize(path).map_err(|error| format!("cannot resolve {}: {error}", path.display()))
}

fn organize_files_by_keyword(
    source_directory: &Path,
    destination_directory: &Path,
    keyword: &str,
    cancellation: &CancellationToken,
) -> Result<BatchTransferReport, String> {
    let source_directory = canonical_directory(source_directory)?;
    let destination_directory = canonical_directory(destination_directory)?;
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Err("keyword cannot be empty".to_owned());
    }
    if same_path(&source_directory, &destination_directory)
        || !path_is_same_or_descendant(&destination_directory, &source_directory)
    {
        return Err("the destination directory must be inside the source directory".to_owned());
    }

    let (sources, mut failures) = collect_keyword_matches(
        &source_directory,
        &destination_directory,
        keyword,
        cancellation,
    )?;
    let mut reports = Vec::with_capacity(sources.len());
    for source in sources {
        if cancellation.is_cancelled() {
            return Err("file organization cancelled".to_owned());
        }
        match transfer_entry_core(
            &source,
            &destination_directory,
            TransferMode::Move,
            ConflictStrategy::KeepBoth,
            &MutationPolicy::default(),
            cancellation,
        ) {
            Ok(report) => reports.push(report),
            Err(error) => failures.push(TransferFailure {
                source,
                message: error.to_string(),
            }),
        }
    }
    Ok(BatchTransferReport { reports, failures })
}

fn collect_keyword_matches(
    source_directory: &Path,
    destination_directory: &Path,
    keyword: &str,
    cancellation: &CancellationToken,
) -> Result<(Vec<PathBuf>, Vec<TransferFailure>), String> {
    let needle = keyword.to_lowercase();
    let mut stack = vec![source_directory.to_path_buf()];
    let mut matches = Vec::new();
    let mut failures = Vec::new();
    while let Some(directory) = stack.pop() {
        if cancellation.is_cancelled() {
            return Err("file organization cancelled".to_owned());
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if same_path(&directory, source_directory) => {
                return Err(format!("cannot read {}: {error}", directory.display()));
            }
            Err(error) => {
                failures.push(TransferFailure {
                    source: directory,
                    message: format!("cannot read directory: {error}"),
                });
                continue;
            }
        };
        for entry in entries {
            if cancellation.is_cancelled() {
                return Err("file organization cancelled".to_owned());
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    failures.push(TransferFailure {
                        source: directory.clone(),
                        message: format!("cannot inspect directory entry: {error}"),
                    });
                    continue;
                }
            };
            let path = entry.path();
            if path_is_same_or_descendant(&path, destination_directory) {
                continue;
            }
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    failures.push(TransferFailure {
                        source: path,
                        message: format!("cannot inspect entry: {error}"),
                    });
                    continue;
                }
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                stack.push(path);
            } else if metadata.is_file()
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().to_lowercase().contains(&needle))
            {
                matches.push(path);
            }
        }
    }
    matches.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));
    Ok((matches, failures))
}

fn undo_organized_files(
    entries: Vec<OrganizeUndoEntry>,
    cancellation: &CancellationToken,
) -> Result<BatchTransferReport, String> {
    let mut reports = Vec::with_capacity(entries.len());
    let mut failures = Vec::new();
    for entry in entries.into_iter().rev() {
        if cancellation.is_cancelled() {
            return Err("file organization undo cancelled".to_owned());
        }
        let Some(parent) = entry.source.parent() else {
            failures.push(TransferFailure {
                source: entry.destination,
                message: "the original path has no parent directory".to_owned(),
            });
            continue;
        };
        let Some(name) = entry.source.file_name().and_then(|value| value.to_str()) else {
            failures.push(TransferFailure {
                source: entry.destination,
                message: "the original file name is not valid Unicode".to_owned(),
            });
            continue;
        };
        match transfer_entry_as_core(
            &entry.destination,
            parent,
            name,
            TransferMode::Move,
            ConflictStrategy::Fail,
            &MutationPolicy::default(),
            cancellation,
        ) {
            Ok(report) => reports.push(report),
            Err(error) => failures.push(TransferFailure {
                source: entry.destination,
                message: error.to_string(),
            }),
        }
    }
    Ok(BatchTransferReport { reports, failures })
}

fn validate_entry_name(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('\0')
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
    {
        return Err("the new name is invalid".to_owned());
    }
    #[cfg(windows)]
    {
        if name.contains(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
            || name.ends_with(['.', ' '])
        {
            return Err("the new name is invalid".to_owned());
        }
    }
    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    path_key(left) == path_key(right)
}

fn path_is_same_or_descendant(path: &Path, parent: &Path) -> bool {
    let path = path_key(path);
    let parent = path_key(parent).trim_end_matches(['\\', '/']).to_owned();
    path == parent
        || path
            .strip_prefix(&parent)
            .is_some_and(|rest| rest.starts_with(['\\', '/']))
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn unique_destination(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    for index in 1..u32::MAX {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!(" ({index})")
        };
        let candidate = directory.join(format!("{stem}{suffix}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem} (new){extension}"))
}

fn create_zip_archive(
    request: &ArchiveRequest,
    cancellation: &CancellationToken,
) -> Result<PathBuf, String> {
    if request.sources.is_empty() {
        return Err("at least one source is required".to_owned());
    }
    let destination = canonical_directory(&request.destination_directory)?;
    let first_name = request.sources[0]
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Archive");
    let output = unique_destination(&destination, first_name, ".zip");
    let staging = destination.join(format!(
        ".muller-zip-{}-{}.tmp",
        std::process::id(),
        request.task_id
    ));
    let result = (|| {
        let file = File::create(&staging)
            .map_err(|error| format!("cannot create archive staging file: {error}"))?;
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut stack = Vec::new();
        for source in &request.sources {
            let canonical = fs::canonicalize(source)
                .map_err(|error| format!("cannot resolve {}: {error}", source.display()))?;
            let name = canonical
                .file_name()
                .ok_or_else(|| format!("cannot archive {}", canonical.display()))?
                .to_owned();
            stack.push((canonical, PathBuf::from(name)));
        }
        let mut entries = 0_usize;
        let mut total = 0_u64;
        while let Some((path, relative)) = stack.pop() {
            if cancellation.is_cancelled() {
                return Err("archive creation cancelled".to_owned());
            }
            entries = entries.saturating_add(1);
            if entries > MAX_ARCHIVE_ENTRIES {
                return Err("archive entry limit exceeded".to_owned());
            }
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "symbolic links are not archived: {}",
                    path.display()
                ));
            }
            let archive_name = archive_name(&relative)?;
            if metadata.is_dir() {
                writer
                    .add_directory(format!("{archive_name}/"), options)
                    .map_err(|error| format!("cannot add archive directory: {error}"))?;
                for child in fs::read_dir(&path)
                    .map_err(|error| format!("cannot read {}: {error}", path.display()))?
                {
                    let child =
                        child.map_err(|error| format!("cannot read archive entry: {error}"))?;
                    stack.push((child.path(), relative.join(child.file_name())));
                }
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
                if total > MAX_ARCHIVE_BYTES {
                    return Err("archive input size limit exceeded".to_owned());
                }
                writer
                    .start_file(archive_name, options)
                    .map_err(|error| format!("cannot add archive file: {error}"))?;
                let mut input = File::open(&path)
                    .map_err(|error| format!("cannot open {}: {error}", path.display()))?;
                let mut buffer = [0_u8; 64 * 1024];
                loop {
                    let read = input
                        .read(&mut buffer)
                        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
                    if read == 0 {
                        break;
                    }
                    if cancellation.is_cancelled() {
                        return Err("archive creation cancelled".to_owned());
                    }
                    writer
                        .write_all(&buffer[..read])
                        .map_err(|error| format!("cannot write archive: {error}"))?;
                }
            }
        }
        writer
            .finish()
            .map_err(|error| format!("cannot finish archive: {error}"))?;
        fs::rename(&staging, &output).map_err(|error| format!("cannot commit archive: {error}"))?;
        Ok(output.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staging);
    }
    result
}

fn extract_zip_archive(
    request: &ExtractArchiveRequest,
    cancellation: &CancellationToken,
) -> Result<PathBuf, String> {
    let archive_path = fs::canonicalize(&request.archive)
        .map_err(|error| format!("cannot resolve {}: {error}", request.archive.display()))?;
    let destination = canonical_directory(&request.destination_directory)?;
    let stem = archive_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Archive");
    let output = if request.mode == ExtractDestinationMode::Named {
        unique_destination(&destination, stem, "")
    } else {
        destination.clone()
    };
    let staging = destination.join(format!(
        ".muller-extract-{}-{}",
        std::process::id(),
        request.task_id
    ));
    let result = (|| {
        fs::create_dir(&staging)
            .map_err(|error| format!("cannot create extraction staging directory: {error}"))?;
        let file =
            File::open(&archive_path).map_err(|error| format!("cannot open archive: {error}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|error| format!("invalid ZIP archive: {error}"))?;
        if archive.len() > MAX_ARCHIVE_ENTRIES {
            return Err("archive entry limit exceeded".to_owned());
        }
        let mut declared_total = 0_u64;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| format!("cannot inspect ZIP entry: {error}"))?;
            if cancellation.is_cancelled() {
                return Err("archive extraction cancelled".to_owned());
            }
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| format!("unsafe ZIP path: {}", entry.name()))?;
            validate_archive_relative(&relative)?;
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(format!(
                    "symbolic links are not extracted: {}",
                    entry.name()
                ));
            }
            declared_total = declared_total.saturating_add(entry.size());
            if declared_total > MAX_ARCHIVE_BYTES {
                return Err("archive expanded size limit exceeded".to_owned());
            }
            if entry.compressed_size() > 0
                && entry.size() > 1024 * 1024
                && entry.size() / entry.compressed_size() > MAX_ARCHIVE_RATIO
            {
                return Err(format!("suspicious compression ratio: {}", entry.name()));
            }
            let target = staging.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&target)
                    .map_err(|error| format!("cannot create {}: {error}", target.display()))?;
                continue;
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
            }
            let mut output_file = File::create(&target)
                .map_err(|error| format!("cannot create {}: {error}", target.display()))?;
            let expected_size = entry.size();
            let copied = std::io::copy(
                &mut entry.by_ref().take(expected_size.saturating_add(1)),
                &mut output_file,
            )
            .map_err(|error| format!("cannot extract {}: {error}", target.display()))?;
            if copied != expected_size {
                return Err(format!("ZIP entry size mismatch: {}", entry.name()));
            }
        }
        if cancellation.is_cancelled() {
            return Err("archive extraction cancelled".to_owned());
        }
        match request.mode {
            ExtractDestinationMode::Named => {
                fs::rename(&staging, &output)
                    .map_err(|error| format!("cannot commit extracted archive: {error}"))?;
            }
            ExtractDestinationMode::Current => {
                commit_extracted_entries(&staging, &destination)?;
            }
        }
        Ok(output.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn commit_extracted_entries(staging: &Path, destination: &Path) -> Result<(), String> {
    let entries = fs::read_dir(staging)
        .map_err(|error| format!("cannot inspect extraction staging directory: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("cannot inspect extracted entry: {error}"))?;
    let mut committed: Vec<PathBuf> = Vec::with_capacity(entries.len());
    for entry in entries {
        let source = entry.path();
        let file_name = entry.file_name();
        let requested = destination.join(&file_name);
        let target = if requested.exists() {
            let relative = Path::new(&file_name);
            let stem = relative
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "extracted entry has an invalid file name".to_owned())?;
            let extension = relative
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| format!(".{value}"))
                .unwrap_or_default();
            unique_destination(destination, stem, &extension)
        } else {
            requested
        };
        if let Err(error) = fs::rename(&source, &target) {
            for committed_path in committed.iter().rev() {
                let _ = remove_extracted_path(committed_path);
            }
            return Err(format!("cannot commit extracted entry: {error}"));
        }
        committed.push(target);
    }
    fs::remove_dir(staging)
        .map_err(|error| format!("cannot remove extraction staging directory: {error}"))
}

fn remove_extracted_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn archive_name(path: &Path) -> Result<String, String> {
    validate_archive_relative(path)?;
    Ok(path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/"))
}

fn validate_archive_relative(path: &Path) -> Result<(), String> {
    if path.is_absolute() {
        return Err(format!(
            "absolute archive path is not allowed: {}",
            path.display()
        ));
    }
    for component in path.components() {
        let Component::Normal(name) = component else {
            return Err(format!("unsafe archive path: {}", path.display()));
        };
        let value = name.to_string_lossy();
        let base = value
            .trim_end_matches(['.', ' '])
            .split('.')
            .next()
            .unwrap_or("")
            .to_ascii_uppercase();
        let reserved = matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (base.len() == 4
                && (base.starts_with("COM") || base.starts_with("LPT"))
                && base[3..].parse::<u8>().is_ok());
        if value.contains(':') || reserved {
            return Err(format!("unsafe Windows archive name: {value}"));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenPathOutcome {
    Opened,
    ChooserCompleted,
    ChooserCancelled,
}

#[tauri::command]
pub async fn open_native_path(
    window: tauri::WebviewWindow,
    path: PathBuf,
    choose_application: bool,
) -> Result<OpenPathOutcome, String> {
    #[cfg(windows)]
    let parent = window
        .hwnd()
        .map_err(|error| format!("cannot access the Muller window handle: {error}"))?
        .0 as isize;
    #[cfg(not(windows))]
    let parent = 0_isize;
    run_blocking(move || open_with_system(&path, parent, choose_application)).await
}

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("file operation task failed: {error}"))?
}

#[cfg(windows)]
fn open_with_system(
    path: &std::path::Path,
    parent: isize,
    choose_application: bool,
) -> Result<OpenPathOutcome, String> {
    use std::os::windows::ffi::OsStrExt as _;

    use windows_sys::Win32::{
        Foundation::HWND,
        UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };

    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("cannot resolve {}: {error}", path.display()))?;
    let path = shell_path_for_user(&canonical);
    let operation = "open\0".encode_utf16().collect::<Vec<_>>();
    let path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let parent = parent as HWND;

    if choose_application {
        return show_open_with_dialog(parent, &path);
    }
    // SAFETY: operation and path are valid NUL-terminated UTF-16 strings for the call.
    let result = unsafe {
        ShellExecuteW(
            parent,
            operation.as_ptr(),
            path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    match shell_open_decision(result as isize) {
        ShellOpenDecision::Opened => Ok(OpenPathOutcome::Opened),
        ShellOpenDecision::OpenWith => show_open_with_dialog(parent, &path),
        ShellOpenDecision::Failed(code) => Err(format!(
            "Windows could not open the selected path (code {code})"
        )),
    }
}

#[cfg(windows)]
fn show_open_with_dialog(
    parent: windows_sys::Win32::Foundation::HWND,
    path: &[u16],
) -> Result<OpenPathOutcome, String> {
    use windows_sys::Win32::{
        Foundation::ERROR_CANCELLED,
        UI::Shell::{OAIF_ALLOW_REGISTRATION, OAIF_EXEC, OPENASINFO, SHOpenWithDialog},
    };

    let info = OPENASINFO {
        pcszFile: path.as_ptr(),
        pcszClass: std::ptr::null(),
        oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_EXEC,
    };
    // SAFETY: info and its NUL-terminated file path remain valid for the synchronous call.
    let result = unsafe { SHOpenWithDialog(parent, &info) };
    if result >= 0 {
        Ok(OpenPathOutcome::ChooserCompleted)
    } else if result as u32 == (0x8007_0000 | ERROR_CANCELLED) {
        Ok(OpenPathOutcome::ChooserCancelled)
    } else {
        Err(format!(
            "Windows could not show Open with (HRESULT 0x{:08X})",
            result as u32
        ))
    }
}

#[cfg(windows)]
#[derive(Debug, PartialEq, Eq)]
enum ShellOpenDecision {
    Opened,
    OpenWith,
    Failed(isize),
}

#[cfg(windows)]
fn shell_open_decision(code: isize) -> ShellOpenDecision {
    use windows_sys::Win32::UI::Shell::{SE_ERR_ASSOCINCOMPLETE, SE_ERR_NOASSOC};

    if code > 32 {
        ShellOpenDecision::Opened
    } else if code == SE_ERR_NOASSOC as isize || code == SE_ERR_ASSOCINCOMPLETE as isize {
        ShellOpenDecision::OpenWith
    } else {
        ShellOpenDecision::Failed(code)
    }
}

#[cfg(windows)]
fn shell_path_for_user(path: &std::path::Path) -> PathBuf {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    const VERBATIM_PREFIX: &[u16] = &[92, 92, 63, 92];
    const VERBATIM_UNC_PREFIX: &[u16] = &[92, 92, 63, 92, 85, 78, 67, 92];
    const UNC_PREFIX: &[u16] = &[92, 92];

    let value: Vec<u16> = path.as_os_str().encode_wide().collect();
    let shell_path = if let Some(remainder) = value.strip_prefix(VERBATIM_UNC_PREFIX) {
        UNC_PREFIX.iter().chain(remainder).copied().collect()
    } else if let Some(remainder) = value.strip_prefix(VERBATIM_PREFIX) {
        remainder.to_vec()
    } else {
        value
    };
    PathBuf::from(std::ffi::OsString::from_wide(&shell_path))
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(not(windows))]
fn open_with_system(
    path: &std::path::Path,
    _parent: isize,
    _choose_application: bool,
) -> Result<OpenPathOutcome, String> {
    let path = std::fs::canonicalize(path)
        .map_err(|error| format!("cannot resolve {}: {error}", path.display()))?;
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| OpenPathOutcome::Opened)
        .map_err(|error| format!("cannot open selected path: {error}"))
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write as _, path::Path};

    use muller_core::CancellationToken;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    use super::{
        ArchiveRequest, ExtractArchiveRequest, ExtractDestinationMode, FileOperationManager,
        OrganizeUndoEntry, collect_directory_statistics, create_zip_archive, extract_zip_archive,
        organize_files_by_keyword, undo_organized_files, unique_destination,
        validate_archive_relative,
    };

    #[test]
    fn directory_statistics_include_nested_bytes_and_immediate_counts() {
        let fixture = tempdir().expect("fixture");
        let nested = fixture.path().join("nested");
        fs::create_dir(&nested).expect("nested directory");
        fs::write(fixture.path().join("root.txt"), b"root").expect("root file");
        fs::write(nested.join("child.txt"), b"nested").expect("nested file");

        let statistics = collect_directory_statistics(fixture.path()).expect("statistics");
        assert_eq!(statistics.recursive_size, 10);
        assert_eq!(statistics.child_file_count, 1);
        assert_eq!(statistics.child_directory_count, 1);
    }

    #[test]
    fn transfer_task_can_be_cancelled_and_retired() {
        let manager = FileOperationManager::default();
        let cancellation = manager.begin(42).expect("begin task");
        assert!(manager.cancel(42));
        assert!(cancellation.is_cancelled());
        manager.finish(42);
        assert!(!manager.cancel(42));
        assert!(manager.begin(42).is_ok());
    }

    #[test]
    fn unique_destination_uses_explorer_style_numbering() {
        let fixture = tempdir().expect("fixture");
        fs::write(fixture.path().join("New Text Document.txt"), "one").expect("first file");
        fs::write(fixture.path().join("New Text Document (2).txt"), "two").expect("second file");

        assert_eq!(
            unique_destination(fixture.path(), "New Text Document", ".txt")
                .file_name()
                .expect("file name"),
            "New Text Document (3).txt"
        );
    }

    #[test]
    fn keyword_organization_moves_recursive_matches_and_undoes_them() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("source");
        let nested = source.join("nested");
        let destination = source.join("Collected");
        fs::create_dir_all(&nested).expect("source directories");
        fs::create_dir(&destination).expect("destination directory");
        fs::write(source.join("Report.txt"), b"root").expect("root match");
        fs::write(nested.join("weekly-report.md"), b"nested").expect("nested match");
        fs::write(nested.join("notes.txt"), b"other").expect("non-match");
        fs::write(destination.join("Report.txt"), b"existing").expect("destination entry");

        let result = organize_files_by_keyword(
            &source,
            &destination,
            "REPORT",
            &CancellationToken::default(),
        )
        .expect("organize files");
        assert_eq!(result.reports.len(), 2);
        assert!(result.failures.is_empty());
        assert!(!source.join("Report.txt").exists());
        assert!(!nested.join("weekly-report.md").exists());
        assert!(nested.join("notes.txt").exists());
        assert!(destination.join("Report.txt").exists());
        assert!(destination.join("Report - Copy.txt").exists());
        assert!(destination.join("weekly-report.md").exists());

        let undo = result
            .reports
            .iter()
            .map(|report| OrganizeUndoEntry {
                source: report.source.clone(),
                destination: report.destination.clone(),
            })
            .collect();
        let undone = undo_organized_files(undo, &CancellationToken::default()).expect("undo");
        assert_eq!(undone.reports.len(), 2);
        assert!(undone.failures.is_empty());
        assert!(source.join("Report.txt").exists());
        assert!(nested.join("weekly-report.md").exists());
        assert!(!destination.join("Report - Copy.txt").exists());
    }

    #[test]
    fn keyword_organization_keeps_existing_destination_files() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("source");
        let destination = source.join("Collected");
        fs::create_dir_all(&destination).expect("source directories");
        fs::write(source.join("invoice.pdf"), b"new").expect("source match");
        fs::write(destination.join("invoice.pdf"), b"old").expect("existing destination");

        let result = organize_files_by_keyword(
            &source,
            &destination,
            "invoice",
            &CancellationToken::default(),
        )
        .expect("organize files");
        assert_eq!(result.reports.len(), 1);
        assert!(result.failures.is_empty());
        assert_eq!(
            fs::read(destination.join("invoice.pdf")).expect("old file"),
            b"old"
        );
        assert_eq!(
            fs::read(destination.join("invoice - Copy.pdf")).expect("copied file"),
            b"new"
        );
        assert!(!source.join("invoice.pdf").exists());
    }

    #[test]
    fn keyword_organization_undo_does_not_overwrite_an_external_file() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("source");
        let destination = source.join("Collected");
        fs::create_dir_all(&destination).expect("source directories");
        fs::write(source.join("invoice.pdf"), b"organized source").expect("source match");

        let result = organize_files_by_keyword(
            &source,
            &destination,
            "invoice",
            &CancellationToken::default(),
        )
        .expect("organize files");
        let undo = result
            .reports
            .iter()
            .map(|report| OrganizeUndoEntry {
                source: report.source.clone(),
                destination: report.destination.clone(),
            })
            .collect();
        fs::write(source.join("invoice.pdf"), b"external file").expect("external file");

        let undone = undo_organized_files(undo, &CancellationToken::default()).expect("undo");
        assert!(undone.reports.is_empty());
        assert_eq!(undone.failures.len(), 1);
        assert_eq!(
            fs::read(source.join("invoice.pdf")).expect("external file remains"),
            b"external file"
        );
        assert!(destination.join("invoice.pdf").exists());
    }

    #[test]
    fn zip_round_trip_preserves_unicode_names_and_uses_staging_commit() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("资料.txt");
        let archives = fixture.path().join("archives");
        let extracted = fixture.path().join("extracted");
        fs::create_dir(&archives).expect("archives directory");
        fs::create_dir(&extracted).expect("extracted directory");
        fs::write(&source, "Muller ZIP").expect("source file");

        let archive = create_zip_archive(
            &ArchiveRequest {
                task_id: 7,
                sources: vec![source],
                destination_directory: archives.clone(),
            },
            &CancellationToken::default(),
        )
        .expect("create ZIP");
        let output = extract_zip_archive(
            &ExtractArchiveRequest {
                task_id: 8,
                archive,
                destination_directory: extracted,
                mode: ExtractDestinationMode::Named,
            },
            &CancellationToken::default(),
        )
        .expect("extract ZIP");

        assert_eq!(
            fs::read_to_string(output.join("资料.txt")).expect("extracted file"),
            "Muller ZIP"
        );
        assert_eq!(
            fs::read_dir(&archives)
                .expect("archive entries")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().starts_with(".muller-"))
                .count(),
            0
        );
    }

    #[test]
    fn cancelled_zip_creation_removes_staging_file() {
        let fixture = tempdir().expect("fixture");
        let source = fixture.path().join("notes.txt");
        fs::write(&source, "notes").expect("source file");
        let cancellation = CancellationToken::default();
        cancellation.cancel();

        let result = create_zip_archive(
            &ArchiveRequest {
                task_id: 17,
                sources: vec![source],
                destination_directory: fixture.path().to_path_buf(),
            },
            &cancellation,
        );

        assert!(result.expect_err("cancelled archive").contains("cancelled"));
        assert_eq!(
            fs::read_dir(fixture.path())
                .expect("fixture entries")
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".muller-zip-"))
                .count(),
            0
        );
    }

    #[test]
    fn extraction_to_current_directory_keeps_existing_entries() {
        let fixture = tempdir().expect("fixture");
        let archive_path = fixture.path().join("notes.zip");
        let destination = fixture.path().join("destination");
        fs::create_dir(&destination).expect("destination directory");
        fs::write(destination.join("notes.txt"), "existing").expect("existing file");
        let file = fs::File::create(&archive_path).expect("archive fixture");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("notes.txt", SimpleFileOptions::default())
            .expect("archive entry");
        writer.write_all(b"extracted").expect("entry contents");
        writer.finish().expect("finish fixture");

        let output = extract_zip_archive(
            &ExtractArchiveRequest {
                task_id: 31,
                archive: archive_path,
                destination_directory: destination.clone(),
                mode: ExtractDestinationMode::Current,
            },
            &CancellationToken::default(),
        )
        .expect("extract into current directory");

        assert_eq!(
            output,
            fs::canonicalize(&destination).expect("canonical destination")
        );
        assert_eq!(
            fs::read_to_string(destination.join("notes.txt")).expect("existing contents"),
            "existing"
        );
        assert_eq!(
            fs::read_to_string(destination.join("notes (2).txt")).expect("kept-both contents"),
            "extracted"
        );
    }

    #[test]
    fn extraction_rejects_zip_slip_and_removes_staging_directory() {
        let fixture = tempdir().expect("fixture");
        let archive_path = fixture.path().join("malicious.zip");
        let destination = fixture.path().join("destination");
        fs::create_dir(&destination).expect("destination directory");
        let file = fs::File::create(&archive_path).expect("archive fixture");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("../escaped.txt", SimpleFileOptions::default())
            .expect("malicious entry");
        writer.write_all(b"escaped").expect("entry contents");
        writer.finish().expect("finish fixture");

        let result = extract_zip_archive(
            &ExtractArchiveRequest {
                task_id: 99,
                archive: archive_path,
                destination_directory: destination.clone(),
                mode: ExtractDestinationMode::Named,
            },
            &CancellationToken::default(),
        );

        assert!(
            result
                .expect_err("Zip Slip must fail")
                .contains("unsafe ZIP path")
        );
        assert!(!fixture.path().join("escaped.txt").exists());
        assert!(
            !destination
                .join(format!(".muller-extract-{}-99", std::process::id()))
                .exists()
        );
    }

    #[test]
    fn archive_paths_reject_parent_components() {
        assert!(validate_archive_relative(Path::new("folder/../escaped.txt")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn archive_paths_reject_windows_absolute_and_device_names() {
        for path in [r"C:\outside.txt", "CON.txt", "folder/AUX ", "notes:stream"] {
            assert!(
                validate_archive_relative(Path::new(path)).is_err(),
                "{path} must be rejected"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn missing_file_association_routes_to_open_with() {
        assert_eq!(
            super::shell_open_decision(
                windows_sys::Win32::UI::Shell::SE_ERR_ASSOCINCOMPLETE as isize,
            ),
            super::ShellOpenDecision::OpenWith
        );
        assert_eq!(
            super::shell_open_decision(windows_sys::Win32::UI::Shell::SE_ERR_NOASSOC as isize),
            super::ShellOpenDecision::OpenWith
        );
        assert_eq!(
            super::shell_open_decision(33),
            super::ShellOpenDecision::Opened
        );
        assert_eq!(
            super::shell_open_decision(2),
            super::ShellOpenDecision::Failed(2)
        );
    }

    #[cfg(windows)]
    #[test]
    fn shell_paths_hide_windows_verbatim_prefixes() {
        assert_eq!(
            super::shell_path_for_user(std::path::Path::new(r"\\?\D:\Muller\notes.md")),
            std::path::PathBuf::from(r"D:\Muller\notes.md")
        );
        assert_eq!(
            super::shell_path_for_user(std::path::Path::new(r"\\?\UNC\server\share\notes.md")),
            std::path::PathBuf::from(r"\\server\share\notes.md")
        );
    }
}
