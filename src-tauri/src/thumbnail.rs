use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{Cursor, Read as _},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::{DynamicImage, ImageFormat, ImageReader, RgbaImage, imageops};
use muller_core::CancellationToken;
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

const MAX_SOURCE_PIXELS: u64 = 80_000_000;
const MAX_CACHE_ENTRIES: usize = 96;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_VISUAL_CACHE_ENTRIES: usize = 160;
const MAX_VISUAL_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_SHELL_WORKERS: usize = 4;
const MAX_FOLDER_CANDIDATES: usize = 32;
const MAX_FOLDER_IMAGES: usize = 4;
const MAX_EMBEDDED_THUMBNAIL_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartThumbnailRequest {
    path: PathBuf,
    max_edge: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartThumbnailResponse {
    task_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelThumbnailResponse {
    task_id: u64,
    cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageThumbnail {
    path: PathBuf,
    data_url: String,
    source_width: u32,
    source_height: u32,
    width: u32,
    height: u32,
    source_bytes: u64,
    modified_unix_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ThumbnailEvent {
    Started {
        task_id: u64,
    },
    Ready {
        task_id: u64,
        thumbnail: ImageThumbnail,
    },
    Cancelled {
        task_id: u64,
    },
    Error {
        task_id: u64,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum ShellVisualPreference {
    Icon,
    Thumbnail,
    ThumbnailOrIcon,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartShellVisualRequest {
    path: PathBuf,
    logical_size: u32,
    scale_factor: f64,
    preference: ShellVisualPreference,
    generation: u64,
    #[serde(default)]
    theme: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellVisual {
    path: PathBuf,
    data_url: String,
    width: u32,
    height: u32,
    source_bytes: u64,
    modified_unix_ms: Option<u64>,
    visual_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ShellVisualEvent {
    Started {
        task_id: u64,
        generation: u64,
    },
    Ready {
        task_id: u64,
        generation: u64,
        visual: ShellVisual,
    },
    Cancelled {
        task_id: u64,
        generation: u64,
    },
    Error {
        task_id: u64,
        generation: u64,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    path: PathBuf,
    max_edge: u32,
}

#[derive(Debug, Default)]
struct ThumbnailCache {
    entries: HashMap<CacheKey, ImageThumbnail>,
    order: VecDeque<CacheKey>,
    bytes: usize,
}

impl ThumbnailCache {
    fn get(
        &mut self,
        key: &CacheKey,
        source_bytes: u64,
        modified_unix_ms: Option<u64>,
    ) -> Option<ImageThumbnail> {
        let thumbnail = self.entries.get(key)?;
        if thumbnail.source_bytes != source_bytes || thumbnail.modified_unix_ms != modified_unix_ms
        {
            return None;
        }
        let thumbnail = thumbnail.clone();
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.clone());
        Some(thumbnail)
    }

    fn insert(&mut self, key: CacheKey, thumbnail: ImageThumbnail) {
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(previous.data_url.len());
            self.order.retain(|candidate| candidate != &key);
        }
        self.bytes = self.bytes.saturating_add(thumbnail.data_url.len());
        self.order.push_back(key.clone());
        self.entries.insert(key, thumbnail);
        while self.entries.len() > MAX_CACHE_ENTRIES || self.bytes > MAX_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed.data_url.len());
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct VisualCacheKey {
    path: PathBuf,
    physical_size: u32,
    preference: ShellVisualPreference,
    theme: String,
}

#[derive(Debug, Default)]
struct ShellVisualCache {
    entries: HashMap<VisualCacheKey, ShellVisual>,
    order: VecDeque<VisualCacheKey>,
    bytes: usize,
}

impl ShellVisualCache {
    fn get(
        &mut self,
        key: &VisualCacheKey,
        source_bytes: u64,
        modified_unix_ms: Option<u64>,
    ) -> Option<ShellVisual> {
        let visual = self.entries.get(key)?;
        if visual.source_bytes != source_bytes || visual.modified_unix_ms != modified_unix_ms {
            return None;
        }
        let visual = visual.clone();
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.clone());
        Some(visual)
    }

    fn insert(&mut self, key: VisualCacheKey, visual: ShellVisual) {
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(previous.data_url.len());
            self.order.retain(|candidate| candidate != &key);
        }
        self.bytes = self.bytes.saturating_add(visual.data_url.len());
        self.order.push_back(key.clone());
        self.entries.insert(key, visual);
        while self.entries.len() > MAX_VISUAL_CACHE_ENTRIES || self.bytes > MAX_VISUAL_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed.data_url.len());
            }
        }
    }
}

#[derive(Debug)]
struct WorkerGate {
    active: Mutex<usize>,
    available: Condvar,
}

impl Default for WorkerGate {
    fn default() -> Self {
        Self {
            active: Mutex::new(0),
            available: Condvar::new(),
        }
    }
}

impl WorkerGate {
    fn enter(
        self: &Arc<Self>,
        cancellation: &CancellationToken,
    ) -> Result<WorkerPermit, ThumbnailError> {
        let mut active = lock_unpoisoned(&self.active);
        while *active >= MAX_SHELL_WORKERS {
            if cancellation.is_cancelled() {
                return Err(ThumbnailError::Cancelled);
            }
            let waited = self
                .available
                .wait_timeout(active, std::time::Duration::from_millis(25));
            active = match waited {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }
        *active += 1;
        Ok(WorkerPermit { gate: self.clone() })
    }
}

struct WorkerPermit {
    gate: Arc<WorkerGate>,
}

impl Drop for WorkerPermit {
    fn drop(&mut self) {
        let mut active = lock_unpoisoned(&self.gate.active);
        *active = active.saturating_sub(1);
        self.gate.available.notify_one();
    }
}

#[derive(Debug, Default)]
struct ThumbnailManagerInner {
    next_id: AtomicU64,
    active: Mutex<HashMap<u64, CancellationToken>>,
    cache: Mutex<ThumbnailCache>,
    visual_cache: Mutex<ShellVisualCache>,
    shell_workers: Arc<WorkerGate>,
}

#[derive(Debug, Clone, Default)]
pub struct ThumbnailManager {
    inner: Arc<ThumbnailManagerInner>,
}

pub type ShellVisualManager = ThumbnailManager;

impl ThumbnailManager {
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
        lock_unpoisoned(&self.inner.active)
            .get(&task_id)
            .is_some_and(|token| {
                token.cancel();
                true
            })
    }

    fn finish(&self, task_id: u64) {
        lock_unpoisoned(&self.inner.active).remove(&task_id);
    }
}

#[tauri::command]
pub fn start_image_thumbnail(
    manager: State<'_, ThumbnailManager>,
    request: StartThumbnailRequest,
    on_event: Channel<ThumbnailEvent>,
) -> StartThumbnailResponse {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        if on_event.send(ThumbnailEvent::Started { task_id }).is_err() {
            cancellation.cancel();
        }
        let event = match load_thumbnail(
            &manager,
            &request.path,
            request.max_edge.unwrap_or(320).clamp(96, 1024),
            &cancellation,
        ) {
            Ok(thumbnail) if !cancellation.is_cancelled() => {
                ThumbnailEvent::Ready { task_id, thumbnail }
            }
            Ok(_) | Err(ThumbnailError::Cancelled) => ThumbnailEvent::Cancelled { task_id },
            Err(ThumbnailError::Message(message)) => ThumbnailEvent::Error { task_id, message },
        };
        let _ = on_event.send(event);
        manager.finish(task_id);
    });
    StartThumbnailResponse { task_id }
}

#[tauri::command]
pub fn cancel_image_thumbnail(
    manager: State<'_, ThumbnailManager>,
    task_id: u64,
) -> CancelThumbnailResponse {
    CancelThumbnailResponse {
        task_id,
        cancelled: manager.cancel(task_id),
    }
}

#[tauri::command]
pub fn start_shell_visual(
    manager: State<'_, ShellVisualManager>,
    request: StartShellVisualRequest,
    on_event: Channel<ShellVisualEvent>,
) -> StartThumbnailResponse {
    let manager = manager.inner().clone();
    let (task_id, cancellation) = manager.begin();
    tauri::async_runtime::spawn_blocking(move || {
        let generation = request.generation;
        if on_event
            .send(ShellVisualEvent::Started {
                task_id,
                generation,
            })
            .is_err()
        {
            cancellation.cancel();
        }
        let event = match manager.inner.shell_workers.enter(&cancellation) {
            Ok(_permit) => match load_shell_visual(&manager, &request, &cancellation) {
                Ok(visual) if !cancellation.is_cancelled() => ShellVisualEvent::Ready {
                    task_id,
                    generation,
                    visual,
                },
                Ok(_) | Err(ThumbnailError::Cancelled) => ShellVisualEvent::Cancelled {
                    task_id,
                    generation,
                },
                Err(ThumbnailError::Message(message)) => ShellVisualEvent::Error {
                    task_id,
                    generation,
                    message,
                },
            },
            Err(ThumbnailError::Cancelled) => ShellVisualEvent::Cancelled {
                task_id,
                generation,
            },
            Err(ThumbnailError::Message(message)) => ShellVisualEvent::Error {
                task_id,
                generation,
                message,
            },
        };
        let _ = on_event.send(event);
        manager.finish(task_id);
    });
    StartThumbnailResponse { task_id }
}

#[tauri::command]
pub fn cancel_shell_visual(
    manager: State<'_, ShellVisualManager>,
    task_id: u64,
) -> CancelThumbnailResponse {
    CancelThumbnailResponse {
        task_id,
        cancelled: manager.cancel(task_id),
    }
}

#[derive(Debug)]
enum ThumbnailError {
    Cancelled,
    Message(String),
}

fn load_shell_visual(
    manager: &ShellVisualManager,
    request: &StartShellVisualRequest,
    cancellation: &CancellationToken,
) -> Result<ShellVisual, ThumbnailError> {
    if cancellation.is_cancelled() {
        return Err(ThumbnailError::Cancelled);
    }
    let metadata = fs::symlink_metadata(&request.path).map_err(|error| {
        ThumbnailError::Message(format!(
            "cannot inspect {}: {error}",
            request.path.display()
        ))
    })?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(ThumbnailError::Message(format!(
            "Shell visual requires a file or directory: {}",
            request.path.display()
        )));
    }
    let canonical = fs::canonicalize(&request.path).map_err(|error| {
        ThumbnailError::Message(format!(
            "cannot resolve {}: {error}",
            request.path.display()
        ))
    })?;
    let modified_unix_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|value| u64::try_from(value.as_millis()).ok());
    let physical_size = ((request.logical_size.clamp(16, 256) as f64)
        * request.scale_factor.clamp(1.0, 4.0))
    .round()
    .clamp(16.0, 1024.0) as u32;
    let key = VisualCacheKey {
        path: canonical,
        physical_size,
        preference: request.preference,
        theme: request.theme.to_ascii_lowercase(),
    };
    if let Some(visual) =
        lock_unpoisoned(&manager.inner.visual_cache).get(&key, metadata.len(), modified_unix_ms)
    {
        return Ok(visual);
    }

    let (image, visual_type) = load_platform_visual(
        manager,
        &request.path,
        physical_size,
        request.preference,
        metadata.is_dir(),
        cancellation,
    )?;
    if cancellation.is_cancelled() {
        return Err(ThumbnailError::Cancelled);
    }
    let width = image.width();
    let height = image.height();
    let data_url = encode_rgba_data_url(image)?;
    let visual = ShellVisual {
        path: request.path.clone(),
        data_url,
        width,
        height,
        source_bytes: metadata.len(),
        modified_unix_ms,
        visual_type,
    };
    lock_unpoisoned(&manager.inner.visual_cache).insert(key, visual.clone());
    Ok(visual)
}

