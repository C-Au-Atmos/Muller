use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{BufReader, Cursor, Read},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::{ImageFormat, ImageReader};
use lofty::prelude::{Accessor as _, AudioFile as _, TaggedFileExt as _};
use muller_core::CancellationToken;
use muller_diff::{decode_text_bytes, is_developer_text_path};
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

const MAX_TEXT_BYTES: usize = 128 * 1024;
const MAX_IMAGE_PIXELS: u64 = 80_000_000;
const PREVIEW_IMAGE_EDGE: u32 = 1600;
const MAX_ARTWORK_BYTES: usize = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES: usize = 32;
const MAX_CACHE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartPreviewRequest {
    path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPreviewResponse {
    task_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelPreviewResponse {
    task_id: u64,
    cancelled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewKind {
    Image,
    Audio,
    Video,
    Text,
    Unsupported,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    path: PathBuf,
    name: String,
    kind: PreviewKind,
    mime: Option<String>,
    text: Option<String>,
    data_url: Option<String>,
    artwork_data_url: Option<String>,
    message: Option<String>,
    file_size: u64,
    bytes_loaded: usize,
    created_unix_ms: Option<u64>,
    modified_unix_ms: Option<u64>,
    accessed_unix_ms: Option<u64>,
    extension: Option<String>,
    metadata: Vec<PreviewMetadata>,
    truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMetadata {
    label: String,
    value: String,
}

impl FilePreview {
    fn cache_weight(&self) -> usize {
        self.text.as_ref().map_or(0, String::len)
            + self.data_url.as_ref().map_or(0, String::len)
            + self.artwork_data_url.as_ref().map_or(0, String::len)
            + self.path.as_os_str().len()
            + self.name.len()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PreviewEvent {
    Started {
        task_id: u64,
    },
    Ready {
        task_id: u64,
        preview: Box<FilePreview>,
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
struct PreviewCache {
    entries: HashMap<PathBuf, FilePreview>,
    order: VecDeque<PathBuf>,
    bytes: usize,
    max_entries: usize,
    max_bytes: usize,
}

impl PreviewCache {
    fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
            max_entries,
            max_bytes,
        }
    }

    fn get(&mut self, path: &Path) -> Option<FilePreview> {
        let preview = self.entries.get(path)?.clone();
        self.order.retain(|candidate| candidate != path);
        self.order.push_back(path.to_path_buf());
        Some(preview)
    }

    fn insert(&mut self, path: PathBuf, preview: FilePreview) {
        if let Some(previous) = self.entries.remove(&path) {
            self.bytes = self.bytes.saturating_sub(previous.cache_weight());
            self.order.retain(|candidate| candidate != &path);
        }
        self.bytes = self.bytes.saturating_add(preview.cache_weight());
        self.order.push_back(path.clone());
        self.entries.insert(path, preview);

        while self.entries.len() > self.max_entries || self.bytes > self.max_bytes {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed.cache_weight());
            }
        }
    }
}

impl Default for PreviewCache {
    fn default() -> Self {
        Self::new(MAX_CACHE_ENTRIES, MAX_CACHE_BYTES)
    }
}

#[derive(Debug, Default)]
struct PreviewManagerInner {
    next_id: AtomicU64,
    active: Mutex<HashMap<u64, CancellationToken>>,
    cache: Mutex<PreviewCache>,
}

#[derive(Debug, Clone, Default)]
pub struct PreviewManager {
    inner: Arc<PreviewManagerInner>,
}

impl PreviewManager {
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
        if let Some(cancellation) = lock_unpoisoned(&self.inner.active).get(&task_id) {
            cancellation.cancel();
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
pub fn start_file_preview(
    manager: State<'_, PreviewManager>,
    request: StartPreviewRequest,
    on_event: Channel<PreviewEvent>,
) -> StartPreviewResponse {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        if on_event.send(PreviewEvent::Started { task_id }).is_err() {
            cancellation.cancel();
        }
        let result = load_preview(&manager, &request.path, &cancellation);
        let event = match result {
            Ok(preview) if !cancellation.is_cancelled() => PreviewEvent::Ready {
                task_id,
                preview: Box::new(preview),
            },
            Ok(_) | Err(PreviewBuildError::Cancelled) => PreviewEvent::Cancelled { task_id },
            Err(PreviewBuildError::Message(message)) => PreviewEvent::Error { task_id, message },
        };
        let _ = on_event.send(event);
        manager.finish(task_id);
    });
    StartPreviewResponse { task_id }
}

#[tauri::command]
pub fn cancel_file_preview(
    manager: State<'_, PreviewManager>,
    task_id: u64,
) -> CancelPreviewResponse {
    CancelPreviewResponse {
        task_id,
        cancelled: manager.cancel(task_id),
    }
}

#[derive(Debug)]
enum PreviewBuildError {
    Cancelled,
    Message(String),
}

fn load_preview(
    manager: &PreviewManager,
    requested: &Path,
    cancellation: &CancellationToken,
) -> Result<FilePreview, PreviewBuildError> {
    if cancellation.is_cancelled() {
        return Err(PreviewBuildError::Cancelled);
    }
    let metadata = fs::symlink_metadata(requested).map_err(|error| {
        PreviewBuildError::Message(format!("cannot inspect {}: {error}", requested.display()))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(PreviewBuildError::Message(format!(
            "preview requires a regular file: {}",
            requested.display()
        )));
    }
    let canonical = fs::canonicalize(requested).map_err(|error| {
        PreviewBuildError::Message(format!("cannot resolve {}: {error}", requested.display()))
    })?;
    let modified_unix_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|value| u64::try_from(value.as_millis()).ok());
    let created_unix_ms = unix_ms(metadata.created().ok());
    let accessed_unix_ms = unix_ms(metadata.accessed().ok());
    if let Some(cached) = lock_unpoisoned(&manager.inner.cache).get(&canonical)
        && cached.file_size == metadata.len()
        && cached.modified_unix_ms == modified_unix_ms
    {
        return Ok(cached);
    }

    let extension = requested
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let name = requested.file_name().map_or_else(
        || requested.display().to_string(),
        |value| value.to_string_lossy().into(),
    );
    let mut preview_metadata = vec![
        PreviewMetadata {
            label: "Exact size".into(),
            value: format!("{} bytes", metadata.len()),
        },
        PreviewMetadata {
            label: "Extension".into(),
            value: if extension.is_empty() {
                "None".into()
            } else {
                format!(".{extension}")
            },
        },
        PreviewMetadata {
            label: "Path".into(),
            value: requested.display().to_string(),
        },
        PreviewMetadata {
            label: "Attributes".into(),
            value: file_attributes(&metadata),
        },
    ];
    let (kind, mime, text, data_url, artwork_data_url, message, bytes_loaded, truncated) =
        if let Some(mime) = image_mime(&extension) {
            let (data_url, source_width, source_height, color_type, encoded_bytes) =
                build_image_preview(requested, cancellation)?;
            preview_metadata.extend([
                PreviewMetadata {
                    label: "Dimensions".into(),
                    value: format!("{source_width} x {source_height} px"),
                },
                PreviewMetadata {
                    label: "Color type".into(),
                    value: color_type,
                },
                PreviewMetadata {
                    label: "MIME".into(),
                    value: mime.to_string(),
                },
            ]);
            append_image_metadata(requested, &mut preview_metadata);
            (
                PreviewKind::Image,
                Some(mime.to_string()),
                None,
                Some(data_url),
                None,
                None,
                encoded_bytes,
                false,
            )
        } else if let Some(mime) = audio_mime(&extension) {
            preview_metadata.push(PreviewMetadata {
                label: "MIME".into(),
                value: mime.into(),
            });
            let artwork = append_tagged_media_metadata(requested, &mut preview_metadata);
            (
                PreviewKind::Audio,
                Some(mime.into()),
                None,
                None,
                artwork,
                None,
                0,
                false,
            )
        } else if let Some(mime) = video_mime(&extension) {
            preview_metadata.push(PreviewMetadata {
                label: "MIME".into(),
                value: mime.into(),
            });
            append_tagged_media_metadata(requested, &mut preview_metadata);
            (
                PreviewKind::Video,
                Some(mime.into()),
                None,
                None,
                None,
                None,
                0,
                false,
            )
        } else if is_developer_text_path(requested) {
            let bytes = read_limited(requested, MAX_TEXT_BYTES, cancellation)?;
            let truncated = metadata.len() > bytes.len() as u64;
            let bytes_loaded = bytes.len();
            match decode_text_bytes(&bytes) {
                Some((encoding, text)) => {
                    preview_metadata.extend([
                        PreviewMetadata {
                            label: "MIME".into(),
                            value: "text/plain".into(),
                        },
                        PreviewMetadata {
                            label: "Encoding".into(),
                            value: format!("{encoding:?}"),
                        },
                    ]);
                    (
                        PreviewKind::Text,
                        Some("text/plain".to_string()),
                        Some(text),
                        None,
                        None,
                        None,
                        bytes_loaded,
                        truncated,
                    )
                }
                None => (
                    PreviewKind::Unsupported,
                    None,
                    None,
                    None,
                    None,
                    Some("File content appears to be binary".to_string()),
                    bytes_loaded,
                    truncated,
                ),
            }
        } else {
            (
                PreviewKind::Unsupported,
                None,
                None,
                None,
                None,
                Some("No inline preview is available for this file type".to_string()),
                0,
                false,
            )
        };

    let preview = FilePreview {
        path: requested.to_path_buf(),
        name,
        kind,
        mime,
        text,
        data_url,
        artwork_data_url,
        message,
        file_size: metadata.len(),
        bytes_loaded,
        created_unix_ms,
        modified_unix_ms,
        accessed_unix_ms,
        extension: (!extension.is_empty()).then_some(extension),
        metadata: preview_metadata,
        truncated,
    };
    lock_unpoisoned(&manager.inner.cache).insert(canonical, preview.clone());
    Ok(preview)
}

fn append_image_metadata(path: &Path, metadata: &mut Vec<PreviewMetadata>) {
    let Ok(file) = File::open(path) else {
        return;
    };
    let mut reader = BufReader::new(file);
    let Ok(exif) = exif::Reader::new().read_from_container(&mut reader) else {
        return;
    };
    for field in exif.fields().take(96) {
        let value = field.display_value().with_unit(&exif).to_string();
        if value.is_empty() || value.len() > 512 {
            continue;
        }
        metadata.push(PreviewMetadata {
            label: format!("EXIF {}", field.tag),
            value,
        });
    }
}

fn append_tagged_media_metadata(
    path: &Path,
    metadata: &mut Vec<PreviewMetadata>,
) -> Option<String> {
    let tagged = lofty::read_from_path(path).ok()?;
    let properties = tagged.properties();
    metadata.push(PreviewMetadata {
        label: "Container".into(),
        value: format!("{:?}", tagged.file_type()),
    });
    if !properties.duration().is_zero() {
        metadata.push(PreviewMetadata {
            label: "Duration".into(),
            value: format_duration(properties.duration()),
        });
    }
    if let Some(value) = properties.overall_bitrate().filter(|value| *value > 0) {
        metadata.push(PreviewMetadata {
            label: "Overall bitrate".into(),
            value: format!("{value} kbps"),
        });
    }
    if let Some(value) = properties.audio_bitrate().filter(|value| *value > 0) {
        metadata.push(PreviewMetadata {
            label: "Audio bitrate".into(),
            value: format!("{value} kbps"),
        });
    }
    if let Some(value) = properties.sample_rate().filter(|value| *value > 0) {
        metadata.push(PreviewMetadata {
            label: "Sample rate".into(),
            value: format!("{value} Hz"),
        });
    }
    if let Some(value) = properties.channels().filter(|value| *value > 0) {
        metadata.push(PreviewMetadata {
            label: "Channels".into(),
            value: channel_description(value),
        });
    }
    if let Some(value) = properties.bit_depth().filter(|value| *value > 0) {
        metadata.push(PreviewMetadata {
            label: "Bit depth".into(),
            value: format!("{value}-bit"),
        });
    }

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    metadata.push(PreviewMetadata {
        label: "Tag format".into(),
        value: format!("{:?}", tag.tag_type()),
    });
    for (label, value) in [
        ("Title", tag.title().map(|value| value.into_owned())),
        ("Artist", tag.artist().map(|value| value.into_owned())),
        ("Album", tag.album().map(|value| value.into_owned())),
        ("Genre", tag.genre().map(|value| value.into_owned())),
        ("Comment", tag.comment().map(|value| value.into_owned())),
        ("Date", tag.date().map(|value| value.to_string())),
        ("Track", tag.track().map(|value| value.to_string())),
        (
            "Track total",
            tag.track_total().map(|value| value.to_string()),
        ),
        ("Disc", tag.disk().map(|value| value.to_string())),
        (
            "Disc total",
            tag.disk_total().map(|value| value.to_string()),
        ),
    ] {
        if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
            metadata.push(PreviewMetadata {
                label: label.into(),
                value,
            });
        }
    }
    let pictures = tag.pictures();
    if !pictures.is_empty() {
        metadata.push(PreviewMetadata {
            label: "Embedded artwork".into(),
            value: format!(
                "{} image{}",
                pictures.len(),
                if pictures.len() == 1 { "" } else { "s" }
            ),
        });
    }
    let picture = pictures.first()?;
    let mime = picture.mime_type()?;
    (picture.data().len() <= MAX_ARTWORK_BYTES).then(|| {
        format!(
            "data:{};base64,{}",
            mime.as_str(),
            BASE64.encode(picture.data())
        )
    })
}

fn format_duration(duration: std::time::Duration) -> String {
    let total_seconds = duration.as_secs();
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    let milliseconds = duration.subsec_millis();
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}.{milliseconds:03}")
    } else {
        format!("{minutes}:{seconds:02}.{milliseconds:03}")
    }
}

fn channel_description(channels: u8) -> String {
    match channels {
        1 => "1 (mono)".into(),
        2 => "2 (stereo)".into(),
        value => value.to_string(),
    }
}

#[cfg(windows)]
fn file_attributes(metadata: &fs::Metadata) -> String {
    use std::os::windows::fs::MetadataExt as _;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_ARCHIVE, FILE_ATTRIBUTE_COMPRESSED, FILE_ATTRIBUTE_ENCRYPTED,
        FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_READONLY, FILE_ATTRIBUTE_SPARSE_FILE,
        FILE_ATTRIBUTE_SYSTEM,
    };

    let attributes = metadata.file_attributes();
    let mut labels = Vec::new();
    for (flag, label) in [
        (FILE_ATTRIBUTE_READONLY, "Read-only"),
        (FILE_ATTRIBUTE_HIDDEN, "Hidden"),
        (FILE_ATTRIBUTE_SYSTEM, "System"),
        (FILE_ATTRIBUTE_ARCHIVE, "Archive"),
        (FILE_ATTRIBUTE_COMPRESSED, "Compressed"),
        (FILE_ATTRIBUTE_ENCRYPTED, "Encrypted"),
        (FILE_ATTRIBUTE_SPARSE_FILE, "Sparse"),
    ] {
        if attributes & flag != 0 {
            labels.push(label);
        }
    }
    if labels.is_empty() {
        "Normal".into()
    } else {
        labels.join(", ")
    }
}

