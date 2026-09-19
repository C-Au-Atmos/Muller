//! Read-only NTFS filename index. MFT enumeration supplies one name per file
//! record; USN replay maintains the parent graph without restating every file.
//! Hard-link aliases and directory byte totals require separate enumeration.

#[cfg(test)]
use std::time::Duration;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use muller_core::CancellationToken;
use serde::{Deserialize, Serialize};

const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const REASON_DELETE: u32 = 0x200;
const REASON_RENAME_OLD: u32 = 0x1000;
const REASON_RENAME_NEW: u32 = 0x2000;
const SNAPSHOT_VERSION: u32 = 1;
const MAX_SNAPSHOT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SNAPSHOT_NODES: usize = 2_000_000;

#[derive(Debug, Clone)]
pub struct NativeHit {
    pub path: PathBuf,
    pub name: String,
    pub is_directory: bool,
    pub attributes: u32,
}

#[derive(Debug)]
struct Node {
    parent: u64,
    name: OsString,
    folded_name: String,
    attributes: u32,
    usn: i64,
}

#[derive(Debug)]
struct Record {
    id: u64,
    parent: u64,
    usn: i64,
    reason: u32,
    attributes: u32,
    name: Vec<u16>,
}

#[derive(Debug, Clone, Copy)]
struct Journal {
    id: u64,
    first: i64,
    next: i64,
    lowest_valid: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedVolume {
    version: u32,
    root: PathBuf,
    root_id: u64,
    serial: u32,
    journal_id: u64,
    next_usn: i64,
    checksum: u64,
    nodes: Vec<PersistedNode>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedNode {
    id: u64,
    parent: u64,
    name: Vec<u16>,
    attributes: u32,
    usn: i64,
}

/// No OS handles are retained, so an index can move between worker threads.
#[derive(Debug)]
pub struct NativeVolume {
    root: PathBuf,
    root_id: u64,
    serial: u32,
    journal_id: u64,
    next_usn: i64,
    // Ordered IDs give stable pagination without sorting/materializing all hits.
    nodes: BTreeMap<u64, Node>,
    valid: bool,
}

impl NativeVolume {
    pub fn build(root: &Path, cancel: &CancellationToken) -> Result<Self, String> {
        check_cancel(cancel)?;
        #[cfg(windows)]
        {
            platform::build(root, cancel)
        }
        #[cfg(not(windows))]
        {
            let _ = root;
            Err("NTFS MFT/USN indexing is only available on Windows".into())
        }
    }

    /// Replay only to the watermark captured at entry. A busy volume cannot
    /// keep this call waiting for future events. Any failure invalidates this
    /// generation; the broker must rebuild or use the portable fallback.
    pub fn refresh(&mut self, cancel: &CancellationToken) -> Result<usize, String> {
        if !self.valid {
            return Err("NTFS index is invalid; rebuild required".into());
        }
        self.valid = false;
        check_cancel(cancel)?;
        #[cfg(windows)]
        {
            let changes = platform::refresh(self, cancel)?;
            self.valid = true;
            Ok(changes)
        }
        #[cfg(not(windows))]
        {
            Err("NTFS MFT/USN indexing is only available on Windows".into())
        }
    }

    /// Load a previous MFT snapshot before opening the volume. The snapshot
    /// only contains names, parent IDs and the USN watermark; callers must
    /// replay the journal before exposing it as ready. A malformed, stale or
    /// oversized file is rejected so the caller can perform a clean rebuild.
    pub fn load_persisted(path: &Path, cancel: &CancellationToken) -> Result<Self, String> {
        check_cancel(cancel)?;
        reject_reparse_path(path)?;
        let file = fs::File::open(path).map_err(|error| error.to_string())?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if metadata.len() > MAX_SNAPSHOT_BYTES {
            return Err("NTFS snapshot exceeds the safety size limit".into());
        }
        use std::io::Read;
        let mut bytes = Vec::new();
        file.take(MAX_SNAPSHOT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
            return Err("NTFS snapshot exceeds the safety size limit".into());
        }
        check_cancel(cancel)?;
        let persisted: PersistedVolume = serde_json::from_slice(&bytes)
            .map_err(|error| format!("invalid NTFS snapshot: {error}"))?;
        if persisted.version != SNAPSHOT_VERSION {
            return Err("unsupported NTFS snapshot version".into());
        }
        if persisted.nodes.len() > MAX_SNAPSHOT_NODES {
            return Err("NTFS snapshot contains too many records".into());
        }
        if persisted.checksum != snapshot_checksum(&persisted) {
            return Err("NTFS snapshot checksum mismatch".into());
        }
        let root_text = persisted.root.to_string_lossy();
        if root_text.len() != 3
            || !root_text.as_bytes()[0].is_ascii_alphabetic()
            || &root_text.as_bytes()[1..] != b":\\"
            || persisted.next_usn < 0
        {
            return Err("invalid NTFS snapshot volume identity".into());
        }
        let mut nodes = BTreeMap::new();
        for node in persisted.nodes {
            check_cancel(cancel)?;
            if node.id == persisted.root_id
                || !valid_name(&node.name)
                || nodes.contains_key(&node.id)
            {
                return Err("invalid NTFS snapshot node graph".into());
            }
            let name = os_name(&node.name);
            let folded_name = name.to_string_lossy().to_lowercase();
            nodes.insert(
                node.id,
                Node {
                    parent: node.parent,
                    name,
                    folded_name,
                    attributes: node.attributes,
                    usn: node.usn,
                },
            );
        }
        Ok(Self {
            root: persisted.root,
            root_id: persisted.root_id,
            serial: persisted.serial,
            journal_id: persisted.journal_id,
            next_usn: persisted.next_usn,
            nodes,
            valid: true,
        })
    }

    /// Atomically write the current MFT/USN state. The temporary file is
    /// synced before replacement so a process or power loss cannot destroy a
    /// previously valid snapshot.
    pub fn persist(&self, path: &Path) -> Result<(), String> {
        if !self.valid {
            return Err("cannot persist an invalid NTFS index".into());
        }
        if self.nodes.len() > MAX_SNAPSHOT_NODES {
            return Err("NTFS snapshot contains too many records".into());
        }
        let mut persisted = PersistedVolume {
            version: SNAPSHOT_VERSION,
            root: self.root.clone(),
            root_id: self.root_id,
            serial: self.serial,
            journal_id: self.journal_id,
            next_usn: self.next_usn,
            checksum: 0,
            nodes: self
                .nodes
                .iter()
                .map(|(id, node)| PersistedNode {
                    id: *id,
                    parent: node.parent,
                    name: os_name_units(&node.name),
                    attributes: node.attributes,
                    usn: node.usn,
                })
                .collect(),
        };
        persisted.checksum = snapshot_checksum(&persisted);
        let bytes = serde_json::to_vec(&persisted).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
            return Err("NTFS snapshot exceeds the safety size limit".into());
        }
        atomic_snapshot_write(path, &bytes)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn watermark(&self) -> i64 {
        self.next_usn
    }

    /// Cache validation must not wait while a busy journal catches up. The
    /// background refresh owns replay; a lagging watermark simply skips the
    /// optional space preview for this request.
    pub fn validate_current(&self, cancel: &CancellationToken) -> Result<(), String> {
        check_cancel(cancel)?;
        if !self.valid {
            return Err("NTFS index is not ready".into());
        }
        #[cfg(windows)]
        {
            platform::validate_current(self)
        }
        #[cfg(not(windows))]
        {
            Err("NTFS indexing requires Windows".into())
        }
    }

    /// A watermark for a previously measured subtree, not a source of sizes.
    /// Consumers still verify cached totals with ordinary-privilege traversal.
    #[cfg(test)]
    pub fn space_stamp(&self, root: &Path, cancel: &CancellationToken) -> Result<String, String> {
        self.space_stamp_until(root, cancel, Instant::now() + Duration::from_millis(180))
    }

    pub fn space_stamp_until(
        &self,
        root: &Path,
        cancel: &CancellationToken,
        deadline: Instant,
    ) -> Result<String, String> {
        use std::hash::{Hash, Hasher};
        let check = || -> Result<(), String> {
            check_cancel(cancel)?;
            if Instant::now() >= deadline {
                Err("space cache validation budget exceeded".into())
            } else {
                Ok(())
            }
        };
        check()?;
        if !self.valid {
            return Err("NTFS index is not ready".into());
        }
        let scope = folded_path(root);
        let volume = folded_path(&self.root);
        if scope != volume && !path_is_within(&scope, &volume) {
            return Err("space root is outside the indexed volume".into());
        }
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        (self.serial, self.journal_id, self.root_id, &scope).hash(&mut hash);

        // Match the requested directory by its final component first; only
        // matching candidates walk their parent chain. No full-volume path
        // allocation is needed, even for deeply nested files.
        let components: Vec<_> = scope[volume.len()..]
            .split('\\')
            .filter(|part| !part.is_empty())
            .collect();
        let mut scope_id = (scope == volume).then_some(self.root_id);
        let mut ancestors = HashSet::new();
        if let Some(last) = components.last() {
            for (&id, node) in &self.nodes {
                check()?;
                if node.folded_name != *last || node.attributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
                    continue;
                }
                let mut current = id;
                let mut chain = Vec::with_capacity(components.len());
                for name in components.iter().rev() {
                    check()?;
                    let Some(part) = self.nodes.get(&current) else {
                        break;
                    };
                    if part.folded_name != *name
                        || part.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                        || part.attributes & FILE_ATTRIBUTE_DIRECTORY == 0
                    {
                        break;
                    }
                    chain.push(current);
                    current = part.parent;
                }
                if chain.len() == components.len() && current == self.root_id {
                    ancestors.extend(chain);
                    scope_id = Some(id);
                    break;
                }
            }
        }
        let scope_id = scope_id.ok_or("space root is absent from the native index")?;
        let mut membership = HashMap::<u64, bool>::new();
        membership.insert(self.root_id, scope_id == self.root_id);
        membership.insert(scope_id, true);
        let mut chain = Vec::new();
        for (&id, node) in &self.nodes {
            check()?;
            let mut current = node.parent;
            chain.clear();
            let within = loop {
                check()?;
                if let Some(within) = membership.get(&current) {
                    break *within;
                }
                // Mark before walking to bound malformed cycles. Every
                // directory is resolved once, shared by all its children.
                membership.insert(current, false);
                let Some(parent) = self.nodes.get(&current) else {
                    break false;
                };
                if parent.attributes & FILE_ATTRIBUTE_DIRECTORY == 0
                    || parent.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                {
                    break false;
                }
                chain.push(current);
                current = parent.parent;
            };
            for directory in &chain {
                membership.insert(*directory, within);
            }
            if within || id == scope_id || ancestors.contains(&id) {
                (id, node.parent, node.usn, node.attributes, &node.name).hash(&mut hash);
            }
        }
        check()?;
        Ok(format!("space-v2-{:016x}", hash.finish()))
    }

    /// Filename matching uses the cached folded name; paths are reconstructed
    /// only for matching records. No filesystem calls occur on this path.
    pub fn search_page(
        &self,
        query: &str,
        roots: &[PathBuf],
        offset: usize,
        limit: usize,
    ) -> (Vec<NativeHit>, bool) {
        let query = query.trim().to_lowercase();
        if !self.valid || query.is_empty() || roots.is_empty() || limit == 0 {
            return (Vec::new(), false);
        }
        let roots: Vec<_> = roots.iter().map(|root| folded_path(root)).collect();
        let mut hits = Vec::with_capacity(limit.min(2_000));
        let mut skipped = 0;
        for (&id, node) in &self.nodes {
            if id == self.root_id || !node.folded_name.contains(&query) {
                continue;
            }
            let Some(path) = self.resolve_path(id) else {
                continue;
            };
            let folded = folded_path(&path);
            if !roots.iter().any(|root| path_is_within(&folded, root)) {
                continue;
            }
            if skipped < offset {
                skipped += 1;
                continue;
            }
            if hits.len() == limit {
                return (hits, true);
            }
            hits.push(NativeHit {
                path,
                name: node.name.to_string_lossy().into_owned(),
                is_directory: node.attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
                attributes: node.attributes,
            });
        }
        (hits, false)
    }

    fn resolve_path(&self, mut id: u64) -> Option<PathBuf> {
        let original_id = id;
        let mut names = Vec::new();
        let mut seen = HashSet::new();
        while id != self.root_id {
            if !seen.insert(id) {
                return None;
            }
            let node = self.nodes.get(&id)?;
            if id != original_id && node.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return None;
            }
            names.push(&node.name);
            id = node.parent;
        }
        let mut path = self.root.clone();
        for name in names.into_iter().rev() {
            path.push(name);
        }
        Some(path)
    }

