//! Per-GUI, read-only NTFS helper. The GUI stays at normal integrity; only an
//! explicit launch uses UAC. The helper has no file mutation or shell commands.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const PROVIDER: &str = "ntfs-mft-usn";
const MAX_PAGE: usize = 2_000;
const MAX_FRAME: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeStatus {
    pub provider: String,
    pub state: String,
    pub entries: usize,
    pub volumes: usize,
    pub message: Option<String>,
}

impl NativeStatus {
    fn new(state: &str, message: Option<String>) -> Self {
        Self {
            provider: "portable-snapshot-walker".into(),
            state: state.into(),
            entries: 0,
            volumes: 0,
            message,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeHit {
    pub path: PathBuf,
    pub name: String,
    pub is_directory: bool,
    pub attributes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeSearchPage {
    pub hits: Vec<NativeHit>,
    pub has_more: bool,
    /// Changes whenever a volume index is built or a journal update is applied.
    pub revision: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Start {
        roots: Vec<PathBuf>,
        #[serde(default)]
        storage_path: Option<PathBuf>,
    },
    Status {},
    Cancel {},
    Search {
        roots: Vec<PathBuf>,
        query: String,
        offset: usize,
        limit: usize,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Response {
    Status { status: NativeStatus },
    Page { page: NativeSearchPage },
    Error { message: String },
}

fn endpoint_name(nonce: &str, parent_pid: u32) -> Result<String, String> {
    if parent_pid == 0 || nonce.len() != 64 || !nonce.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid native indexer endpoint".into());
    }
    Ok(format!(r"\\.\pipe\Muller.NativeIndex.{parent_pid}.{nonce}"))
}

fn volume_roots(roots: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    if roots.is_empty() || roots.len() > 26 {
        return Err("native indexing requires 1 to 26 local drive roots".into());
    }
    let mut result = Vec::new();
    for root in roots {
        let root = root.to_string_lossy();
        let text = root.strip_prefix(r"\\?\").unwrap_or(&root);
        let bytes = text.as_bytes();
        if bytes.len() < 3
            || !bytes[0].is_ascii_alphabetic()
            || bytes[1] != b':'
            || !matches!(bytes[2], b'\\' | b'/')
            || text.contains('\0')
            || text.len() > 32_767
            || text.split(['\\', '/']).any(|part| part == "..")
        {
            return Err("native indexing only supports absolute local drive paths".into());
        }
        let drive = PathBuf::from(format!("{}:\\", (bytes[0] as char).to_ascii_uppercase()));
        if !result.contains(&drive) {
            result.push(drive);
        }
    }
    result.sort();
    Ok(result)
}

fn validate_storage_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path.as_os_str().is_empty()
        || path.to_string_lossy().len() > 32_767
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("native index storage path must be an absolute local path".into());
    }
    Ok(())
}

fn validate_request(request: &Request) -> Result<(), String> {
    match request {
        Request::Start {
            roots,
            storage_path,
        } => {
            volume_roots(roots)?;
            if let Some(path) = storage_path {
                validate_storage_path(path)?;
            }
        }
        Request::Search {
            roots,
            query,
            offset,
            limit,
        } => {
            volume_roots(roots)?;
            if query.len() > 4_096
                || query.contains('\0')
                || *limit == 0
                || *limit > MAX_PAGE
                || *offset > 10_000_000
            {
                return Err("native index query exceeds protocol limits".into());
            }
        }
        Request::Status {} | Request::Cancel {} => {}
    }
    Ok(())
}

#[cfg(windows)]
pub use windows_impl::{
    cancel_native_indexer, launch_native_indexer, native_helper_entry, native_status,
    search_native_index, search_native_index_cancellable,
};

#[cfg(not(windows))]
pub fn native_helper_entry() -> bool {
    false
}
#[cfg(not(windows))]
pub fn native_status() -> NativeStatus {
    NativeStatus::new(
        "disabled",
        Some("NTFS native indexing requires Windows".into()),
    )
}
#[cfg(not(windows))]
pub fn launch_native_indexer(_: Vec<PathBuf>) -> Result<(), String> {
    Err("NTFS native indexing requires Windows".into())
}
#[cfg(not(windows))]
pub fn cancel_native_indexer() -> Result<(), String> {
    Ok(())
}
#[cfg(not(windows))]
pub fn search_native_index(
    _: &[PathBuf],
    _: &str,
    _: usize,
    _: usize,
) -> Result<NativeSearchPage, String> {
    Err("NTFS native indexing requires Windows".into())
}
#[cfg(not(windows))]
pub fn search_native_index_cancellable(
    _: &[PathBuf],
    _: &str,
    _: usize,
    _: usize,
    _: &muller_core::CancellationToken,
) -> Result<NativeSearchPage, String> {
    Err("NTFS native indexing requires Windows".into())
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use crate::ntfs::NativeVolume;
    use muller_core::CancellationToken;
    use std::{
        collections::{HashMap, VecDeque},
        ffi::OsStr,
        fs,
        mem::{size_of, zeroed},
        os::windows::ffi::OsStrExt,
        path::Path,
        ptr::{null, null_mut},
        sync::{
            Arc, Mutex, MutexGuard, OnceLock, TryLockError,
            atomic::{AtomicU64, Ordering},
            mpsc,
        },
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, ERROR_NO_DATA, ERROR_PIPE_CONNECTED, ERROR_PIPE_LISTENING, GENERIC_READ,
            GENERIC_WRITE, GetLastError, HANDLE, INVALID_HANDLE_VALUE, LocalFree, WAIT_TIMEOUT,
        },
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SDDL_REVISION_1,
            },
            Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom},
            GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
        },
        Storage::FileSystem::{
            CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
            ReadFile, SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT, SYNCHRONIZE, WriteFile,
        },
        System::{
            Pipes::{
                ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe,
                GetNamedPipeClientProcessId, GetNamedPipeServerProcessId, PIPE_NOWAIT,
                PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
                SetNamedPipeHandleState,
            },
            Threading::{
                GetCurrentProcess, GetProcessId, OpenProcess, OpenProcessToken,
                PROCESS_QUERY_LIMITED_INFORMATION, WaitForSingleObject,
            },
        },
        UI::{
            Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW},
            WindowsAndMessaging::SW_HIDE,
        },
    };

    const IO_TIMEOUT: Duration = Duration::from_secs(10);
    const POLL: Duration = Duration::from_millis(5);

    /// The first candidate keeps the index beside a portable executable. A
    /// normal installed build may live below Program Files, so probe that
    /// directory before falling back to the per-user state directory. The
    /// selected path is passed to the elevated helper and is never guessed by
    /// the helper itself.
    fn native_storage_path() -> PathBuf {
        let executable_dir = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf));
        let portable = executable_dir.map(|path| path.join("Muller-data").join("native-index-v1"));
        if let Some(path) = portable.filter(|path| writable_directory(path)) {
            return path;
        }
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let fallback = base.join("Muller").join("native-index-v1");
        let _ = fs::create_dir_all(&fallback);
        fallback
    }

    fn writable_directory(path: &Path) -> bool {
        if fs::create_dir_all(path).is_err() {
            return false;
        }
        let probe = path.join(format!(".write-probe-{}", std::process::id()));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(_) => {
                let _ = fs::remove_file(probe);
                true
            }
            Err(_) => false,
        }
    }

    fn snapshot_path(storage: &Path, root: &Path) -> PathBuf {
        let text = root.to_string_lossy();
        let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
        let drive = text
            .as_bytes()
            .first()
            .copied()
            .filter(u8::is_ascii_alphabetic)
            .map(|value| (value as char).to_ascii_uppercase())
            .unwrap_or('V');
        storage.join(format!("{drive}.json"))
    }

    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(|error| error.into_inner())
    }
    fn lock_cancellable<'a, T>(
        mutex: &'a Mutex<T>,
        cancel: &CancellationToken,
    ) -> Result<MutexGuard<'a, T>, String> {
        loop {
            if cancel.is_cancelled() {
                return Err("native index query cancelled".into());
            }
            let guard = match mutex.try_lock() {
                Ok(guard) => Some(guard),
                Err(TryLockError::Poisoned(error)) => Some(error.into_inner()),
                Err(TryLockError::WouldBlock) => None,
            };
            if let Some(guard) = guard {
                if cancel.is_cancelled() {
                    return Err("native index query cancelled".into());
                }
                return Ok(guard);
            }
            thread::sleep(POLL);
        }
    }
    fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
        value.as_ref().encode_wide().chain(Some(0)).collect()
    }
    fn last_error(context: &str) -> String {
        format!("{context}: {}", std::io::Error::last_os_error())
    }

    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    // Handles never cross threads. NativeVolume opens and closes its handles in
    // the worker; IPC handles stay on the thread making the request.
    struct ProcessHandle(HANDLE);
    // A process handle supports concurrent wait/query operations and carries
    // no thread-affine state. Keeping it open also binds an endpoint to the
    // exact helper process lifetime, instead of relying only on a reusable PID.
    unsafe impl Send for ProcessHandle {}
    unsafe impl Sync for ProcessHandle {}
    impl Drop for ProcessHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    fn process_sid(process: HANDLE) -> Result<String, String> {
        unsafe {
            let mut raw = null_mut();
            if OpenProcessToken(process, TOKEN_QUERY, &mut raw) == 0 {
                return Err(last_error("open process token"));
            }
            let token = Handle(raw);
            let mut needed = 0;
            GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut needed);
            if needed == 0 || needed > 65_536 {
                return Err("invalid token user size".into());
            }
            // usize storage provides TOKEN_USER alignment.
            let mut data = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
            if GetTokenInformation(
                token.0,
                TokenUser,
                data.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ) == 0
            {
                return Err(last_error("read process token"));
            }
            let user = &*data.as_ptr().cast::<TOKEN_USER>();
            let mut sid = null_mut();
            if ConvertSidToStringSidW(user.User.Sid, &mut sid) == 0 {
                return Err(last_error("format user SID"));
            }
            let mut length = 0;
            while *sid.add(length) != 0 {
                length += 1;
            }
            let result = String::from_utf16_lossy(std::slice::from_raw_parts(sid, length));
            LocalFree(sid.cast());
            Ok(result)
        }
    }

    fn pipe_sddl(sid: &str) -> Result<String, String> {
        if !sid.starts_with("S-1-")
            || !sid
                .bytes()
                .all(|c| c.is_ascii_digit() || c == b'S' || c == b'-')
            || sid.len() > 184
        {
            return Err("invalid user SID".into());
        }
        // Explicit medium integrity allows the unelevated GUI to write. DACL
        // grants only this user and SYSTEM; remote clients are also rejected.
        Ok(format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})S:(ML;;NW;;;ME)"))
    }

    fn create_pipe(name: &str, sid: &str) -> Result<Handle, String> {
        let sddl = wide(pipe_sddl(sid)?);
        unsafe {
            let mut descriptor = null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            ) == 0
            {
                return Err(last_error("create pipe security descriptor"));
            }
            let attributes = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            };
            let pipe = CreateNamedPipeW(
                wide(name).as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                65_536,
                65_536,
                0,
                &attributes,
            );
            LocalFree(descriptor);
            if pipe == INVALID_HANDLE_VALUE {
                return Err(last_error("create native index pipe"));
            }
            Ok(Handle(pipe))
        }
    }

    fn transfer(
        handle: HANDLE,
        bytes: &mut [u8],
        write: bool,
        deadline: Instant,
    ) -> Result<(), String> {
        let mut done = 0;
        while done < bytes.len() {
            if Instant::now() >= deadline {
                return Err("native index pipe timed out".into());
            }
            let mut transferred = 0;
            let length = (bytes.len() - done).min(65_536) as u32;
            let ok = unsafe {
                if write {
                    WriteFile(
                        handle,
                        bytes[done..].as_ptr().cast(),
                        length,
                        &mut transferred,
                        null_mut(),
                    )
                } else {
                    ReadFile(
                        handle,
                        bytes[done..].as_mut_ptr().cast(),
                        length,
                        &mut transferred,
                        null_mut(),
                    )
                }
            };
            if ok == 0 {
                let error = unsafe { GetLastError() };
                if error != ERROR_NO_DATA {
                    return Err(format!("native index pipe I/O: Windows error {error}"));
                }
            }
            done += transferred as usize;
            if transferred == 0 {
                thread::sleep(POLL);
            }
        }
        Ok(())
    }

    fn write_frame<T: Serialize>(
        handle: HANDLE,
        value: &T,
        deadline: Instant,
    ) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        if bytes.is_empty() || bytes.len() > MAX_FRAME {
            return Err("native index response exceeds frame limit".into());
        }
        transfer(
            handle,
            &mut (bytes.len() as u32).to_le_bytes(),
            true,
            deadline,
        )?;
        transfer(handle, &mut bytes, true, deadline)
    }

    fn read_frame<T: serde::de::DeserializeOwned>(
        handle: HANDLE,
        deadline: Instant,
    ) -> Result<T, String> {
        let mut header = [0; 4];
        transfer(handle, &mut header, false, deadline)?;
        let length = u32::from_le_bytes(header) as usize;
        if length == 0 || length > MAX_FRAME {
            return Err("invalid native index frame length".into());
        }
        let mut bytes = vec![0; length];
        transfer(handle, &mut bytes, false, deadline)?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("invalid native index protocol: {error}"))
    }

    #[derive(Clone)]
    struct Endpoint {
        name: String,
        process_id: u32,
        process: Arc<ProcessHandle>,
    }
    struct BrokerState {
        endpoint: Option<Endpoint>,
        status: NativeStatus,
    }
    fn broker() -> &'static Mutex<BrokerState> {
        static BROKER: OnceLock<Mutex<BrokerState>> = OnceLock::new();
        BROKER.get_or_init(|| {
            Mutex::new(BrokerState {
                endpoint: None,
                status: NativeStatus::new("disabled", None),
            })
        })
    }
    // Status polling must remain responsive while ShellExecuteEx is waiting
    // for UAC consent or a preceding query owns the serialized IPC channel.
    fn status_cache() -> &'static Mutex<NativeStatus> {
        static CACHE: OnceLock<Mutex<NativeStatus>> = OnceLock::new();
        CACHE.get_or_init(|| Mutex::new(NativeStatus::new("disabled", None)))
    }
    fn set_broker_status(state: &mut BrokerState, status: NativeStatus) {
        *lock(status_cache()) = status.clone();
        state.status = status;
    }

    fn request(endpoint: &Endpoint, request: &Request) -> Result<Response, String> {
        validate_request(request)?;
        if unsafe { WaitForSingleObject(endpoint.process.0, 0) } != WAIT_TIMEOUT {
            return Err("native index helper has exited".into());
        }
        let deadline = Instant::now() + IO_TIMEOUT;
        let pipe = loop {
            let raw = unsafe {
                CreateFileW(
                    wide(&endpoint.name).as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    null(),
                    OPEN_EXISTING,
                    SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                    null_mut(),
                )
            };
            if raw != INVALID_HANDLE_VALUE {
                break Handle(raw);
            }
            if Instant::now() >= deadline {
                return Err(last_error("connect native index helper"));
            }
            thread::sleep(POLL);
        };
        unsafe {
            let mut server_pid = 0;
            if GetNamedPipeServerProcessId(pipe.0, &mut server_pid) == 0
                || server_pid != endpoint.process_id
            {
                return Err("native index pipe server identity mismatch".into());
            }
            let mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
            if SetNamedPipeHandleState(pipe.0, &mode, null(), null()) == 0 {
                return Err(last_error("set native pipe mode"));
            }
        }
        write_frame(pipe.0, request, deadline)?;
        let response = read_frame(pipe.0, deadline)?;
        // The server waits for this ACK before disconnecting, avoiding loss of
        // unread bytes without an unbounded FlushFileBuffers call.
        transfer(pipe.0, &mut [1], true, deadline)?;
        Ok(response)
    }

    pub fn launch_native_indexer(roots: Vec<PathBuf>) -> Result<(), String> {
        let roots = volume_roots(&roots)?;
        let storage_path = native_storage_path();
        let mut state = lock(broker());
        if let Some(endpoint) = state.endpoint.clone()
            && let Ok(Response::Status { status }) = request(
                &endpoint,
                &Request::Start {
                    roots: roots.clone(),
                    storage_path: Some(storage_path.clone()),
                },
            )
        {
            set_broker_status(&mut state, status);
            return Ok(());
        }
        state.endpoint = None;
        set_broker_status(&mut state, NativeStatus::new("starting", None));
        let launch = (|| {
            let mut random = [0u8; 32];
            let result = unsafe {
                BCryptGenRandom(
                    null_mut(),
                    random.as_mut_ptr(),
                    random.len() as u32,
                    BCRYPT_USE_SYSTEM_PREFERRED_RNG,
                )
            };
            if result < 0 {
                return Err("cannot create secure native index endpoint".into());
            }
            let nonce: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
            let parent = std::process::id();
            let name = endpoint_name(&nonce, parent)?;
            let executable = wide(std::env::current_exe().map_err(|error| error.to_string())?);
            let parameters = wide(format!("--muller-native-indexer {nonce} {parent}"));
            let operation = wide("runas");
            let mut info: SHELLEXECUTEINFOW = unsafe { zeroed() };
            info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
            info.fMask = SEE_MASK_NOCLOSEPROCESS;
            info.lpVerb = operation.as_ptr();
            info.lpFile = executable.as_ptr();
            info.lpParameters = parameters.as_ptr();
            info.nShow = SW_HIDE;
            if unsafe { ShellExecuteExW(&mut info) } == 0 {
                return Err(last_error(
                    "native indexing was not started (UAC may have been cancelled)",
                ));
            }
            if info.hProcess.is_null() {
                return Err("native index helper did not return a process handle".into());
            }
            let process = Arc::new(ProcessHandle(info.hProcess));
            let endpoint = Endpoint {
                name,
                process_id: unsafe { GetProcessId(process.0) },
                process,
            };
            match request(
                &endpoint,
                &Request::Start {
                    roots,
                    storage_path: Some(storage_path),
                },
            )? {
                Response::Status { status } => Ok((endpoint, status)),
                Response::Error { message } => Err(message),
                _ => Err("unexpected native index start response".into()),
            }
        })();
        match launch {
            Ok((endpoint, status)) => {
                state.endpoint = Some(endpoint);
                set_broker_status(&mut state, status);
                Ok(())
            }
            Err(error) => {
                set_broker_status(
                    &mut state,
                    NativeStatus::new("degraded", Some(error.clone())),
                );
                Err(error)
            }
        }
    }

    pub fn native_status() -> NativeStatus {
        let mut state = match broker().try_lock() {
            Ok(state) => state,
            Err(TryLockError::Poisoned(error)) => error.into_inner(),
            Err(TryLockError::WouldBlock) => return lock(status_cache()).clone(),
        };
        if let Some(endpoint) = &state.endpoint {
            let status = match request(endpoint, &Request::Status {}) {
                Ok(Response::Status { status }) => status,
                Ok(Response::Error { message }) => NativeStatus::new("degraded", Some(message)),
                Err(error) => NativeStatus::new("degraded", Some(error)),
                _ => NativeStatus::new(
                    "error",
                    Some("unexpected native index status response".into()),
                ),
            };
            set_broker_status(&mut state, status);
        }
        state.status.clone()
    }

    pub fn cancel_native_indexer() -> Result<(), String> {
        let mut state = lock(broker());
        if let Some(endpoint) = &state.endpoint {
            match request(endpoint, &Request::Cancel {})? {
                Response::Status { status } => set_broker_status(&mut state, status),
                Response::Error { message } => return Err(message),
                _ => return Err("unexpected native index cancel response".into()),
            }
        }
        Ok(())
    }

    pub fn search_native_index(
        roots: &[PathBuf],
        query: &str,
        offset: usize,
        limit: usize,
    ) -> Result<NativeSearchPage, String> {
        search_native_index_cancellable(roots, query, offset, limit, &CancellationToken::default())
    }

    pub fn search_native_index_cancellable(
        roots: &[PathBuf],
        query: &str,
        offset: usize,
        limit: usize,
        cancel: &CancellationToken,
    ) -> Result<NativeSearchPage, String> {
        let state = lock_cancellable(broker(), cancel)?;
        let endpoint = state
            .endpoint
            .as_ref()
            .ok_or("native index helper has not been started")?;
        match request(
            endpoint,
            &Request::Search {
                roots: roots.to_vec(),
                query: query.into(),
                offset,
                limit: limit.clamp(1, MAX_PAGE),
            },
        )? {
            Response::Page { page } => Ok(page),
            Response::Error { message } => Err(message),
            _ => Err("unexpected native index search response".into()),
        }
    }

    struct WorkerQuery {
        roots: Vec<PathBuf>,
        query: String,
        offset: usize,
        limit: usize,
        reply: mpsc::Sender<Response>,
    }
    struct SearchCache {
        roots: Vec<PathBuf>,
        query: String,
        revision: u64,
        hits: Vec<NativeHit>,
    }
    #[derive(Default)]
    struct QueryCache {
        revision: u64,
        snapshots: VecDeque<SearchCache>,
    }
    impl QueryCache {
        fn get(&mut self, roots: &[PathBuf], query: &str, revision: u64) -> Option<&SearchCache> {
            if self.revision != revision {
                self.snapshots.clear();
                self.revision = revision;
            }
            let index = self
                .snapshots
                .iter()
                .position(|cached| cached.roots == roots && cached.query == query)?;
            let snapshot = self.snapshots.remove(index)?;
            self.snapshots.push_front(snapshot);
            self.snapshots.front()
        }
        fn insert(&mut self, snapshot: SearchCache) {
            // Four concurrent UI queries can page independently. Both the
            // result count and total snapshot allocation remain bounded.
            let size = |entry: &SearchCache| {
                entry
                    .hits
                    .iter()
                    .map(|hit| hit.path.as_os_str().len() + hit.name.len() + size_of::<NativeHit>())
                    .sum::<usize>()
            };
            let bytes = size(&snapshot);
            while self.snapshots.len() >= 4
                || self
                    .snapshots
                    .iter()
                    .map(|entry| entry.hits.len())
                    .sum::<usize>()
                    + snapshot.hits.len()
                    > 200_000
                || self.snapshots.iter().map(size).sum::<usize>() + bytes > 64 * 1024 * 1024
            {
                if self.snapshots.pop_back().is_none() {
                    break;
                }
            }
            self.revision = snapshot.revision;
            self.snapshots.push_front(snapshot);
        }
    }
    struct Service {
        status: Mutex<NativeStatus>,
        generation: AtomicU64,
        revision: AtomicU64,
        cancel: Mutex<CancellationToken>,
        queries: Mutex<Option<mpsc::Sender<WorkerQuery>>>,
    }
    impl Service {
        fn new() -> Self {
            Self {
                status: Mutex::new(NativeStatus::new("starting", None)),
                generation: AtomicU64::new(0),
                revision: AtomicU64::new(0),
                cancel: Mutex::new(CancellationToken::default()),
                queries: Mutex::new(None),
            }
        }
        fn set_status(&self, generation: u64, status: NativeStatus) {
            let mut current = lock(&self.status);
            if self.generation.load(Ordering::Acquire) == generation {
                *current = status;
            }
        }
        fn dispatch(self: &Arc<Self>, request: Request) -> Response {
            if let Err(message) = validate_request(&request) {
                return Response::Error { message };
            }
            match request {
                Request::Status {} => Response::Status {
                    status: lock(&self.status).clone(),
                },
                Request::Cancel {} => {
                    self.generation.fetch_add(1, Ordering::AcqRel);
                    lock(&self.cancel).cancel();
                    *lock(&self.queries) = None;
                    *lock(&self.status) =
                        NativeStatus::new("disabled", Some("Native indexing cancelled".into()));
                    Response::Status {
                        status: lock(&self.status).clone(),
                    }
                }
                Request::Start {
                    roots,
                    storage_path,
                } => {
                    let roots = volume_roots(&roots).expect("request roots were validated");
                    let storage_path = storage_path.unwrap_or_else(native_storage_path);
                    lock(&self.cancel).cancel();
                    let cancel = CancellationToken::default();
                    *lock(&self.cancel) = cancel.clone();
                    let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
                    let (send, receive) = mpsc::channel();
                    *lock(&self.queries) = Some(send);
                    *lock(&self.status) = NativeStatus::new("building", None);
                    let service = Arc::clone(self);
                    thread::spawn(move || {
                        service.work(generation, roots, storage_path, cancel, receive)
                    });
                    Response::Status {
                        status: lock(&self.status).clone(),
                    }
                }
                Request::Search {
                    roots,
                    query,
                    offset,
                    limit,
                } => {
                    let status = lock(&self.status).clone();
                    if status.state != "ready" && status.state != "degraded" {
                        return Response::Error {
                            message: format!("native index is {}", status.state),
                        };
                    }
                    let (reply, result) = mpsc::channel();
                    let sent = lock(&self.queries).as_ref().is_some_and(|send| {
                        send.send(WorkerQuery {
                            roots,
                            query,
                            offset,
                            limit,
                            reply,
                        })
                        .is_ok()
                    });
                    if !sent {
                        return Response::Error {
                            message: "native index worker is unavailable".into(),
                        };
                    }
                    result
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap_or_else(|_| Response::Error {
                            message: "native index query timed out; use fallback".into(),
                        })
                }
            }
        }

        fn work(
            &self,
            generation: u64,
            roots: Vec<PathBuf>,
            storage: PathBuf,
            cancel: CancellationToken,
            receive: mpsc::Receiver<WorkerQuery>,
        ) {
            let mut volumes = Vec::new();
            let mut failures = HashMap::new();
            for root in &roots {
                if cancel.is_cancelled() {
                    return;
                }
                let path = snapshot_path(&storage, root);
                let mut restored = false;
                if let Ok(mut volume) = NativeVolume::load_persisted(&path, &cancel)
                    && volume.root() == root
                    && volume.refresh(&cancel).is_ok()
                {
                    restored = true;
                    if let Err(error) = volume.persist(&path) {
                        failures.insert(
                            root.clone(),
                            format!("native index restored but snapshot update failed: {error}"),
                        );
                    }
                    volumes.push(volume);
                    self.revision.fetch_add(1, Ordering::AcqRel);
                }
                if restored {
                    continue;
                }
                match NativeVolume::build(root, &cancel) {
                    Ok(volume) => {
                        if let Err(error) = volume.persist(&path) {
                            failures.insert(
                                root.clone(),
                                format!("native index ready but snapshot was not saved: {error}"),
                            );
                        }
                        volumes.push(volume);
                        self.revision.fetch_add(1, Ordering::AcqRel);
                    }
                    Err(error) => {
                        failures.insert(root.clone(), error);
                    }
                }
            }
            if cancel.is_cancelled() {
                return;
            }
            self.publish(generation, &volumes, &failures);
            let mut next_refresh = Instant::now() + Duration::from_secs(1);
            let mut cache = QueryCache::default();
            loop {
                if cancel.is_cancelled() {
                    return;
                }
                if let Ok(query) = receive.recv_timeout(Duration::from_millis(100)) {
                    let _ = query
                        .reply
                        .send(self.query(&volumes, &failures, &query, &mut cache));
                }
                if Instant::now() < next_refresh {
                    continue;
                }
                let mut index = 0;
                while index < volumes.len() {
                    if cancel.is_cancelled() {
                        return;
                    }
                    match volumes[index].refresh(&cancel) {
                        Ok(changes) => {
                            if changes > 0 {
                                self.revision.fetch_add(1, Ordering::AcqRel);
                                let path = snapshot_path(&storage, volumes[index].root());
                                if let Err(error) = volumes[index].persist(&path) {
                                    failures.insert(
                                        volumes[index].root().to_path_buf(),
                                        format!(
                                            "native index update could not be persisted: {error}"
                                        ),
                                    );
                                } else {
                                    failures.remove(volumes[index].root());
                                }
                            }
                            index += 1;
                        }
                        Err(error) => {
                            let root = volumes.remove(index).root().to_path_buf();
                            self.revision.fetch_add(1, Ordering::AcqRel);
                            failures.insert(root.clone(), error.clone());
                            self.set_status(
                                generation,
                                NativeStatus::new(
                                    "building",
                                    Some(format!(
                                        "{}: rebuilding after journal error: {error}",
                                        root.display()
                                    )),
                                ),
                            );
                            match NativeVolume::build(&root, &cancel) {
                                Ok(volume) => {
                                    let path = snapshot_path(&storage, &root);
                                    if let Err(persist) = volume.persist(&path) {
                                        failures.insert(
                                            root.clone(),
                                            format!("native index rebuilt but snapshot was not saved: {persist}"),
                                        );
                                    } else {
                                        failures.remove(&root);
                                    }
                                    volumes.insert(index, volume);
                                    index += 1;
                                    self.revision.fetch_add(1, Ordering::AcqRel);
                                }
                                Err(rebuild) => {
                                    failures.insert(root, rebuild);
                                }
                            }
                        }
                    }
                }
                self.publish(generation, &volumes, &failures);
                next_refresh = Instant::now() + Duration::from_secs(1);
            }
        }

        fn publish(
            &self,
            generation: u64,
            volumes: &[NativeVolume],
            failures: &HashMap<PathBuf, String>,
        ) {
            let message = if failures.is_empty() {
                None
            } else {
                Some(
                    failures
                        .iter()
                        .map(|(root, reason)| format!("{}: {reason}", root.display()))
                        .collect::<Vec<_>>()
                        .join("; "),
                )
            };
            self.set_status(
                generation,
                NativeStatus {
                    provider: if volumes.is_empty() {
                        "portable-snapshot-walker"
                    } else if failures.is_empty() {
                        PROVIDER
                    } else {
                        "mixed-native-portable"
                    }
                    .into(),
                    state: if failures.is_empty() {
                        "ready"
                    } else {
                        "degraded"
                    }
                    .into(),
                    entries: volumes.iter().map(NativeVolume::len).sum(),
                    volumes: volumes.len(),
                    message,
                },
            );
        }

        fn query(
            &self,
            volumes: &[NativeVolume],
            failures: &HashMap<PathBuf, String>,
            query: &WorkerQuery,
            cache: &mut QueryCache,
        ) -> Response {
            let roots = match volume_roots(&query.roots) {
                Ok(roots) => roots,
                Err(message) => return Response::Error { message },
            };
            for root in roots {
                if !volumes.iter().any(|volume| volume.root() == root) {
                    return Response::Error {
                        message: failures.get(&root).cloned().unwrap_or_else(|| {
                            format!("native index does not cover {}", root.display())
                        }),
                    };
                }
            }
            let revision = self.revision.load(Ordering::Acquire);
            let folded_query = query.query.trim().to_lowercase();
            if cache.get(&query.roots, &folded_query, revision).is_none() {
                // A bounded result snapshot serves all pages. No repeated
                // full-index scans or filesystem metadata calls during paging.
                const MAX_MATCHES: usize = 200_000;
                let mut hits = Vec::new();
                for volume in volumes {
                    let (page, more) = volume.search_page(
                        &folded_query,
                        &query.roots,
                        0,
                        MAX_MATCHES + 1 - hits.len(),
                    );
                    hits.extend(page.into_iter().map(|hit| NativeHit {
                        path: hit.path,
                        name: hit.name,
                        is_directory: hit.is_directory,
                        attributes: hit.attributes,
                    }));
                    if more || hits.len() > MAX_MATCHES {
                        return Response::Error { message: "native query exceeds 200000 results; narrow the query or use fallback".into() };
                    }
                }
                let bytes = hits
                    .iter()
                    .map(|hit| hit.path.as_os_str().len() + hit.name.len() + size_of::<NativeHit>())
                    .sum::<usize>();
                if bytes > 64 * 1024 * 1024 {
                    return Response::Error { message: "native query exceeds 64 MB result budget; narrow the query or use fallback".into() };
                }
                cache.insert(SearchCache {
                    roots: query.roots.clone(),
                    query: folded_query.clone(),
                    revision,
                    hits,
                });
            }
            let cached = cache
                .get(&query.roots, &folded_query, revision)
                .expect("query cache was populated");
            let start = query.offset.min(cached.hits.len());
            let end = (start + query.limit).min(cached.hits.len());
            Response::Page {
                page: NativeSearchPage {
                    hits: cached.hits[start..end].to_vec(),
                    has_more: end < cached.hits.len(),
                    revision,
                },
            }
        }
    }

    fn run_helper(nonce: &str, parent_pid: u32) -> Result<(), String> {
        let name = endpoint_name(nonce, parent_pid)?;
        let parent = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                0,
                parent_pid,
            )
        };
        if parent.is_null() {
            return Err(last_error("open native index parent"));
        }
        let parent = Handle(parent);
        let sid = process_sid(unsafe { GetCurrentProcess() })?;
        if process_sid(parent.0)? != sid {
            return Err("native index parent and helper must have the same Windows user".into());
        }
        let pipe = create_pipe(&name, &sid)?;
        let service = Arc::new(Service::new());
        loop {
            if unsafe { WaitForSingleObject(parent.0, 0) } != WAIT_TIMEOUT {
                lock(&service.cancel).cancel();
                return Ok(());
            }
            let connected = unsafe { ConnectNamedPipe(pipe.0, null_mut()) };
            if connected == 0 {
                let error = unsafe { GetLastError() };
                if error == ERROR_PIPE_LISTENING {
                    thread::sleep(POLL);
                    continue;
                }
                if error != ERROR_PIPE_CONNECTED {
                    unsafe {
                        DisconnectNamedPipe(pipe.0);
                    }
                    thread::sleep(POLL);
                    continue;
                }
            }
            let mut client_pid = 0;
            let authorized = unsafe { GetNamedPipeClientProcessId(pipe.0, &mut client_pid) } != 0
                && client_pid == parent_pid;
            if authorized {
                let deadline = Instant::now() + IO_TIMEOUT;
                let response = match read_frame(pipe.0, deadline) {
                    Ok(request) => service.dispatch(request),
                    Err(message) => Response::Error { message },
                };
                if write_frame(pipe.0, &response, deadline).is_ok() {
                    let _ = transfer(pipe.0, &mut [0], false, deadline);
                }
            }
            unsafe {
                DisconnectNamedPipe(pipe.0);
            }
        }
    }

    /// Call before initializing Tauri/plugins. Malformed helper invocations
    /// still return true so an elevated helper never opens the normal GUI.
    pub fn native_helper_entry() -> bool {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) != Some("--muller-native-indexer") {
            return false;
        }
        if args.len() == 4
            && let Ok(parent) = args[3].parse::<u32>()
            && let Err(error) = run_helper(&args[2], parent)
        {
            eprintln!("Muller native index helper: {error}");
        }
        true
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn queued_search_cancels_without_waiting_for_uac_or_earlier_ipc() {
            let mut state = lock(broker());
            let previous = state.status.clone();
            set_broker_status(&mut state, NativeStatus::new("starting", None));
            let cancel = CancellationToken::default();
            let worker_cancel = cancel.clone();
            let (send, receive) = mpsc::channel();
            let (entered, queued) = mpsc::channel();
            let worker = thread::spawn(move || {
                entered.send(()).unwrap();
                let result = search_native_index_cancellable(
                    &[PathBuf::from("C:\\")],
                    "obsolete",
                    0,
                    1,
                    &worker_cancel,
                );
                send.send(result).unwrap();
            });
            queued.recv_timeout(Duration::from_secs(1)).unwrap();
            thread::sleep(Duration::from_millis(20));
            cancel.cancel();
            assert_eq!(
                receive
                    .recv_timeout(Duration::from_secs(1))
                    .unwrap()
                    .unwrap_err(),
                "native index query cancelled"
            );
            worker.join().unwrap();
            // The same held lock represents an outstanding UAC prompt. Status
            // returns its cached value without taking the serialized IPC lock.
            let (send_status, receive_status) = mpsc::channel();
            let status_worker = thread::spawn(move || send_status.send(native_status()).unwrap());
            assert_eq!(
                receive_status
                    .recv_timeout(Duration::from_secs(1))
                    .unwrap()
                    .state,
                "starting"
            );
            status_worker.join().unwrap();
            set_broker_status(&mut state, previous);
        }
        #[test]
        fn interleaved_queries_reuse_snapshots_and_journal_change_invalidates_them() {
            let roots = vec![PathBuf::from("C:\\")];
            let mut cache = QueryCache::default();
            for query in ["alpha", "beta"] {
                cache.insert(SearchCache {
                    roots: roots.clone(),
                    query: query.into(),
                    revision: 1,
                    hits: (0..4)
                        .map(|index| NativeHit {
                            path: PathBuf::from(format!("C:\\{query}{index}")),
                            name: format!("{query}{index}"),
                            is_directory: false,
                            attributes: 0,
                        })
                        .collect(),
                });
            }
            assert_eq!(
                cache.get(&roots, "alpha", 1).unwrap().hits[2].name,
                "alpha2"
            );
            assert_eq!(cache.get(&roots, "beta", 1).unwrap().hits[3].name, "beta3");
            assert_eq!(
                cache.get(&roots, "alpha", 1).unwrap().hits[0].name,
                "alpha0"
            );
            assert!(cache.get(&roots, "alpha", 2).is_none());
            assert!(cache.get(&roots, "beta", 2).is_none());
            assert!(cache.snapshots.is_empty());
        }
        #[test]
        fn acl_grants_only_user_and_system_with_medium_label() {
            let sddl = pipe_sddl("S-1-5-21-123-456-789-1001").unwrap();
            assert_eq!(
                sddl,
                "D:P(A;;GA;;;SY)(A;;GA;;;S-1-5-21-123-456-789-1001)S:(ML;;NW;;;ME)"
            );
            assert!(pipe_sddl("S-1-5-21)(A;;GA;;;WD)").is_err());
            let sid = process_sid(unsafe { GetCurrentProcess() }).unwrap();
            let nonce = "b".repeat(64);
            let pipe =
                create_pipe(&endpoint_name(&nonce, std::process::id()).unwrap(), &sid).unwrap();
            assert_ne!(pipe.0, INVALID_HANDLE_VALUE);
        }
        #[test]
        fn medium_process_can_roundtrip_large_framed_reply() {
            let name = endpoint_name(&"c".repeat(64), std::process::id()).unwrap();
            let server_name = name.clone();
            let (ready, start) = mpsc::channel();
            let server = thread::spawn(move || {
                let sid = process_sid(unsafe { GetCurrentProcess() }).unwrap();
                let pipe = create_pipe(&server_name, &sid).unwrap();
                ready.send(()).unwrap();
                let deadline = Instant::now() + IO_TIMEOUT;
                loop {
                    let ok = unsafe { ConnectNamedPipe(pipe.0, null_mut()) };
                    if ok != 0 || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED {
                        break;
                    }
                    assert!(Instant::now() < deadline);
                    thread::sleep(POLL);
                }
                let mut client = 0;
                assert_ne!(
                    unsafe { GetNamedPipeClientProcessId(pipe.0, &mut client) },
                    0
                );
                assert_eq!(client, std::process::id());
                assert!(matches!(
                    read_frame::<Request>(pipe.0, deadline).unwrap(),
                    Request::Status {}
                ));
                let hits = (0..2_000)
                    .map(|index| NativeHit {
                        path: PathBuf::from(format!("C:\\{}\\file-{index}.txt", "x".repeat(100))),
                        name: format!("file-{index}.txt"),
                        is_directory: false,
                        attributes: 0,
                    })
                    .collect();
                write_frame(
                    pipe.0,
                    &Response::Page {
                        page: NativeSearchPage {
                            hits,
                            has_more: false,
                            revision: 7,
                        },
                    },
                    deadline,
                )
                .unwrap();
                let mut ack = [0];
                transfer(pipe.0, &mut ack, false, deadline).unwrap();
                assert_eq!(ack, [1]);
                unsafe {
                    DisconnectNamedPipe(pipe.0);
                }
            });
            start.recv_timeout(IO_TIMEOUT).unwrap();
            let raw = unsafe {
                OpenProcess(
                    SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    std::process::id(),
                )
            };
            assert!(!raw.is_null());
            let endpoint = Endpoint {
                name,
                process_id: std::process::id(),
                process: Arc::new(ProcessHandle(raw)),
            };
            let Response::Page { page } = request(&endpoint, &Request::Status {}).unwrap() else {
                panic!("wrong reply");
            };
            assert_eq!(page.hits.len(), 2_000);
            assert_eq!(page.hits[1_999].name, "file-1999.txt");
            assert_eq!(page.revision, 7);
            server.join().unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints_cannot_escape_pipe_namespace() {
        assert!(
            endpoint_name(&"a".repeat(64), 123)
                .unwrap()
                .starts_with(r"\\.\pipe\Muller.NativeIndex.123.")
        );
        for nonce in ["../other", r"\\remote\pipe\other", "", "short"] {
            assert!(endpoint_name(nonce, 123).is_err());
        }
        assert!(endpoint_name(&"a".repeat(64), 0).is_err());
    }
    #[test]
    fn protocol_rejects_mutations_unknown_fields_and_unbounded_queries() {
        assert!(
            serde_json::from_str::<Request>(r#"{"command":"delete","path":"C:\\file"}"#).is_err()
        );
        assert!(
            serde_json::from_str::<Request>(r#"{"command":"status","shell":"cmd.exe"}"#).is_err()
        );
        let request = Request::Search {
            roots: vec!["C:\\".into()],
            query: "file".into(),
            offset: 0,
            limit: MAX_PAGE + 1,
        };
        assert!(validate_request(&request).is_err());

        let mut start = Request::Start {
            roots: vec![r"C:\".into()],
            storage_path: Some(PathBuf::from(r"relative\index")),
        };
        assert!(validate_request(&start).is_err());
        start = Request::Start {
            roots: vec![r"C:\".into()],
            storage_path: Some(PathBuf::from(r"C:\Muller-data\native-index-v1")),
        };
        assert!(validate_request(&start).is_ok());
    }
    #[test]
    fn roots_reject_network_device_relative_and_parent_traversal_paths() {
        for root in [r"\\server\share", r"\\.\C:", "C:relative", r"C:\a\..\b"] {
            assert!(volume_roots(&[root.into()]).is_err(), "{root}");
        }
        assert_eq!(
            volume_roots(&[
                r"c:\users".into(),
                r"C:\other".into(),
                r"\\?\D:\data".into()
            ])
            .unwrap(),
            vec![PathBuf::from("C:\\"), PathBuf::from("D:\\")]
        );
    }
}