#[cfg(not(windows))]
fn file_attributes(metadata: &fs::Metadata) -> String {
    if metadata.permissions().readonly() {
        "Read-only".into()
    } else {
        "Normal".into()
    }
}

fn build_image_preview(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<(String, u32, u32, String, usize), PreviewBuildError> {
    let reader = ImageReader::open(path)
        .and_then(ImageReader::with_guessed_format)
        .map_err(|error| PreviewBuildError::Message(format!("cannot open image: {error}")))?;
    let (width, height) = reader.into_dimensions().map_err(|error| {
        PreviewBuildError::Message(format!("cannot read image dimensions: {error}"))
    })?;
    if u64::from(width).saturating_mul(u64::from(height)) > MAX_IMAGE_PIXELS {
        return Err(PreviewBuildError::Message(format!(
            "image exceeds the {} megapixel decode budget",
            MAX_IMAGE_PIXELS / 1_000_000,
        )));
    }
    if cancellation.is_cancelled() {
        return Err(PreviewBuildError::Cancelled);
    }
    let decoded = ImageReader::open(path)
        .and_then(ImageReader::with_guessed_format)
        .map_err(|error| PreviewBuildError::Message(format!("cannot reopen image: {error}")))?
        .decode()
        .map_err(|error| PreviewBuildError::Message(format!("cannot decode image: {error}")))?;
    let color_type = format!("{:?}", decoded.color());
    let resized = decoded.thumbnail(PREVIEW_IMAGE_EDGE, PREVIEW_IMAGE_EDGE);
    let mut encoded = Cursor::new(Vec::new());
    resized
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|error| {
            PreviewBuildError::Message(format!("cannot encode image preview: {error}"))
        })?;
    let bytes = encoded.into_inner();
    let bytes_loaded = bytes.len();
    Ok((
        format!("data:image/png;base64,{}", BASE64.encode(bytes)),
        width,
        height,
        color_type,
        bytes_loaded,
    ))
}