    fn apply(&mut self, record: Record, from_journal: bool) -> bool {
        if record.id == self.root_id {
            return false;
        }
        // Enumeration can observe a newer record than an early replay event.
        if self
            .nodes
            .get(&record.id)
            .is_some_and(|n| n.usn > record.usn)
        {
            return false;
        }
        if from_journal && record.reason & REASON_DELETE != 0 {
            return self.nodes.remove(&record.id).is_some();
        }
        // Keep the last complete name until RENAME_NEW_NAME arrives. Replacing
        // the directory node automatically changes all descendant paths.
        if from_journal
            && record.reason & REASON_RENAME_OLD != 0
            && record.reason & REASON_RENAME_NEW == 0
        {
            return false;
        }
        let name = os_name(&record.name);
        let folded_name = name.to_string_lossy().to_lowercase();
        let changed = self.nodes.get(&record.id).is_none_or(|node| {
            node.parent != record.parent
                || node.name != name
                || node.attributes != record.attributes
                || node.usn != record.usn
        });
        self.nodes.insert(
            record.id,
            Node {
                parent: record.parent,
                name,
                folded_name,
                attributes: record.attributes,
                usn: record.usn,
            },
        );
        changed
    }
}

/// Detect accidental snapshot corruption independently of JSON parsing. This
/// checksum is not authentication; cache paths are constrained by the broker
/// and restored state must still pass the live NTFS identity/journal checks.
fn snapshot_checksum(snapshot: &PersistedVolume) -> u64 {
    let mut checksum = 0xcbf29ce484222325_u64;
    let mut update = |bytes: &[u8]| {
        for byte in bytes {
            checksum = (checksum ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
        }
    };
    update(&snapshot.version.to_le_bytes());
    update(snapshot.root.to_string_lossy().as_bytes());
    update(&snapshot.root_id.to_le_bytes());
    update(&snapshot.serial.to_le_bytes());
    update(&snapshot.journal_id.to_le_bytes());
    update(&snapshot.next_usn.to_le_bytes());
    for node in &snapshot.nodes {
        update(&node.id.to_le_bytes());
        update(&node.parent.to_le_bytes());
        update(&node.attributes.to_le_bytes());
        update(&node.usn.to_le_bytes());
        update(&(node.name.len() as u64).to_le_bytes());
        for unit in &node.name {
            update(&unit.to_le_bytes());
        }
    }
    checksum
}

pub(crate) fn reject_reparse_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("native index cache requires an absolute path without parent traversal".into());
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if !matches!(path.components().next(), Some(Component::Prefix(prefix))
            if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
        {
            return Err("native index cache requires a local drive path".into());
        }
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                #[cfg(windows)]
                let reparse = {
                    use std::os::windows::fs::MetadataExt;
                    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                };
                #[cfg(not(windows))]
                let reparse = metadata.file_type().is_symlink();
                if reparse {
                    return Err(
                        "native index cache cannot use a reparse point or symbolic link".into(),
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

pub(crate) fn atomic_snapshot_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::{
        io::Write,
        sync::atomic::{AtomicU64, Ordering},
    };
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    reject_reparse_path(path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    reject_reparse_path(path)?;
    let temporary = path.with_extension(format!(
        "json.{}.{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    // Never open/truncate an existing temporary path, even if another process
    // deliberately pre-created a link at that name.
    let mut created = false;
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        created = true;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        reject_reparse_path(path)?;
        // Rust implements Windows rename via MoveFileExW(REPLACE_EXISTING).
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if created && result.is_err() {
        // Only remove our regular temporary file. An attacker-controlled link
        // is never followed, and every helper invocation uses the GUI token.
        if reject_reparse_path(&temporary).is_ok() {
            let _ = fs::remove_file(&temporary);
        }
    }
    result
}

fn valid_name(name: &[u16]) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name != [46]
        && name != [46, 46]
        && !name.iter().any(|unit| matches!(*unit, 0 | 47 | 58 | 92))
}

fn check_cancel(cancel: &CancellationToken) -> Result<(), String> {
    if cancel.is_cancelled() {
        Err("NTFS indexing cancelled".into())
    } else {
        Ok(())
    }
}

fn os_name(name: &[u16]) -> OsString {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStringExt;
        OsString::from_wide(name)
    }
    #[cfg(not(windows))]
    {
        OsString::from(String::from_utf16_lossy(name))
    }
}

fn os_name_units(name: &OsString) -> Vec<u16> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        name.encode_wide().collect()
    }
    #[cfg(not(windows))]
    {
        name.to_string_lossy().encode_utf16().collect()
    }
}

fn folded_path(path: &Path) -> String {
    let path = path.to_string_lossy().replace('/', "\\");
    path.strip_prefix("\\\\?\\")
        .unwrap_or(&path)
        .trim_end_matches('\\')
        .to_lowercase()
}

fn path_is_within(path: &str, root: &str) -> bool {
    path.strip_prefix(root)
        .is_some_and(|tail| tail.starts_with('\\'))
}

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(
        bytes[offset..offset + 2]
            .try_into()
            .expect("validated record"),
    )
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("validated record"),
    )
}