fn encode_rgba_data_url(image: RgbaImage) -> Result<String, ThumbnailError> {
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|error| ThumbnailError::Message(format!("cannot encode Shell visual: {error}")))?;
    Ok(format!(
        "data:image/png;base64,{}",
        BASE64.encode(encoded.into_inner())
    ))
}

fn load_image_fallback(
    manager: &ShellVisualManager,
    path: &Path,
    size: u32,
    cancellation: &CancellationToken,
) -> Result<(RgbaImage, String), ThumbnailError> {
    let thumbnail = load_thumbnail(manager, path, size, cancellation)?;
    let encoded = thumbnail
        .data_url
        .split_once(',')
        .map(|(_, value)| value)
        .ok_or_else(|| ThumbnailError::Message("invalid image thumbnail data".to_owned()))?;
    let bytes = BASE64.decode(encoded).map_err(|error| {
        ThumbnailError::Message(format!("cannot decode image thumbnail: {error}"))
    })?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| ThumbnailError::Message(format!("cannot read image thumbnail: {error}")))?
        .to_rgba8();
    Ok((image, "image-thumbnail".to_owned()))
}

fn folder_composite(
    path: &Path,
    size: u32,
    cancellation: &CancellationToken,
) -> Result<Option<RgbaImage>, ThumbnailError> {
    let entries = fs::read_dir(path).map_err(|error| {
        ThumbnailError::Message(format!("cannot read folder {}: {error}", path.display()))
    })?;
    let mut candidates = Vec::new();
    for result in entries.take(MAX_FOLDER_CANDIDATES) {
        if cancellation.is_cancelled() {
            return Err(ThumbnailError::Cancelled);
        }
        let entry = match result {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let entry_path = entry.path();
        let metadata = match fs::symlink_metadata(&entry_path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let extension = entry_path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        if !metadata.file_type().is_symlink()
            && metadata.is_file()
            && extension.as_deref().is_some_and(|value| {
                matches!(
                    value,
                    "bmp" | "gif" | "ico" | "jpeg" | "jpg" | "png" | "webp"
                )
            })
        {
            candidates.push(entry_path);
            if candidates.len() >= MAX_FOLDER_IMAGES {
                break;
            }
        }
    }
    if candidates.is_empty() {
        return Ok(None);
    }
    let gap = (size / 32).clamp(2, 8);
    let cell = (size.saturating_sub(gap * 3)) / 2;
    let mut canvas = RgbaImage::new(size, size);
    let mut rendered = 0_usize;
    for candidate in candidates {
        if cancellation.is_cancelled() {
            return Err(ThumbnailError::Cancelled);
        }
        let decoded = match ImageReader::open(&candidate)
            .and_then(ImageReader::with_guessed_format)
            .ok()
            .and_then(|reader| reader.decode().ok())
        {
            Some(decoded) => decoded,
            None => continue,
        };
        let thumbnail = decoded.thumbnail(cell, cell).to_rgba8();
        let column = rendered % 2;
        let row = rendered / 2;
        let x = gap + column as u32 * (cell + gap) + (cell - thumbnail.width()) / 2;
        let y = gap + row as u32 * (cell + gap) + (cell - thumbnail.height()) / 2;
        imageops::overlay(&mut canvas, &thumbnail, i64::from(x), i64::from(y));
        rendered += 1;
    }
    Ok((rendered > 0).then_some(canvas))
}

fn pptx_embedded_thumbnail(
    path: &Path,
    size: u32,
    cancellation: &CancellationToken,
) -> Result<Option<RgbaImage>, ThumbnailError> {
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("pptx"))
    {
        return Ok(None);
    }
    if cancellation.is_cancelled() {
        return Err(ThumbnailError::Cancelled);
    }
    let file = fs::File::open(path).map_err(|error| {
        ThumbnailError::Message(format!("cannot open PPTX {}: {error}", path.display()))
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| {
        ThumbnailError::Message(format!("cannot read PPTX {}: {error}", path.display()))
    })?;
    for name in [
        "docProps/thumbnail.jpeg",
        "docProps/thumbnail.jpg",
        "docProps/thumbnail.png",
        "docProps/thumbnail.webp",
    ] {
        let Ok(mut entry) = archive.by_name(name) else {
            continue;
        };
        if entry.size() > MAX_EMBEDDED_THUMBNAIL_BYTES {
            return Err(ThumbnailError::Message(
                "PPTX embedded thumbnail exceeds the 16 MB limit".to_owned(),
            ));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .by_ref()
            .take(MAX_EMBEDDED_THUMBNAIL_BYTES.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| {
                ThumbnailError::Message(format!("cannot read PPTX cover image: {error}"))
            })?;
        if bytes.len() as u64 > MAX_EMBEDDED_THUMBNAIL_BYTES {
            return Err(ThumbnailError::Message(
                "PPTX embedded thumbnail exceeds the 16 MB limit".to_owned(),
            ));
        }
        if cancellation.is_cancelled() {
            return Err(ThumbnailError::Cancelled);
        }
        let decoded = image::load_from_memory(&bytes).map_err(|error| {
            ThumbnailError::Message(format!("cannot decode PPTX cover image: {error}"))
        })?;
        let pixels = u64::from(decoded.width()).saturating_mul(u64::from(decoded.height()));
        if pixels > MAX_SOURCE_PIXELS {
            return Err(ThumbnailError::Message(
                "PPTX cover image exceeds the 80 megapixel limit".to_owned(),
            ));
        }
        return Ok(Some(decoded.thumbnail(size, size).to_rgba8()));
    }
    Ok(None)
}

#[cfg(not(windows))]
fn load_platform_visual(
    manager: &ShellVisualManager,
    path: &Path,
    size: u32,
    preference: ShellVisualPreference,
    is_directory: bool,
    cancellation: &CancellationToken,
) -> Result<(RgbaImage, String), ThumbnailError> {
    if is_directory && preference != ShellVisualPreference::Icon {
        if let Some(image) = folder_composite(path, size, cancellation)? {
            return Ok((image, "folder-composite".to_owned()));
        }
    }
    if !is_directory && preference != ShellVisualPreference::Icon {
        if let Some(image) = pptx_embedded_thumbnail(path, size, cancellation)? {
            return Ok((image, "pptx-embedded-thumbnail".to_owned()));
        }
        return load_image_fallback(manager, path, size, cancellation);
    }
    Err(ThumbnailError::Message(
        "Shell visuals are available only on Windows".to_owned(),
    ))
}

#[cfg(windows)]
fn load_platform_visual(
    manager: &ShellVisualManager,
    path: &Path,
    size: u32,
    preference: ShellVisualPreference,
    is_directory: bool,
    cancellation: &CancellationToken,
) -> Result<(RgbaImage, String), ThumbnailError> {
    use std::os::windows::ffi::OsStrExt as _;

    use windows::{
        Win32::{
            Foundation::SIZE,
            System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize},
            UI::Shell::{
                IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_BIGGERSIZEOK,
                SIIGBF_ICONONLY, SIIGBF_SCALEUP, SIIGBF_THUMBNAILONLY,
            },
        },
        core::PCWSTR,
    };

    struct ComApartment;
    impl Drop for ComApartment {
        fn drop(&mut self) {
            // SAFETY: this guard is created only after successful initialization on this thread.
            unsafe { CoUninitialize() };
        }
    }

    // Each call runs in the bounded Shell worker gate and initializes the blocking worker as STA.
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if initialized.is_err() {
        return Err(ThumbnailError::Message(format!(
            "cannot initialize the Windows Shell apartment: {initialized:?}"
        )));
    }
    let _apartment = ComApartment;
    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let factory: IShellItemImageFactory =
        unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }.map_err(|error| {
            ThumbnailError::Message(format!(
                "Windows Shell could not inspect {}: {error}",
                path.display()
            ))
        })?;
    let dimensions = SIZE {
        cx: size as i32,
        cy: size as i32,
    };
    let flags =
        |values: &[SIIGBF]| SIIGBF(values.iter().fold(0, |combined, value| combined | value.0));
    let read = |image_flags: SIIGBF| -> Result<RgbaImage, ThumbnailError> {
        if cancellation.is_cancelled() {
            return Err(ThumbnailError::Cancelled);
        }
        let bitmap = unsafe { factory.GetImage(dimensions, image_flags) }.map_err(|error| {
            ThumbnailError::Message(format!("Windows Shell visual provider failed: {error}"))
        })?;
        bitmap_to_rgba(bitmap)
    };

    if is_directory && preference != ShellVisualPreference::Icon {
        if let Ok(image) = read(flags(&[
            SIIGBF_THUMBNAILONLY,
            SIIGBF_BIGGERSIZEOK,
            SIIGBF_SCALEUP,
        ])) {
            return Ok((image, "shell-thumbnail".to_owned()));
        }
        if let Some(image) = folder_composite(path, size, cancellation)? {
            return Ok((image, "folder-composite".to_owned()));
        }
        if preference == ShellVisualPreference::Thumbnail {
            return Err(ThumbnailError::Message(
                "Windows Shell did not provide a folder thumbnail".to_owned(),
            ));
        }
    }

    if !is_directory && preference != ShellVisualPreference::Icon {
        let requested_flags = if preference == ShellVisualPreference::Thumbnail {
            flags(&[SIIGBF_THUMBNAILONLY, SIIGBF_BIGGERSIZEOK, SIIGBF_SCALEUP])
        } else {
            flags(&[SIIGBF_BIGGERSIZEOK, SIIGBF_SCALEUP])
        };
        if let Ok(image) = read(requested_flags) {
            return Ok((image, "shell-thumbnail".to_owned()));
        }
        if let Some(image) = pptx_embedded_thumbnail(path, size, cancellation)? {
            return Ok((image, "pptx-embedded-thumbnail".to_owned()));
        }
        if let Ok(fallback) = load_image_fallback(manager, path, size, cancellation) {
            return Ok(fallback);
        }
        if preference == ShellVisualPreference::Thumbnail {
            return Err(ThumbnailError::Message(
                "Windows Shell did not provide a file thumbnail".to_owned(),
            ));
        }
    }

    read(flags(&[
        SIIGBF_ICONONLY,
        SIIGBF_BIGGERSIZEOK,
        SIIGBF_SCALEUP,
    ]))
    .map(|image| (image, "shell-icon".to_owned()))
}

#[cfg(windows)]
fn bitmap_to_rgba(
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
) -> Result<RgbaImage, ThumbnailError> {
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAP, BITMAPINFO, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits, GetObjectW,
        HGDIOBJ, ReleaseDC,
    };

    struct OwnedBitmap(windows::Win32::Graphics::Gdi::HBITMAP);
    impl Drop for OwnedBitmap {
        fn drop(&mut self) {
            // SAFETY: the HBITMAP was returned with ownership by IShellItemImageFactory.
            unsafe {
                let _ = DeleteObject(HGDIOBJ(self.0.0));
            }
        }
    }

    let bitmap = OwnedBitmap(bitmap);
    let mut details = BITMAP::default();
    let read = unsafe {
        GetObjectW(
            HGDIOBJ(bitmap.0.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some((&mut details as *mut BITMAP).cast()),
        )
    };
    if read == 0 || details.bmWidth <= 0 || details.bmHeight == 0 {
        return Err(ThumbnailError::Message(
            "Windows Shell returned an invalid bitmap".to_owned(),
        ));
    }
    let width = details.bmWidth as u32;
    let height = details.bmHeight.unsigned_abs();
    let byte_count = u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_mul(4);
    let byte_count = usize::try_from(byte_count)
        .map_err(|_| ThumbnailError::Message("Shell bitmap is too large".to_owned()))?;
    if byte_count > MAX_VISUAL_CACHE_BYTES {
        return Err(ThumbnailError::Message(
            "Shell bitmap exceeds the visual budget".to_owned(),
        ));
    }
    let mut pixels = vec![0_u8; byte_count];
    let mut info = BITMAPINFO::default();
    info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
    info.bmiHeader.biWidth = width as i32;
    info.bmiHeader.biHeight = -(height as i32);
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB.0;
    let device = unsafe { GetDC(None) };
    if device.is_invalid() {
        return Err(ThumbnailError::Message(
            "cannot access a screen device context".to_owned(),
        ));
    }
    let copied = unsafe {
        GetDIBits(
            device,
            bitmap.0,
            0,
            height,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        let _ = ReleaseDC(None, device);
    }
    if copied == 0 {
        return Err(ThumbnailError::Message(
            "cannot read pixels from the Shell bitmap".to_owned(),
        ));
    }

    let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
    for pixel in pixels.chunks_exact_mut(4) {
        let [blue, green, red, alpha] = [pixel[0], pixel[1], pixel[2], pixel[3]];
        let alpha = if has_alpha { alpha } else { 255 };
        let unpremultiply = |channel: u8| {
            if alpha == 0 || alpha == 255 {
                channel
            } else {
                ((u16::from(channel) * 255) / u16::from(alpha)).min(255) as u8
            }
        };
        pixel[0] = unpremultiply(red);
        pixel[1] = unpremultiply(green);
        pixel[2] = unpremultiply(blue);
        pixel[3] = alpha;
    }
    RgbaImage::from_raw(width, height, pixels).ok_or_else(|| {
        ThumbnailError::Message("Shell bitmap dimensions do not match its pixels".to_owned())
    })
}

fn load_thumbnail(
    manager: &ThumbnailManager,
    requested: &Path,
    max_edge: u32,
    cancellation: &CancellationToken,
) -> Result<ImageThumbnail, ThumbnailError> {
    if cancellation.is_cancelled() {
        return Err(ThumbnailError::Cancelled);
    }
    let metadata = fs::symlink_metadata(requested).map_err(|error| {
        ThumbnailError::Message(format!("cannot inspect {}: {error}", requested.display()))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ThumbnailError::Message(format!(
            "thumbnail requires a regular file: {}",
            requested.display()
        )));
    }
    let canonical = fs::canonicalize(requested).map_err(|error| {
        ThumbnailError::Message(format!("cannot resolve {}: {error}", requested.display()))
    })?;
    let modified_unix_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|value| u64::try_from(value.as_millis()).ok());
    let key = CacheKey {
        path: canonical,
        max_edge,
    };
    if let Some(thumbnail) =
        lock_unpoisoned(&manager.inner.cache).get(&key, metadata.len(), modified_unix_ms)
    {
        return Ok(thumbnail);
    }

    let reader = ImageReader::open(requested)
        .and_then(ImageReader::with_guessed_format)
        .map_err(|error| {
            ThumbnailError::Message(format!(
                "cannot open image {}: {error}",
                requested.display()
            ))
        })?;
    let (source_width, source_height) = reader.into_dimensions().map_err(|error| {
        ThumbnailError::Message(format!("cannot read image dimensions: {error}"))
    })?;
    if u64::from(source_width).saturating_mul(u64::from(source_height)) > MAX_SOURCE_PIXELS {
        return Err(ThumbnailError::Message(format!(
            "image exceeds the {} megapixel thumbnail limit",
            MAX_SOURCE_PIXELS / 1_000_000
        )));
    }
    if cancellation.is_cancelled() {
        return Err(ThumbnailError::Cancelled);
    }
    let decoded = ImageReader::open(requested)
        .and_then(ImageReader::with_guessed_format)
        .map_err(|error| ThumbnailError::Message(format!("cannot reopen image: {error}")))?
        .decode()
        .map_err(|error| ThumbnailError::Message(format!("cannot decode image: {error}")))?;
    if cancellation.is_cancelled() {
        return Err(ThumbnailError::Cancelled);
    }
    let resized = decoded.thumbnail(max_edge, max_edge);
    let width = resized.width();
    let height = resized.height();
    let mut encoded = Cursor::new(Vec::new());
    resized
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|error| ThumbnailError::Message(format!("cannot encode thumbnail: {error}")))?;
    let thumbnail = ImageThumbnail {
        path: requested.to_path_buf(),
        data_url: format!(
            "data:image/png;base64,{}",
            BASE64.encode(encoded.into_inner())
        ),
        source_width,
        source_height,
        width,
        height,
        source_bytes: metadata.len(),
        modified_unix_ms,
    };
    lock_unpoisoned(&manager.inner.cache).insert(key, thumbnail.clone());
    Ok(thumbnail)
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{Cursor, Write as _},
    };

    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use tempfile::tempdir;
    use zip::{ZipWriter, write::SimpleFileOptions};

    use super::{
        MAX_VISUAL_CACHE_ENTRIES, ShellVisual, ShellVisualCache, ShellVisualPreference,
        ThumbnailManager, VisualCacheKey, folder_composite, load_thumbnail,
        pptx_embedded_thumbnail,
    };

    #[test]
    fn thumbnail_is_bounded_and_preserves_aspect_ratio() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("wide.png");
        ImageBuffer::from_pixel(800, 400, Rgba([168_u8, 85, 247, 255]))
            .save(&path)
            .expect("fixture image");
        let thumbnail = load_thumbnail(
            &ThumbnailManager::default(),
            &path,
            200,
            &Default::default(),
        )
        .expect("thumbnail");
        assert_eq!(
            (thumbnail.source_width, thumbnail.source_height),
            (800, 400)
        );
        assert_eq!((thumbnail.width, thumbnail.height), (200, 100));
        assert!(thumbnail.data_url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn pptx_embedded_cover_is_rendered_without_a_shell_provider() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("deck.pptx");
        let source = ImageBuffer::from_pixel(800, 450, Rgba([31_u8, 111, 235, 255]));
        let mut png = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(source)
            .write_to(&mut png, ImageFormat::Png)
            .expect("cover PNG");
        let file = fs::File::create(&path).expect("PPTX fixture");
        let mut archive = ZipWriter::new(file);
        archive
            .start_file("docProps/thumbnail.png", SimpleFileOptions::default())
            .expect("cover entry");
        archive.write_all(&png.into_inner()).expect("cover bytes");
        archive.finish().expect("finish PPTX fixture");

        let cover = pptx_embedded_thumbnail(&path, 320, &Default::default())
            .expect("read PPTX cover")
            .expect("embedded cover");
        assert_eq!((cover.width(), cover.height()), (320, 180));
    }

    #[test]
    fn cancellation_stops_before_decode() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("image.png");
        fs::write(&path, b"not decoded").expect("fixture");
        let cancellation = muller_core::CancellationToken::default();
        cancellation.cancel();
        assert!(load_thumbnail(&ThumbnailManager::default(), &path, 200, &cancellation,).is_err());
    }

    #[test]
    fn shell_visual_cache_is_bounded_by_entry_count() {
        let mut cache = ShellVisualCache::default();
        for index in 0..=MAX_VISUAL_CACHE_ENTRIES {
            let path = std::path::PathBuf::from(format!("visual-{index}"));
            cache.insert(
                VisualCacheKey {
                    path: path.clone(),
                    physical_size: 32,
                    preference: ShellVisualPreference::Icon,
                    theme: "dark".to_owned(),
                },
                ShellVisual {
                    path,
                    data_url: "data:image/png;base64,AA==".to_owned(),
                    width: 1,
                    height: 1,
                    source_bytes: 0,
                    modified_unix_ms: None,
                    visual_type: "test".to_owned(),
                },
            );
        }
        assert_eq!(cache.entries.len(), MAX_VISUAL_CACHE_ENTRIES);
        assert!(
            !cache
                .entries
                .keys()
                .any(|key| key.path == std::path::Path::new("visual-0"))
        );
    }

    #[test]
    fn folder_composite_reads_only_direct_image_candidates() {
        let fixture = tempdir().expect("fixture");
        for (name, color) in [
            ("one.png", Rgba([255_u8, 0, 0, 255])),
            ("two.png", Rgba([0_u8, 255, 0, 255])),
            ("three.png", Rgba([0_u8, 0, 255, 255])),
        ] {
            ImageBuffer::from_pixel(40, 20, color)
                .save(fixture.path().join(name))
                .expect("fixture image");
        }
        fs::write(fixture.path().join("ignored.txt"), "text").expect("text fixture");

        let composite = folder_composite(fixture.path(), 128, &Default::default())
            .expect("composite")
            .expect("folder image");

        assert_eq!(composite.dimensions(), (128, 128));
        assert!(composite.pixels().any(|pixel| pixel[3] != 0));
    }

    #[cfg(windows)]
    #[test]
    fn windows_shell_returns_a_real_file_icon() {
        let fixture = tempdir().expect("fixture");
        let path = fixture.path().join("notes.txt");
        fs::write(&path, "notes").expect("text fixture");

        let (image, visual_type) = super::load_platform_visual(
            &ThumbnailManager::default(),
            &path,
            32,
            ShellVisualPreference::Icon,
            false,
            &Default::default(),
        )
        .expect("Windows Shell icon");

        assert!(image.width() > 0 && image.height() > 0);
        assert_eq!(visual_type, "shell-icon");
    }
}