fn unix_ms(value: Option<std::time::SystemTime>) -> Option<u64> {
    value?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

fn read_limited(
    path: &Path,
    limit: usize,
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, PreviewBuildError> {
    let mut file = File::open(path).map_err(|error| {
        PreviewBuildError::Message(format!("cannot open {}: {error}", path.display()))
    })?;
    let mut bytes = Vec::with_capacity(limit.min(32 * 1024));
    let mut buffer = [0_u8; 32 * 1024];
    while bytes.len() < limit {
        if cancellation.is_cancelled() {
            return Err(PreviewBuildError::Cancelled);
        }
        let remaining = limit - bytes.len();
        let chunk_len = remaining.min(buffer.len());
        let read = file.read(&mut buffer[..chunk_len]).map_err(|error| {
            PreviewBuildError::Message(format!("cannot read {}: {error}", path.display()))
        })?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    Ok(bytes)
}

fn image_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn audio_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "flac" => Some("audio/flac"),
        "m4a" | "aac" => Some("audio/mp4"),
        "ogg" | "opus" => Some("audio/ogg"),
        _ => None,
    }
}

fn video_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "mp4" | "m4v" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "avi" => Some("video/x-msvideo"),
        "mkv" => Some("video/x-matroska"),
        _ => None,
    }
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{
        FilePreview, PreviewCache, PreviewKind, PreviewManager, append_image_metadata, load_preview,
    };

    fn preview(path: &str, text: &str) -> FilePreview {
        FilePreview {
            path: path.into(),
            name: path.into(),
            kind: PreviewKind::Text,
            mime: Some("text/plain".into()),
            text: Some(text.into()),
            data_url: None,
            artwork_data_url: None,
            message: None,
            file_size: text.len() as u64,
            bytes_loaded: text.len(),
            created_unix_ms: None,
            modified_unix_ms: None,
            accessed_unix_ms: None,
            extension: Some("txt".into()),
            metadata: Vec::new(),
            truncated: false,
        }
    }

    #[test]
    fn cache_evicts_oldest_entries_by_count() {
        let mut cache = PreviewCache::new(2, 1024);
        cache.insert("a".into(), preview("a", "one"));
        cache.insert("b".into(), preview("b", "two"));
        assert!(cache.get(std::path::Path::new("a")).is_some());
        cache.insert("c".into(), preview("c", "three"));
        assert!(cache.get(std::path::Path::new("a")).is_some());
        assert!(cache.get(std::path::Path::new("b")).is_none());
        assert!(cache.get(std::path::Path::new("c")).is_some());
    }

    #[test]
    fn cache_evicts_entries_when_the_byte_budget_is_exceeded() {
        let mut cache = PreviewCache::new(8, 20);
        cache.insert("a".into(), preview("a", "1234567890"));
        cache.insert("b".into(), preview("b", "abcdefghij"));
        assert!(cache.bytes <= 20);
        assert!(cache.entries.len() < 2);
    }

    #[test]
    fn text_preview_is_bounded_and_reports_truncation() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("large.txt");
        fs::write(&path, vec![b'x'; super::MAX_TEXT_BYTES + 20]).expect("file");
        let preview =
            load_preview(&PreviewManager::default(), &path, &Default::default()).expect("preview");
        assert_eq!(preview.kind, PreviewKind::Text);
        assert_eq!(preview.bytes_loaded, super::MAX_TEXT_BYTES);
        assert!(preview.truncated);
    }

    #[test]
    fn developer_formats_and_build_files_render_as_text() {
        let fixture = tempdir().expect("fixture");
        for name in [
            "settings.ini",
            "build.bat",
            "main.c",
            "main.rs",
            "Cargo.toml",
            "app.ts",
            "Makefile",
            ".env",
        ] {
            let path = fixture.path().join(name);
            fs::write(&path, "key = value\n").expect("developer file");
            let preview = load_preview(&PreviewManager::default(), &path, &Default::default())
                .expect("developer preview");
            assert_eq!(preview.kind, PreviewKind::Text, "file: {name}");
            assert_eq!(preview.text.as_deref(), Some("key = value\n"));
        }
    }

    #[test]
    fn blob_preview_requires_text_content() {
        let fixture = tempdir().expect("fixture");
        let text_path = fixture.path().join("source.blob");
        fs::write(&text_path, "export const answer = 42;\n").expect("text blob");
        let text_preview =
            load_preview(&PreviewManager::default(), &text_path, &Default::default())
                .expect("text blob preview");
        assert_eq!(text_preview.kind, PreviewKind::Text);

        let binary_path = fixture.path().join("binary.blob");
        fs::write(&binary_path, [0, 1, 2, 3]).expect("binary blob");
        let binary_preview = load_preview(
            &PreviewManager::default(),
            &binary_path,
            &Default::default(),
        )
        .expect("binary blob preview");
        assert_eq!(binary_preview.kind, PreviewKind::Unsupported);
        assert_eq!(
            binary_preview.message.as_deref(),
            Some("File content appears to be binary")
        );
    }

    #[test]
    fn cancelled_preview_stops_before_reading() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("file.txt");
        fs::write(&path, "content").expect("file");
        let cancellation = muller_core::CancellationToken::default();
        cancellation.cancel();
        assert!(load_preview(&PreviewManager::default(), &path, &cancellation).is_err());
    }

    #[test]
    fn wav_preview_reports_real_audio_properties() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("sample.wav");
        let data_length = 16_000_u32;
        let mut wav = Vec::with_capacity(44 + data_length as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_length).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&8_000_u32.to_le_bytes());
        wav.extend_from_slice(&16_000_u32.to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_length.to_le_bytes());
        wav.resize(44 + data_length as usize, 0);
        fs::write(&path, wav).expect("wav fixture");

        let preview =
            load_preview(&PreviewManager::default(), &path, &Default::default()).expect("preview");
        assert_eq!(preview.kind, PreviewKind::Audio);
        assert!(
            preview
                .metadata
                .iter()
                .any(|field| field.label == "Duration")
        );
        assert!(
            preview
                .metadata
                .iter()
                .any(|field| field.label == "Sample rate" && field.value == "8000 Hz")
        );
        assert!(
            preview
                .metadata
                .iter()
                .any(|field| field.label == "Channels" && field.value == "1 (mono)")
        );
        assert!(
            preview
                .metadata
                .iter()
                .any(|field| field.label == "Bit depth" && field.value == "16-bit")
        );
    }

    #[test]
    fn image_metadata_reads_exif_camera_fields() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("camera.tiff");
        let mut tiff = vec![
            b'I', b'I', 42, 0, 8, 0, 0, 0, // TIFF header and first IFD offset.
            1, 0, // One IFD entry.
            0x0f, 0x01, 2, 0, 6, 0, 0, 0, 26, 0, 0, 0, // Make: ASCII at offset 26.
            0, 0, 0, 0, // No next IFD.
        ];
        tiff.extend_from_slice(b"Canon\0");
        fs::write(&path, tiff).expect("tiff fixture");

        let mut metadata = Vec::new();
        append_image_metadata(&path, &mut metadata);
        assert!(
            metadata
                .iter()
                .any(|field| field.label == "EXIF Make" && field.value.contains("Canon"))
        );
    }
}