fn u64_at(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(
        bytes[offset..offset + 8]
            .try_into()
            .expect("validated record"),
    )
}

/// Parse unaligned kernel buffers without casting them to Rust structs.
fn parse_records(mut bytes: &[u8]) -> Result<Vec<Record>, String> {
    let mut records = Vec::new();
    while !bytes.is_empty() {
        if bytes.len() < 8 {
            return Err("truncated USN record header".into());
        }
        let length = u32_at(bytes, 0) as usize;
        let major = u16_at(bytes, 4);
        if major != 2 {
            return Err(format!(
                "unsupported USN record version {major}; rebuild with a supported provider"
            ));
        }
        if length < 60 || length > bytes.len() || !length.is_multiple_of(8) {
            return Err("invalid USN record length".into());
        }
        let name_length = u16_at(bytes, 56) as usize;
        let name_offset = u16_at(bytes, 58) as usize;
        if name_length == 0
            || !name_length.is_multiple_of(2)
            || name_offset < 60
            || !name_offset.is_multiple_of(2)
            || name_offset + name_length > length
        {
            return Err("invalid USN filename bounds".into());
        }
        let name: Vec<_> = bytes[name_offset..name_offset + name_length]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        if name.iter().any(|value| matches!(*value, 0 | 47 | 58 | 92)) || name == [46, 46] {
            return Err("invalid USN filename component".into());
        }
        records.push(Record {
            id: u64_at(bytes, 8),
            parent: u64_at(bytes, 16),
            usn: u64_at(bytes, 24) as i64,
            reason: u32_at(bytes, 40),
            attributes: u32_at(bytes, 52),
            name,
        });
        bytes = &bytes[length..];
    }
    Ok(records)
}

