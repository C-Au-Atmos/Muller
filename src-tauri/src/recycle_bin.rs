//! The current user's Windows Recycle Bin. Clients receive opaque catalogue
//! identities, never a filesystem path that can be supplied to a delete API.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RecycleKind {
    File,
    Folder,
    Other,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleEntry {
    pub id: String,
    pub name: String,
    pub original_path: String,
    pub original_parent: String,
    pub kind: RecycleKind,
    pub size: Option<u64>,
    pub deleted_ms: Option<i64>,
    pub type_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleSnapshot {
    pub entries: Vec<RecycleEntry>,
    pub total_count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecycleRequest {
    pub ids: Vec<String>,
    #[serde(default)]
    pub confirmed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleFailure {
    pub id: String,
    pub message: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleReport {
    pub succeeded_ids: Vec<String>,
    pub failures: Vec<RecycleFailure>,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct Record {
    key: Vec<u16>,
    name: String,
    original_parent: String,
    kind: RecycleKind,
    size: Option<u64>,
    deleted_ticks: Option<u64>,
    type_label: String,
}

impl Record {
    fn entry(&self, id: String) -> RecycleEntry {
        RecycleEntry {
            id,
            name: self.name.clone(),
            original_path: std::path::Path::new(&self.original_parent)
                .join(&self.name)
                .to_string_lossy()
                .into_owned(),
            original_parent: self.original_parent.clone(),
            kind: self.kind.clone(),
            size: self.size,
            deleted_ms: self.deleted_ticks.and_then(filetime_to_unix_ms),
            type_label: self.type_label.clone(),
        }
    }
}

fn filetime_to_unix_ms(ticks: u64) -> Option<i64> {
    let ms = i128::from(ticks) / 10_000 - 11_644_473_600_000_i128;
    i64::try_from(ms).ok()
}

#[derive(Clone, Copy)]
enum Action {
    Restore,
    Delete,
}

trait Shell {
    fn enumerate(&mut self) -> Result<Vec<Record>, String>;
    fn apply(&mut self, record: &Record, action: Action) -> Result<(), String>;
}

#[derive(Default)]
struct Catalogue {
    records: HashMap<String, Record>,
    next_id: u64,
}

impl Catalogue {
    fn update(&mut self, records: Vec<Record>) -> RecycleSnapshot {
        let old: HashMap<_, _> = self
            .records
            .drain()
            .map(|(id, record)| (record, id))
            .collect();
        let mut entries = Vec::with_capacity(records.len());
        for record in records {
            let id = old.get(&record).cloned().unwrap_or_else(|| {
                self.next_id += 1;
                format!("rb-{:016x}", self.next_id)
            });
            entries.push(record.entry(id.clone()));
            self.records.insert(id, record);
        }
        RecycleSnapshot {
            total_count: entries.len(),
            total_bytes: entries
                .iter()
                .filter_map(|item| item.size)
                .fold(0_u64, u64::saturating_add),
            entries,
        }
    }

    fn operate(
        &mut self,
        shell: &mut impl Shell,
        request: RecycleRequest,
        action: Action,
    ) -> Result<RecycleReport, String> {
        if matches!(action, Action::Delete) && !request.confirmed {
            return Err("Permanently deleting Recycle Bin items requires confirmation.".into());
        }
        if request.ids.len() > 250_000 {
            return Err("Too many Recycle Bin items in one request.".into());
        }
        let mut report = RecycleReport::default();
        if request.ids.is_empty() {
            return Ok(report);
        }
        // Only objects freshly enumerated from the current user's Shell namespace
        // can reach apply. A stale row must not act on a replacement object.
        let current: HashSet<_> = shell.enumerate()?.into_iter().collect();
        let mut seen = HashSet::new();
        let mut attempted = Vec::new();
        for id in request.ids {
            if !seen.insert(id.clone()) {
                continue;
            }
            let Some(record) = self
                .records
                .get(&id)
                .filter(|record| current.contains(*record))
            else {
                report.failures.push(RecycleFailure { id, message: "This item changed or is no longer in the Windows Recycle Bin. Refresh and try again.".into() });
                continue;
            };
            let result = shell.apply(record, action);
            attempted.push((id, record.clone(), result));
        }
        // Shell command invocation alone is not success: a collision dialog can
        // be cancelled, and IFileOperation can return S_OK after a skipped item.
        let after = shell.enumerate()?;
        let remaining: HashSet<_> = after.iter().cloned().collect();
        for (id, record, result) in attempted {
            match result {
                Ok(()) if !remaining.contains(&record) => report.succeeded_ids.push(id),
                Ok(()) => {
                    report.cancelled = true;
                    report.failures.push(RecycleFailure { id, message: "Windows did not complete this operation. The item remains in the Recycle Bin; it may have been skipped or cancelled.".into() });
                }
                Err(message) => {
                    report.cancelled |= message.contains("cancelled");
                    report.failures.push(RecycleFailure { id, message });
                }
            }
        }
        self.update(after);
        Ok(report)
    }
}

#[derive(Clone, Default)]
pub struct RecycleBinManager {
    catalogue: Arc<Mutex<Catalogue>>,
}

impl RecycleBinManager {
    pub fn list(&self) -> Result<RecycleSnapshot, String> {
        let manager = self.clone();
        platform::run(0, move |shell| {
            let mut catalogue = manager
                .catalogue
                .lock()
                .map_err(|_| "Recycle Bin catalogue unavailable")?;
            Ok(catalogue.update(shell.enumerate()?))
        })
    }

    pub fn restore(&self, request: RecycleRequest) -> Result<RecycleReport, String> {
        self.operate(request, Action::Restore)
    }
    pub fn delete(&self, request: RecycleRequest) -> Result<RecycleReport, String> {
        self.operate(request, Action::Delete)
    }

    fn operate(&self, request: RecycleRequest, action: Action) -> Result<RecycleReport, String> {
        self.operate_with_owner(request, action, 0)
    }

    fn operate_with_owner(
        &self,
        request: RecycleRequest,
        action: Action,
        owner: isize,
    ) -> Result<RecycleReport, String> {
        let manager = self.clone();
        platform::run(owner, move |shell| {
            manager
                .catalogue
                .lock()
                .map_err(|_| "Recycle Bin catalogue unavailable")?
                .operate(shell, request, action)
        })
    }
}

#[tauri::command]
pub async fn list_recycle_bin(
    manager: tauri::State<'_, RecycleBinManager>,
) -> Result<RecycleSnapshot, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.list())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_recycle_bin_items(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, RecycleBinManager>,
    request: RecycleRequest,
) -> Result<RecycleReport, String> {
    let manager = manager.inner().clone();
    let owner = window_owner(&window);
    tauri::async_runtime::spawn_blocking(move || {
        manager.operate_with_owner(request, Action::Restore, owner)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_recycle_bin_items(
    window: tauri::WebviewWindow,
    manager: tauri::State<'_, RecycleBinManager>,
    request: RecycleRequest,
) -> Result<RecycleReport, String> {
    let manager = manager.inner().clone();
    let owner = window_owner(&window);
    tauri::async_runtime::spawn_blocking(move || {
        manager.operate_with_owner(request, Action::Delete, owner)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn window_owner(window: &tauri::WebviewWindow) -> isize {
    #[cfg(windows)]
    {
        window.hwnd().map(|handle| handle.0 as isize).unwrap_or(0)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        0
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use windows::Win32::System::SystemServices::{SFGAO_FILESYSTEM, SFGAO_FOLDER};
    use windows::{
        Win32::{
            Foundation::{HWND, PROPERTYKEY},
            System::Com::{
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            },
            UI::{
                Shell::*,
                WindowsAndMessaging::{CreatePopupMenu, DestroyMenu, SW_SHOWNORMAL},
            },
        },
        core::{Interface, PCSTR, PWSTR},
    };

    const ORIGINAL_PARENT: PROPERTYKEY = PROPERTYKEY {
        fmtid: PSGUID_DISPLACED,
        pid: PID_DISPLACED_FROM,
    };
    const DELETED_AT: PROPERTYKEY = PROPERTYKEY {
        fmtid: PSGUID_DISPLACED,
        pid: PID_DISPLACED_DATE,
    };
    const SIZE: PROPERTYKEY = PROPERTYKEY {
        fmtid: windows::core::GUID::from_u128(0xb725f130_47ef_101a_a5f1_02608c9eebac),
        pid: 12,
    };
    const TYPE: PROPERTYKEY = PROPERTYKEY {
        fmtid: windows::core::GUID::from_u128(0xb725f130_47ef_101a_a5f1_02608c9eebac),
        pid: 4,
    };
    const FILE_ATTRIBUTES: PROPERTYKEY = PROPERTYKEY {
        fmtid: windows::core::GUID::from_u128(0xb725f130_47ef_101a_a5f1_02608c9eebac),
        pid: 13,
    };

    pub(super) struct WindowsShell {
        items: HashMap<Vec<u16>, IShellItem>,
        owner: HWND,
    }

    pub(super) fn run<T: Send + 'static>(
        owner: isize,
        f: impl FnOnce(&mut WindowsShell) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        std::thread::Builder::new()
            .name("muller-recycle-shell".into())
            .spawn(move || {
                // Each operation owns its STA and all COM objects stay on this thread.
                unsafe {
                    CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).ok()
                }
                .map_err(|e| e.to_string())?;
                struct Apartment;
                impl Drop for Apartment {
                    fn drop(&mut self) {
                        unsafe { CoUninitialize() };
                    }
                }
                let _apartment = Apartment;
                f(&mut WindowsShell {
                    items: HashMap::new(),
                    owner: HWND(owner as *mut c_void),
                })
            })
            .map_err(|e| e.to_string())?
            .join()
            .map_err(|_| "Windows Recycle Bin worker failed".to_owned())?
    }

    unsafe fn take_string(value: PWSTR) -> Vec<u16> {
        // Shell-returned strings are NUL terminated and allocated by COM.
        let result = if value.is_null() {
            Vec::new()
        } else {
            unsafe { value.as_wide().to_vec() }
        };
        unsafe { CoTaskMemFree(Some(value.0 as *const c_void)) };
        result
    }

    impl Shell for WindowsShell {
        fn enumerate(&mut self) -> Result<Vec<Record>, String> {
            self.items.clear();
            unsafe {
                let bin: IShellItem =
                    SHGetKnownFolderItem(&FOLDERID_RecycleBinFolder, KF_FLAG_DEFAULT, None)
                        .map_err(|e| e.to_string())?;
                let enumerator: IEnumShellItems = bin
                    .BindToHandler(None, &BHID_EnumItems)
                    .map_err(|e| e.to_string())?;
                let mut records = Vec::new();
                loop {
                    let mut items = [None];
                    let mut fetched = 0;
                    enumerator
                        .Next(&mut items, Some(&mut fetched))
                        .map_err(|e| e.to_string())?;
                    if fetched == 0 {
                        break;
                    }
                    let item = items[0]
                        .take()
                        .ok_or("Windows returned an empty Recycle Bin item")?;
                    let key = take_string(
                        item.GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING)
                            .map_err(|e| e.to_string())?,
                    );
                    let name = take_string(
                        item.GetDisplayName(SIGDN_PARENTRELATIVE)
                            .map_err(|e| e.to_string())?,
                    );
                    let item2: IShellItem2 = item.cast().map_err(|e| e.to_string())?;
                    let original_parent = take_string(
                        item2
                            .GetString(&ORIGINAL_PARENT)
                            .map_err(|e| e.to_string())?,
                    );
                    let attributes = item
                        .GetAttributes(SFGAO_FOLDER | SFGAO_FILESYSTEM)
                        .map_err(|e| e.to_string())?;
                    // Shell treats ZIP archives as browsable folders. Prefer
                    // filesystem attributes to preserve the actual entry kind.
                    let is_directory = item2
                        .GetUInt32(&FILE_ATTRIBUTES)
                        .map(|value| value & 0x10 != 0)
                        .unwrap_or_else(|_| attributes.contains(SFGAO_FOLDER));
                    let kind = if is_directory {
                        RecycleKind::Folder
                    } else if attributes.contains(SFGAO_FILESYSTEM) {
                        RecycleKind::File
                    } else {
                        RecycleKind::Other
                    };
                    let record = Record {
                        key: key.clone(),
                        name: String::from_utf16_lossy(&name),
                        original_parent: String::from_utf16_lossy(&original_parent),
                        kind,
                        size: item2.GetUInt64(&SIZE).ok(),
                        deleted_ticks: item2.GetFileTime(&DELETED_AT).ok().map(|time| {
                            (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
                        }),
                        type_label: item2
                            .GetString(&TYPE)
                            .ok()
                            .map(|v| String::from_utf16_lossy(&take_string(v)))
                            .unwrap_or_default(),
                    };
                    self.items.insert(key, item);
                    records.push(record);
                    if records.len() > 250_000 {
                        return Err("The Windows Recycle Bin contains more than 250,000 items. Open the system Recycle Bin to manage it.".into());
                    }
                }
                Ok(records)
            }
        }

        fn apply(&mut self, record: &Record, action: Action) -> Result<(), String> {
            let item = self
                .items
                .get(&record.key)
                .ok_or("Recycle Bin item is no longer available")?;
            unsafe {
                match action {
                    Action::Restore => {
                        let menu: IContextMenu = item
                            .BindToHandler(None, &BHID_SFUIObject)
                            .map_err(|e| e.to_string())?;
                        let popup = CreatePopupMenu().map_err(|e| e.to_string())?;
                        let query = menu.QueryContextMenu(popup, 0, 1, 0x7fff, CMF_NORMAL).ok();
                        let _ = DestroyMenu(popup);
                        query.map_err(|e| e.to_string())?;
                        let info = CMINVOKECOMMANDINFO {
                            cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
                            fMask: SEE_MASK_NOASYNC,
                            hwnd: self.owner,
                            lpVerb: PCSTR(c"undelete".as_ptr().cast()),
                            nShow: SW_SHOWNORMAL.0,
                            ..Default::default()
                        };
                        // Windows owns name-conflict and missing-parent dialogs.
                        // No NO_UI/NOCONFIRMATION flag may silently replace a file.
                        menu.InvokeCommand(&info).map_err(shell_error)?;
                    }
                    Action::Delete => {
                        let operation: IFileOperation =
                            CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)
                                .map_err(|e| e.to_string())?;
                        if !self.owner.is_invalid() {
                            operation.SetOwnerWindow(self.owner).map_err(shell_error)?;
                        }
                        // Confirmation has already happened in Muller. Crucially,
                        // ALLOWUNDO/RECYCLEONDELETE are absent for permanent delete.
                        operation
                            .SetOperationFlags(FOF_NO_UI | FOFX_EARLYFAILURE)
                            .map_err(|e| e.to_string())?;
                        operation
                            .DeleteItem(item, None)
                            .map_err(|e| e.to_string())?;
                        operation.PerformOperations().map_err(shell_error)?;
                        if operation
                            .GetAnyOperationsAborted()
                            .map_err(|e| e.to_string())?
                            .as_bool()
                        {
                            return Err(
                                "Windows cancelled or skipped the permanent deletion.".into()
                            );
                        }
                    }
                }
            }
            Ok(())
        }
    }

    fn shell_error(error: windows::core::Error) -> String {
        if matches!(error.code().0 as u32, 0x8007_04c7 | 0x8000_4004) {
            "Windows cancelled this Recycle Bin operation.".into()
        } else {
            error.to_string()
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub(super) struct Unsupported;
    impl Shell for Unsupported {
        fn enumerate(&mut self) -> Result<Vec<Record>, String> {
            Err("Windows Recycle Bin is only available on Windows.".into())
        }
        fn apply(&mut self, _: &Record, _: Action) -> Result<(), String> {
            self.enumerate().map(|_| ())
        }
    }
    pub(super) fn run<T>(
        _owner: isize,
        f: impl FnOnce(&mut Unsupported) -> Result<T, String>,
    ) -> Result<T, String> {
        f(&mut Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeShell {
        records: Vec<Record>,
        applied: Vec<Record>,
        skip: bool,
        fail: bool,
    }
    impl Shell for FakeShell {
        fn enumerate(&mut self) -> Result<Vec<Record>, String> {
            Ok(self.records.clone())
        }
        fn apply(&mut self, record: &Record, _: Action) -> Result<(), String> {
            self.applied.push(record.clone());
            if self.fail {
                return Err("Permission denied".into());
            }
            if !self.skip {
                self.records.retain(|item| item != record);
            }
            Ok(())
        }
    }
    fn record(key: &str) -> Record {
        Record {
            key: key.encode_utf16().collect(),
            name: "響喜乱舞.zip".into(),
            original_parent: "D:\\Music\\Old".into(),
            kind: RecycleKind::File,
            size: Some(123),
            deleted_ticks: Some(133_000_000_000_000_000),
            type_label: "ZIP".into(),
        }
    }
    fn request(ids: Vec<String>) -> RecycleRequest {
        RecycleRequest {
            ids,
            confirmed: true,
        }
    }

    #[test]
    fn catalogue_ids_survive_refresh_but_change_for_replaced_records() {
        let mut catalogue = Catalogue::default();
        let item = record("shell-id");
        let first = catalogue.update(vec![item.clone()]).entries.remove(0);
        assert!(!first.id.contains("shell"));
        assert_eq!(first.id, catalogue.update(vec![item.clone()]).entries[0].id);
        let mut replaced = item;
        replaced.deleted_ticks = Some(133_000_000_000_000_001);
        assert_ne!(first.id, catalogue.update(vec![replaced]).entries[0].id);
    }

    #[test]
    fn unknown_and_stale_ids_never_reach_shell_operations() {
        let mut catalogue = Catalogue::default();
        let id = catalogue
            .update(vec![record("original")])
            .entries
            .remove(0)
            .id;
        let mut shell = FakeShell {
            records: vec![record("replacement")],
            ..Default::default()
        };
        let report = catalogue
            .operate(
                &mut shell,
                request(vec![id, "C:\\arbitrary.txt".into()]),
                Action::Delete,
            )
            .unwrap();
        assert_eq!(report.failures.len(), 2);
        assert!(shell.applied.is_empty());
    }

    #[test]
    fn confirmed_snapshot_does_not_delete_new_arrivals_and_deduplicates_selection() {
        let mut catalogue = Catalogue::default();
        let original = record("original");
        let id = catalogue
            .update(vec![original.clone()])
            .entries
            .remove(0)
            .id;
        let arrival = record("new-arrival");
        let mut shell = FakeShell {
            records: vec![original, arrival.clone()],
            ..Default::default()
        };
        let report = catalogue
            .operate(
                &mut shell,
                request(vec![id.clone(), id.clone()]),
                Action::Delete,
            )
            .unwrap();
        assert_eq!(report.succeeded_ids, vec![id]);
        assert_eq!(shell.applied.len(), 1);
        assert_eq!(shell.records, vec![arrival]);
    }

    #[test]
    fn permanent_delete_requires_confirmation_before_shell_access() {
        let mut catalogue = Catalogue::default();
        let mut shell = FakeShell::default();
        let error = catalogue
            .operate(
                &mut shell,
                RecycleRequest {
                    ids: vec!["arbitrary".into()],
                    confirmed: false,
                },
                Action::Delete,
            )
            .unwrap_err();
        assert!(error.contains("confirmation"));
        assert!(shell.applied.is_empty());
    }

    #[test]
    fn shell_success_with_remaining_item_is_reported_as_cancelled() {
        let mut catalogue = Catalogue::default();
        let item = record("original");
        let id = catalogue.update(vec![item.clone()]).entries.remove(0).id;
        let mut shell = FakeShell {
            records: vec![item],
            skip: true,
            ..Default::default()
        };
        let report = catalogue
            .operate(&mut shell, request(vec![id]), Action::Restore)
            .unwrap();
        assert!(report.cancelled);
        assert!(report.succeeded_ids.is_empty());
        assert_eq!(report.failures.len(), 1);
    }

    #[test]
    fn shell_error_is_not_misreported_as_success() {
        let mut catalogue = Catalogue::default();
        let item = record("original");
        let id = catalogue.update(vec![item.clone()]).entries.remove(0).id;
        let mut shell = FakeShell {
            records: vec![item],
            fail: true,
            ..Default::default()
        };
        let report = catalogue
            .operate(&mut shell, request(vec![id]), Action::Restore)
            .unwrap();
        assert_eq!(report.failures[0].message, "Permission denied");
        assert!(report.succeeded_ids.is_empty());
    }

    #[test]
    fn filetime_conversion_supports_pre_epoch_dates_without_underflow() {
        assert_eq!(filetime_to_unix_ms(116_444_736_000_000_000), Some(0));
        assert_eq!(filetime_to_unix_ms(116_444_735_999_990_000), Some(-1));
    }
}