fn validate_journal(journal: Journal, expected_id: u64, cursor: i64) -> Result<(), String> {
    if journal.id != expected_id {
        return Err("USN journal ID changed; index rebuild required".into());
    }
    if cursor < journal.first.max(journal.lowest_valid) || cursor > journal.next {
        return Err("USN journal watermark was lost; index rebuild required".into());
    }
    Ok(())
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{ffi::c_void, mem::size_of, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_HANDLE_EOF, GENERIC_READ, HANDLE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_ATTRIBUTE_NORMAL,
            FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
            GetFileInformationByHandle, GetVolumeInformationW, OPEN_EXISTING,
        },
        System::{
            IO::DeviceIoControl,
            Ioctl::{
                FSCTL_ENUM_USN_DATA, FSCTL_QUERY_USN_JOURNAL, FSCTL_READ_USN_JOURNAL,
                MFT_ENUM_DATA_V0, READ_USN_JOURNAL_DATA_V0,
            },
        },
    };

    const BUFFER_SIZE: usize = 1024 * 1024;

    struct Handle(HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: every Handle owns a successful CreateFileW result.
            unsafe { CloseHandle(self.0) };
        }
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    fn open(path: &Path, access: u32, flags: u32) -> Result<Handle, String> {
        let path_wide = wide(path);
        // SAFETY: the UTF-16 buffer is NUL terminated and valid for this call.
        let handle = unsafe {
            CreateFileW(
                path_wide.as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                ptr::null(),
                OPEN_EXISTING,
                flags,
                ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(format!(
                "cannot open {} for NTFS indexing: {} (an elevated indexer and a local NTFS volume are required)",
                path.display(),
                std::io::Error::last_os_error()
            ));
        }
        Ok(Handle(handle))
    }

    fn volume_root(path: &Path) -> Result<PathBuf, String> {
        let text = path.to_string_lossy().replace('/', "\\");
        let text = text.strip_prefix("\\\\?\\").unwrap_or(&text);
        let bytes = text.as_bytes();
        if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1..3] != *b":\\" {
            return Err(
                "native NTFS indexing requires an absolute local drive path (for example C:\\)"
                    .into(),
            );
        }
        Ok(PathBuf::from(format!(
            "{}:\\",
            (bytes[0] as char).to_ascii_uppercase()
        )))
    }

    fn identity(root: &Path) -> Result<(u64, u32), String> {
        let root_wide = wide(root);
        let mut filesystem = [0u16; 32];
        // SAFETY: all non-null output pointers reference writable buffers.
        let ok = unsafe {
            GetVolumeInformationW(
                root_wide.as_ptr(),
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                filesystem.as_mut_ptr(),
                filesystem.len() as u32,
            )
        };
        if ok == 0 {
            return Err(format!(
                "cannot inspect volume {}: {}",
                root.display(),
                std::io::Error::last_os_error()
            ));
        }
        let end = filesystem
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(filesystem.len());
        if String::from_utf16_lossy(&filesystem[..end]) != "NTFS" {
            return Err(format!(
                "{} is not NTFS; portable indexing required",
                root.display()
            ));
        }
        let handle = open(root, 0, FILE_FLAG_BACKUP_SEMANTICS)?;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        // SAFETY: handle is valid and info is a properly sized output struct.
        if unsafe { GetFileInformationByHandle(handle.0, &mut info) } == 0 {
            return Err(format!(
                "cannot read NTFS root file ID: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok((
            (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
            info.dwVolumeSerialNumber,
        ))
    }

    fn open_volume(root: &Path) -> Result<Handle, String> {
        let text = root.to_string_lossy();
        open(
            Path::new(&format!("\\\\.\\{}", &text[..2])),
            GENERIC_READ,
            FILE_ATTRIBUTE_NORMAL,
        )
    }

    fn ioctl<T>(
        handle: &Handle,
        code: u32,
        input: Option<&T>,
        output: &mut [u8],
    ) -> Result<usize, std::io::Error> {
        let (input_ptr, input_len) = input.map_or((ptr::null(), 0), |input| {
            (ptr::from_ref(input).cast::<c_void>(), size_of::<T>() as u32)
        });
        let mut returned = 0;
        // SAFETY: input/output point to their declared sizes; synchronous call
        // does not retain either pointer. No overlapped operation is started.
        let ok = unsafe {
            DeviceIoControl(
                handle.0,
                code,
                input_ptr,
                input_len,
                output.as_mut_ptr().cast(),
                output.len() as u32,
                &mut returned,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            Err(std::io::Error::last_os_error())
        } else if returned as usize > output.len() {
            Err(std::io::Error::other("invalid NTFS response length"))
        } else {
            Ok(returned as usize)
        }
    }

    fn journal(handle: &Handle) -> Result<Journal, String> {
        let mut output = [0u8; 128];
        let length = ioctl::<()>(handle, FSCTL_QUERY_USN_JOURNAL, None, &mut output)
            .map_err(|e| format!("cannot query USN journal (it must already be enabled): {e}"))?;
        if length < 56 {
            return Err("truncated USN journal information".into());
        }
        Ok(Journal {
            id: u64_at(&output, 0),
            first: u64_at(&output, 8) as i64,
            next: u64_at(&output, 16) as i64,
            lowest_valid: u64_at(&output, 24) as i64,
        })
    }

    pub(super) fn build(root: &Path, cancel: &CancellationToken) -> Result<NativeVolume, String> {
        let root = volume_root(root)?;
        let (root_id, serial) = identity(&root)?;
        let handle = open_volume(&root)?;
        // Capture before enumeration; changes during the initial pass are
        // replayed afterwards, including files created behind the MFT cursor.
        let initial = journal(&handle)?;
        let mut volume = NativeVolume {
            root,
            root_id,
            serial,
            journal_id: initial.id,
            next_usn: initial.next,
            nodes: BTreeMap::new(),
            valid: false,
        };
        let mut request = MFT_ENUM_DATA_V0 {
            StartFileReferenceNumber: 0,
            LowUsn: 0,
            HighUsn: i64::MAX,
        };
        let mut output = vec![0u8; BUFFER_SIZE];
        loop {
            check_cancel(cancel)?;
            let length = match ioctl(&handle, FSCTL_ENUM_USN_DATA, Some(&request), &mut output) {
                Ok(length) => length,
                Err(error) if error.raw_os_error() == Some(ERROR_HANDLE_EOF as i32) => break,
                Err(error) => return Err(format!("MFT enumeration failed: {error}")),
            };
            if length < 8 {
                return Err("truncated MFT enumeration response".into());
            }
            let next = u64_at(&output, 0);
            if next <= request.StartFileReferenceNumber {
                return Err("MFT enumeration cursor did not advance".into());
            }
            for (i, record) in parse_records(&output[8..length])?.into_iter().enumerate() {
                if i.is_multiple_of(256) {
                    check_cancel(cancel)?;
                }
                volume.apply(record, false);
            }
            request.StartFileReferenceNumber = next;
        }
        replay(&mut volume, &handle, cancel)?;
        volume.valid = true;
        Ok(volume)
    }

    pub(super) fn refresh(
        volume: &mut NativeVolume,
        cancel: &CancellationToken,
    ) -> Result<usize, String> {
        let (root_id, serial) = identity(&volume.root)?;
        if root_id != volume.root_id || serial != volume.serial {
            return Err("NTFS volume identity changed; index rebuild required".into());
        }
        let handle = open_volume(&volume.root)?;
        replay(volume, &handle, cancel)
    }

    pub(super) fn validate_current(volume: &NativeVolume) -> Result<(), String> {
        let (root_id, serial) = identity(&volume.root)?;
        if root_id != volume.root_id || serial != volume.serial {
            return Err("NTFS volume identity changed; index rebuild required".into());
        }
        let handle = open_volume(&volume.root)?;
        let latest = journal(&handle)?;
        validate_journal(latest, volume.journal_id, volume.next_usn)?;
        if latest.next != volume.next_usn {
            return Err("NTFS journal updates are pending; space cache validation skipped".into());
        }
        Ok(())
    }

    fn replay(
        volume: &mut NativeVolume,
        handle: &Handle,
        cancel: &CancellationToken,
    ) -> Result<usize, String> {
        let snapshot = journal(handle)?;
        validate_journal(snapshot, volume.journal_id, volume.next_usn)?;
        let target = snapshot.next;
        let mut output = vec![0u8; BUFFER_SIZE];
        let mut changed = 0;
        while volume.next_usn < target {
            check_cancel(cancel)?;
            let request = READ_USN_JOURNAL_DATA_V0 {
                StartUsn: volume.next_usn,
                ReasonMask: u32::MAX,
                ReturnOnlyOnClose: 0,
                Timeout: 0,
                BytesToWaitFor: 0,
                UsnJournalID: volume.journal_id,
            };
            let length = ioctl(handle, FSCTL_READ_USN_JOURNAL, Some(&request), &mut output)
                .map_err(|e| format!("USN replay failed; index rebuild required: {e}"))?;
            if length < 8 {
                return Err("truncated USN replay response".into());
            }
            let next = u64_at(&output, 0) as i64;
            if next <= volume.next_usn {
                return Err("USN replay did not advance; index rebuild required".into());
            }
            for (i, record) in parse_records(&output[8..length])?.into_iter().enumerate() {
                if i.is_multiple_of(256) {
                    check_cancel(cancel)?;
                }
                if record.usn < volume.next_usn {
                    return Err("USN replay returned a record before its watermark".into());
                }
                // Future records remain for the next refresh. This captures a
                // bounded, coherent journal prefix even on an active volume.
                if record.usn < target && volume.apply(record, true) {
                    changed += 1;
                }
            }
            volume.next_usn = next.min(target);
        }
        check_cancel(cancel)?;
        // A journal reset/wrap during replay must never publish a ready index.
        validate_journal(journal(handle)?, volume.journal_id, volume.next_usn)?;
        Ok(changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: u64, parent: u64, name: &str, usn: i64, reason: u32) -> Record {
        Record {
            id,
            parent,
            name: name.encode_utf16().collect(),
            usn,
            reason,
            attributes: 0,
        }
    }

    fn volume() -> NativeVolume {
        NativeVolume {
            root: PathBuf::from("C:\\"),
            root_id: 5,
            serial: 1,
            journal_id: 7,
            next_usn: 100,
            nodes: BTreeMap::new(),
            valid: true,
        }
    }

    fn encoded_record(name: &str) -> Vec<u8> {
        let name: Vec<u16> = name.encode_utf16().collect();
        let length = (60 + name.len() * 2).next_multiple_of(8);
        let mut bytes = vec![0; length];
        bytes[..4].copy_from_slice(&(length as u32).to_le_bytes());
        bytes[4..6].copy_from_slice(&2u16.to_le_bytes());
        bytes[8..16].copy_from_slice(&42u64.to_le_bytes());
        bytes[16..24].copy_from_slice(&5u64.to_le_bytes());
        bytes[56..58].copy_from_slice(&(name.len() as u16 * 2).to_le_bytes());
        bytes[58..60].copy_from_slice(&60u16.to_le_bytes());
        for (i, unit) in name.iter().enumerate() {
            bytes[60 + i * 2..62 + i * 2].copy_from_slice(&unit.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn space_stamp_tracks_sizes_names_membership_and_volume_identity() {
        let mut v = volume();
        let mut folder = record(10, 5, "measured", 1, 0);
        folder.attributes = FILE_ATTRIBUTE_DIRECTORY;
        v.apply(folder, false);
        v.apply(record(11, 10, "file.txt", 2, 0), false);
        let token = CancellationToken::default();
        let root = Path::new("C:\\measured");
        let initial = v.space_stamp(root, &token).unwrap();
        v.apply(record(30, 5, "unrelated.txt", 3, 0), true);
        assert_eq!(initial, v.space_stamp(root, &token).unwrap());
        v.apply(record(11, 10, "file.txt", 4, 1), true); // DATA_OVERWRITE
        let resized = v.space_stamp(root, &token).unwrap();
        assert_ne!(initial, resized);
        v.apply(record(11, 10, "renamed.txt", 5, REASON_RENAME_NEW), true);
        let renamed = v.space_stamp(root, &token).unwrap();
        assert_ne!(resized, renamed);
        v.apply(record(11, 10, "renamed.txt", 6, REASON_DELETE), true);
        let deleted = v.space_stamp(root, &token).unwrap();
        assert_ne!(renamed, deleted);
        v.serial += 1;
        assert_ne!(deleted, v.space_stamp(root, &token).unwrap());
        assert!(v.space_stamp(Path::new("D:\\measured"), &token).is_err());
        assert!(v.space_stamp(Path::new("C:\\absent"), &token).is_err());
        token.cancel();
        assert!(v.space_stamp(root, &token).is_err());
        v.valid = false;
        assert!(v.space_stamp(root, &CancellationToken::default()).is_err());
    }

    #[test]
    fn parses_unaligned_unicode_v2_and_rejects_bad_frames() {
        let bytes = encoded_record("测试🦀.txt");
        let parsed = parse_records(&bytes).unwrap();
        assert_eq!(parsed[0].id, 42);
        assert_eq!(String::from_utf16(&parsed[0].name).unwrap(), "测试🦀.txt");
        for length in 1..bytes.len() {
            assert!(parse_records(&bytes[..length]).is_err());
        }
        let mut invalid = bytes.clone();
        invalid[4..6].copy_from_slice(&3u16.to_le_bytes());
        assert!(parse_records(&invalid).unwrap_err().contains("version 3"));
        invalid = bytes.clone();
        invalid[58..60].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(parse_records(&invalid).is_err());
        invalid = bytes.clone();
        invalid[..4].fill(0);
        assert!(parse_records(&invalid).is_err());
        assert!(parse_records(&encoded_record("..\\escape")).is_err());
    }

    #[test]
    fn rename_move_and_delete_update_descendant_paths() {
        let mut v = volume();
        v.apply(record(10, 5, "old", 10, 0), false);
        v.apply(record(11, 10, "needle.txt", 11, 0), false);
        v.apply(record(12, 5, "destination", 12, 0), false);
        v.apply(record(10, 5, "old", 20, REASON_RENAME_OLD), true);
        assert!(folded_path(&v.resolve_path(11).unwrap()).ends_with("old\\needle.txt"));
        v.apply(record(10, 12, "new", 21, REASON_RENAME_NEW), true);
        assert!(
            folded_path(&v.resolve_path(11).unwrap()).ends_with("destination\\new\\needle.txt")
        );
        v.apply(record(10, 12, "new", 22, REASON_DELETE), true);
        assert!(v.resolve_path(11).is_none());
        assert!(
            v.search_page("needle", &[PathBuf::from("C:\\")], 0, 10)
                .0
                .is_empty()
        );
    }

    #[test]
    fn replay_does_not_roll_back_newer_enumerated_records() {
        let mut v = volume();
        v.apply(record(10, 5, "new.txt", 40, 0), false);
        v.apply(record(10, 5, "old.txt", 20, REASON_RENAME_NEW), true);
        v.apply(record(10, 5, "old.txt", 21, REASON_DELETE), true);
        assert_eq!(v.nodes[&10].name, "new.txt");
        v.apply(record(10, 5, "new.txt", 41, REASON_DELETE), true);
        assert!(!v.nodes.contains_key(&10));
        v.apply(record(20, 5, "created.txt", 42, 0x100), true);
        assert!(v.resolve_path(20).is_some());
    }

    #[test]
    fn root_filter_is_case_insensitive_and_component_bounded_with_stable_pages() {
        let mut v = volume();
        v.apply(record(10, 5, "Root", 1, 0), false);
        v.apply(record(11, 5, "RootElse", 2, 0), false);
        v.apply(record(12, 10, "NeedleA", 3, 0), false);
        v.apply(record(13, 11, "NeedleOutside", 4, 0), false);
        v.apply(record(14, 10, "NeedleB", 5, 0), false);
        let roots = [PathBuf::from("\\\\?\\c:\\root\\")];
        let (first, more) = v.search_page("NEEDLE", &roots, 0, 1);
        assert_eq!(first[0].name, "NeedleA");
        assert!(more);
        let (second, more) = v.search_page("needle", &roots, 1, 1);
        assert_eq!(second[0].name, "NeedleB");
        assert!(!more);
    }

    #[test]
    fn persisted_snapshot_round_trips_mft_nodes_and_watermark() {
        let output = tempfile::tempdir().unwrap();
        let path = output.path().join("C-00000001.json");
        let mut original = volume();
        original.apply(record(10, 5, "目录", 101, 0), false);
        original.apply(record(11, 10, "needle.txt", 102, 0), false);
        original.persist(&path).unwrap();

        let loaded = NativeVolume::load_persisted(&path, &CancellationToken::default()).unwrap();
        assert_eq!(loaded.root(), Path::new("C:\\"));
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded.next_usn, original.next_usn);
        assert_eq!(loaded.journal_id, original.journal_id);
        assert_eq!(
            loaded
                .search_page("NEEDLE", &[PathBuf::from("c:\\")], 0, 10)
                .0[0]
                .name,
            "needle.txt"
        );
    }

    #[test]
    fn deep_large_space_stamp_uses_shared_ancestry_and_honors_budget() {
        let mut v = volume();
        let mut root = v.root.clone();
        let mut parent = v.root_id;
        for depth in 0..600 {
            let id = 100 + depth;
            let name = format!("dir{depth}");
            let mut directory = record(id, parent, &name, depth as i64, 0);
            directory.attributes = FILE_ATTRIBUTE_DIRECTORY;
            v.apply(directory, false);
            root.push(name);
            parent = id;
        }
        for index in 0..50_000 {
            v.apply(
                record(
                    10_000 + index,
                    parent,
                    &format!("file{index}"),
                    index as i64,
                    0,
                ),
                false,
            );
        }
        let cancel = CancellationToken::default();
        let started = Instant::now();
        let first = v
            .space_stamp_until(&root, &cancel, started + Duration::from_secs(2))
            .unwrap();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(
            v.space_stamp_until(&root, &cancel, Instant::now())
                .unwrap_err()
                .contains("budget")
        );
        cancel.cancel();
        assert!(
            v.space_stamp_until(&root, &cancel, Instant::now() + Duration::from_secs(2))
                .unwrap_err()
                .contains("cancelled")
        );
        v.apply(record(10_001, parent, "file1", 100_000, 0x1), true);
        let second = v
            .space_stamp_until(
                &root,
                &CancellationToken::default(),
                Instant::now() + Duration::from_secs(2),
            )
            .unwrap();
        assert_ne!(
            first, second,
            "USN-only data changes must invalidate the cache"
        );
    }

    #[test]
    fn space_stamp_excludes_reparse_descendants_and_bounds_parent_cycles() {
        let mut v = volume();
        let mut scope = record(10, 5, "scope", 1, 0);
        scope.attributes = FILE_ATTRIBUTE_DIRECTORY;
        v.apply(scope, false);
        let mut junction = record(11, 10, "link", 2, 0);
        junction.attributes = FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT;
        v.apply(junction, false);
        v.apply(record(12, 11, "linked.txt", 3, 0), false);
        let mut cycle = record(20, 21, "cycle-a", 4, 0);
        cycle.attributes = FILE_ATTRIBUTE_DIRECTORY;
        v.apply(cycle, false);
        let mut cycle = record(21, 20, "cycle-b", 5, 0);
        cycle.attributes = FILE_ATTRIBUTE_DIRECTORY;
        v.apply(cycle, false);
        let root = Path::new(r"C:\scope");
        let cancel = CancellationToken::default();
        let first = v.space_stamp(root, &cancel).unwrap();
        v.apply(record(12, 11, "linked.txt", 6, 0), true);
        assert_eq!(first, v.space_stamp(root, &cancel).unwrap());
        assert!(v.space_stamp(Path::new(r"C:\scope\link"), &cancel).is_err());
        let mut changed = record(11, 10, "link", 7, 0);
        changed.attributes = FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT;
        v.apply(changed, true);
        assert_ne!(first, v.space_stamp(root, &cancel).unwrap());
    }

    #[test]
    fn malformed_or_duplicate_persisted_nodes_are_rejected() {
        let output = tempfile::tempdir().unwrap();
        let path = output.path().join("bad.json");
        let mut payload = PersistedVolume {
            version: SNAPSHOT_VERSION,
            root: PathBuf::from("C:\\"),
            root_id: 5,
            serial: 1,
            journal_id: 7,
            next_usn: 100,
            checksum: 0,
            nodes: vec![
                PersistedNode {
                    id: 10,
                    parent: 5,
                    name: "a".encode_utf16().collect(),
                    attributes: 0,
                    usn: 1,
                },
                PersistedNode {
                    id: 10,
                    parent: 5,
                    name: "b".encode_utf16().collect(),
                    attributes: 0,
                    usn: 2,
                },
            ],
        };
        payload.checksum = snapshot_checksum(&payload);
        fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
        assert!(NativeVolume::load_persisted(&path, &CancellationToken::default()).is_err());
    }

    #[test]
    fn snapshot_overwrites_atomically_and_detects_valid_json_corruption() {
        let output = tempfile::tempdir().unwrap();
        let path = output.path().join("C.json");
        let mut original = volume();
        original.apply(record(10, 5, "before.txt", 10, 0), false);
        original.persist(&path).unwrap();
        original.apply(record(10, 5, "after.txt", 11, REASON_RENAME_NEW), true);
        original.next_usn = 101;
        original.persist(&path).unwrap();
        let restored = NativeVolume::load_persisted(&path, &CancellationToken::default()).unwrap();
        assert_eq!(restored.nodes[&10].name, "after.txt");
        assert_eq!(restored.watermark(), 101);
        assert_eq!(fs::read_dir(output.path()).unwrap().count(), 1);

        let mut bytes: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        bytes["next_usn"] = serde_json::json!(102);
        fs::write(&path, serde_json::to_vec(&bytes).unwrap()).unwrap();
        assert!(
            NativeVolume::load_persisted(&path, &CancellationToken::default())
                .unwrap_err()
                .contains("checksum")
        );
    }

    #[test]
    fn snapshot_rejects_path_components_and_preserves_last_good_file_on_invalid_index() {
        let output = tempfile::tempdir().unwrap();
        let path = output.path().join("C.json");
        let mut original = volume();
        original.apply(record(10, 5, "safe.txt", 10, 0), false);
        original.persist(&path).unwrap();
        let before = fs::read(&path).unwrap();
        original.valid = false;
        assert!(original.persist(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let mut payload: PersistedVolume = serde_json::from_slice(&before).unwrap();
        for name in ["..", ".", "a\\b", "C:escape", "a/b", "bad\0name"] {
            payload.nodes[0].name = name.encode_utf16().collect();
            payload.checksum = snapshot_checksum(&payload);
            fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
            assert!(
                NativeVolume::load_persisted(&path, &CancellationToken::default()).is_err(),
                "{name}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn snapshot_preserves_unpaired_utf16_filename_units() {
        let output = tempfile::tempdir().unwrap();
        let path = output.path().join("C.json");
        let mut original = volume();
        let mut item = record(10, 5, "x", 10, 0);
        item.name = vec![0x0061, 0xd800, 0x0062];
        original.apply(item, false);
        original.persist(&path).unwrap();
        let restored = NativeVolume::load_persisted(&path, &CancellationToken::default()).unwrap();
        assert_eq!(
            os_name_units(&restored.nodes[&10].name),
            vec![0x0061, 0xd800, 0x0062]
        );
    }

    #[cfg(windows)]
    #[test]
    fn cache_rejects_junctions_without_writing_to_their_target() {
        let output = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let junction = output.path().join("redirect");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(target.path())
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        assert!(volume().persist(&junction.join("C.json")).is_err());
        assert!(
            NativeVolume::load_persisted(&junction.join("C.json"), &CancellationToken::default())
                .is_err()
        );
        assert_eq!(fs::read_dir(target.path()).unwrap().count(), 0);
        fs::remove_dir(&junction).unwrap();
    }

    #[test]
    fn cyclic_or_orphaned_parent_graph_never_returns_a_fabricated_path() {
        let mut v = volume();
        v.apply(record(10, 11, "cycle", 1, 0), false);
        v.apply(record(11, 10, "cycle", 1, 0), false);
        v.apply(record(12, 99, "orphan", 1, 0), false);
        assert!(v.resolve_path(10).is_none());
        assert!(v.resolve_path(12).is_none());
    }

    #[test]
    fn root_itself_and_reparse_descendants_are_excluded() {
        let mut v = volume();
        let mut junction = record(10, 5, "needle-junction", 1, 0);
        junction.attributes = FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT;
        v.apply(junction, false);
        v.apply(record(11, 10, "needle-inside", 2, 0), false);
        let roots = [PathBuf::from("C:\\")];
        let (hits, _) = v.search_page("needle", &roots, 0, 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "needle-junction");
        assert!(
            v.search_page("needle", &[PathBuf::from("C:\\needle-junction")], 0, 10)
                .0
                .is_empty()
        );
    }

    #[test]
    fn journal_reset_wrap_and_future_watermarks_require_rebuild() {
        let journal = Journal {
            id: 7,
            first: 10,
            lowest_valid: 15,
            next: 30,
        };
        assert!(validate_journal(journal, 7, 15).is_ok());
        assert!(validate_journal(journal, 8, 15).is_err());
        assert!(validate_journal(journal, 7, 14).is_err());
        assert!(validate_journal(journal, 7, 31).is_err());
    }

    #[test]
    fn cancelled_build_does_not_open_a_volume_and_refresh_invalidates_generation() {
        let cancel = CancellationToken::default();
        cancel.cancel();
        assert!(
            NativeVolume::build(Path::new("C:\\"), &cancel)
                .unwrap_err()
                .contains("cancelled")
        );
        let mut v = volume();
        assert!(v.refresh(&cancel).unwrap_err().contains("cancelled"));
        assert!(!v.valid);
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires elevated token and an NTFS volume with USN already enabled"]
    fn real_ntfs_enumeration_and_usn_create_rename_delete() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = CancellationToken::default();
        let mut volume = NativeVolume::build(dir.path(), &cancel).unwrap();
        assert!(volume.len() > 0);
        let original = dir.path().join("muller-native-probe-original.txt");
        std::fs::write(&original, b"probe").unwrap();
        volume.refresh(&cancel).unwrap();
        let roots = [dir.path().to_path_buf()];
        assert_eq!(
            volume
                .search_page("muller-native-probe", &roots, 0, 10)
                .0
                .len(),
            1
        );
        let renamed = dir.path().join("muller-native-probe-renamed.txt");
        std::fs::rename(&original, &renamed).unwrap();
        volume.refresh(&cancel).unwrap();
        assert_eq!(
            volume.search_page("muller-native-probe", &roots, 0, 10).0[0].path,
            renamed
        );
        std::fs::remove_file(renamed).unwrap();
        volume.refresh(&cancel).unwrap();
        assert!(
            volume
                .search_page("muller-native-probe", &roots, 0, 10)
                .0
                .is_empty()
        );
    }
}
