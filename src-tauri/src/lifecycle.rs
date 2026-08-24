use serde::{Deserialize, Serialize};
use std::{
    ffi::{OsStr, OsString},
    fs, io,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Manager, State};
#[cfg(windows)]
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE},
};

const AUTOSTART_FLAG: &str = "--autostart";
const SETTINGS_FILE: &str = "lifecycle.json";
#[cfg(windows)]
const AUTOSTART_VALUE_NAME: &str = "Muller";
#[cfg(windows)]
const RUN_REGISTRY_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const STARTUP_APPROVED_REGISTRY_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    #[serde(rename = "hide", alias = "hide_to_tray", alias = "hide_to_system_tray")]
    #[default]
    Hide,
    #[serde(rename = "quit", alias = "exit")]
    Quit,
}

#[derive(Debug, Clone, Serialize)]
pub struct CloseBehaviorState {
    pub behavior: CloseBehavior,
}

#[derive(Debug, Clone, Serialize)]
pub struct LifecycleError {
    pub code: String,
    pub message: String,
}

impl LifecycleError {
    fn persistence(error: impl std::fmt::Display) -> Self {
        Self {
            code: "persistence_failed".into(),
            message: error.to_string(),
        }
    }

    fn autostart(error: impl std::fmt::Display) -> Self {
        Self {
            code: "autostart_failed".into(),
            message: error.to_string(),
        }
    }

    fn autostart_status(error: impl std::fmt::Display) -> Self {
        Self {
            code: "autostart_status_failed".into(),
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AutostartStatus {
    pub enabled: bool,
    pub error: Option<LifecycleError>,
}

static AUTOSTART_REFRESH_ERROR: Mutex<Option<LifecycleError>> = Mutex::new(None);

#[derive(Debug, Deserialize, Serialize)]
struct PersistedSettings {
    behavior: CloseBehavior,
}

pub struct LifecycleState {
    behavior: Mutex<CloseBehavior>,
    settings_path: Mutex<Option<PathBuf>>,
    pending_show: AtomicBool,
    autostart_launch: bool,
}

impl Default for LifecycleState {
    fn default() -> Self {
        Self::new(false)
    }
}

impl LifecycleState {
    pub fn new(autostart_launch: bool) -> Self {
        Self {
            behavior: Mutex::new(CloseBehavior::default()),
            settings_path: Mutex::new(None),
            pending_show: AtomicBool::new(false),
            autostart_launch,
        }
    }

    pub fn initialize(&self, app: &AppHandle) {
        let path = app
            .path()
            .app_config_dir()
            .map(|dir| dir.join(SETTINGS_FILE));
        let mut loaded = false;
        if let Ok(path) = path {
            if let Ok(contents) = fs::read_to_string(&path)
                && let Ok(settings) = serde_json::from_str::<PersistedSettings>(&contents)
                && let Ok(mut behavior) = self.behavior.lock()
            {
                *behavior = settings.behavior;
                loaded = true;
            }
            if let Ok(mut stored_path) = self.settings_path.lock() {
                *stored_path = Some(path);
            }
        }
        log::info!(
            target: "muller::lifecycle",
            "event=lifecycle.initialized close_behavior={} source={}",
            match self.close_behavior() {
                CloseBehavior::Hide => "hide",
                CloseBehavior::Quit => "quit",
            },
            if loaded { "persisted" } else { "default" }
        );
    }

    pub fn close_behavior(&self) -> CloseBehavior {
        self.behavior.lock().map(|value| *value).unwrap_or_default()
    }

    pub fn set_close_behavior(&self, behavior: CloseBehavior) -> Result<(), LifecycleError> {
        let path = self
            .settings_path
            .lock()
            .map_err(|_| LifecycleError::persistence("lifecycle settings lock is poisoned"))?
            .clone()
            .ok_or_else(|| LifecycleError::persistence("lifecycle settings path is unavailable"))?;
        let settings = PersistedSettings { behavior };
        let contents = serde_json::to_vec_pretty(&settings).map_err(LifecycleError::persistence)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(LifecycleError::persistence)?;
        }
        fs::write(path, contents).map_err(LifecycleError::persistence)?;
        if let Ok(mut current) = self.behavior.lock() {
            *current = behavior;
        }
        log::info!(
            target: "muller::lifecycle",
            "event=lifecycle.close_behavior_changed behavior={}",
            match behavior {
                CloseBehavior::Hide => "hide",
                CloseBehavior::Quit => "quit",
            }
        );
        Ok(())
    }

    pub fn mark_pending_show(&self) {
        self.pending_show.store(true, Ordering::Release);
    }

    pub fn take_pending_show(&self) -> bool {
        self.pending_show.swap(false, Ordering::AcqRel)
    }

    pub fn is_autostart_launch(&self) -> bool {
        self.autostart_launch
    }
}

pub fn close_behavior_state(state: &LifecycleState) -> CloseBehaviorState {
    CloseBehaviorState {
        behavior: state.close_behavior(),
    }
}

#[tauri::command]
pub fn get_close_behavior(state: State<'_, LifecycleState>) -> CloseBehaviorState {
    close_behavior_state(&state)
}

#[tauri::command]
pub fn set_close_behavior(
    behavior: CloseBehavior,
    state: State<'_, LifecycleState>,
) -> Result<CloseBehaviorState, LifecycleError> {
    state.set_close_behavior(behavior)?;
    Ok(close_behavior_state(&state))
}

fn autostart_command(executable: &Path) -> OsString {
    let mut command = OsString::from("\"");
    command.push(executable.as_os_str());
    command.push(format!("\" {AUTOSTART_FLAG}"));
    command
}

fn startup_approved_enabled(bytes: &[u8]) -> Option<bool> {
    if bytes.len() != 12 {
        return None;
    }
    match bytes[0] {
        0x02 => Some(true),
        0x03 => Some(false),
        _ => None,
    }
}

fn startup_approved_allows_autostart(bytes: Option<&[u8]>) -> io::Result<bool> {
    match bytes {
        None => Ok(true),
        Some(bytes) => startup_approved_enabled(bytes).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "Windows StartupApproved value is malformed",
            )
        }),
    }
}

fn autostart_registration_matches_executable(registration: &OsStr, executable: &Path) -> bool {
    registration
        .to_string_lossy()
        .eq_ignore_ascii_case(&autostart_command(executable).to_string_lossy())
}

fn validate_autostart_registration(registration: &OsStr, executable: &Path) -> io::Result<()> {
    if autostart_registration_matches_executable(registration, executable) {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Windows startup registration does not target the current Muller executable",
        ))
    }
}

#[cfg(windows)]
fn is_not_found(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::NotFound
}

#[cfg(windows)]
fn read_run_registration() -> io::Result<Option<OsString>> {
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let key = match current_user.open_subkey_with_flags(RUN_REGISTRY_KEY, KEY_READ) {
        Ok(key) => key,
        Err(error) if is_not_found(&error) => return Ok(None),
        Err(error) => return Err(error),
    };
    match key.get_value(AUTOSTART_VALUE_NAME) {
        Ok(value) => Ok(Some(value)),
        Err(error) if is_not_found(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn read_startup_approved() -> io::Result<Option<Vec<u8>>> {
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let key = match current_user.open_subkey_with_flags(STARTUP_APPROVED_REGISTRY_KEY, KEY_READ) {
        Ok(key) => key,
        Err(error) if is_not_found(&error) => return Ok(None),
        Err(error) => return Err(error),
    };
    match key.get_raw_value(AUTOSTART_VALUE_NAME) {
        Ok(value) => Ok(Some(value.bytes)),
        Err(error) if is_not_found(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn read_enabled_run_registration() -> io::Result<Option<OsString>> {
    let Some(registration) = read_run_registration()? else {
        return Ok(None);
    };
    let startup_approved = read_startup_approved()?;
    if startup_approved_allows_autostart(startup_approved.as_deref())? {
        Ok(Some(registration))
    } else {
        Ok(None)
    }
}

#[cfg(windows)]
fn read_autostart_enabled() -> io::Result<bool> {
    let Some(registration) = read_enabled_run_registration()? else {
        return Ok(false);
    };
    validate_autostart_registration(&registration, &std::env::current_exe()?)?;
    Ok(true)
}

#[cfg(not(windows))]
fn read_autostart_enabled() -> io::Result<bool> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Windows autostart is unavailable on this platform",
    ))
}

#[cfg(windows)]
fn delete_registry_value(key_path: &str) -> io::Result<()> {
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let key = match current_user.open_subkey_with_flags(key_path, KEY_SET_VALUE) {
        Ok(key) => key,
        Err(error) if is_not_found(&error) => return Ok(()),
        Err(error) => return Err(error),
    };
    match key.delete_value(AUTOSTART_VALUE_NAME) {
        Ok(()) => Ok(()),
        Err(error) if is_not_found(&error) => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn enable_autostart() -> io::Result<()> {
    let executable = std::env::current_exe()?;
    let command = autostart_command(&executable);
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = current_user.create_subkey(RUN_REGISTRY_KEY)?;
    run_key.set_value(AUTOSTART_VALUE_NAME, &command)?;
    delete_registry_value(STARTUP_APPROVED_REGISTRY_KEY)
}

#[cfg(not(windows))]
fn enable_autostart() -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Windows autostart is unavailable on this platform",
    ))
}

#[cfg(windows)]
fn disable_autostart() -> io::Result<()> {
    let run_result = delete_registry_value(RUN_REGISTRY_KEY);
    let approved_result = delete_registry_value(STARTUP_APPROVED_REGISTRY_KEY);
    run_result.and(approved_result)
}

#[cfg(not(windows))]
fn disable_autostart() -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Windows autostart is unavailable on this platform",
    ))
}

fn autostart_status() -> AutostartStatus {
    let status =
        autostart_status_from_result(read_autostart_enabled(), take_autostart_refresh_error());
    log::debug!(
        target: "muller::lifecycle",
        "event=autostart.status enabled={} error_code={}",
        status.enabled,
        status.error.as_ref().map_or("none", |error| error.code.as_str())
    );
    status
}

fn reconcile_autostart_status(
    requested: bool,
    operation_error: Option<LifecycleError>,
    mut status: AutostartStatus,
) -> AutostartStatus {
    if status.error.is_none() && status.enabled != requested {
        status.error = Some(operation_error.unwrap_or_else(|| {
            LifecycleError::autostart("Windows reported a different startup state")
        }));
    }
    status
}

fn autostart_status_from_result(
    result: io::Result<bool>,
    refresh_error: Option<LifecycleError>,
) -> AutostartStatus {
    match result {
        Ok(enabled) => AutostartStatus {
            enabled,
            error: refresh_error,
        },
        Err(error) => {
            let message = if let Some(refresh_error) = refresh_error {
                format!(
                    "{error}; startup registration refresh failed: {}",
                    refresh_error.message
                )
            } else {
                error.to_string()
            };
            AutostartStatus {
                enabled: false,
                error: Some(LifecycleError::autostart_status(message)),
            }
        }
    }
}

fn replace_autostart_refresh_error(error: Option<LifecycleError>) {
    let mut current = AUTOSTART_REFRESH_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *current = error;
}

fn take_autostart_refresh_error() -> Option<LifecycleError> {
    AUTOSTART_REFRESH_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
}

#[tauri::command]
pub fn get_autostart_status() -> AutostartStatus {
    autostart_status()
}

#[tauri::command]
pub fn set_autostart_enabled(enabled: bool) -> AutostartStatus {
    log::info!(
        target: "muller::lifecycle",
        "event=autostart.change_requested enabled={enabled}"
    );
    // A user-requested update supersedes any startup-time refresh failure.
    let _ = take_autostart_refresh_error();
    let operation_error = if enabled {
        enable_autostart().err()
    } else {
        disable_autostart().err()
    }
    .map(LifecycleError::autostart);

    let status = reconcile_autostart_status(enabled, operation_error, autostart_status());
    log::info!(
        target: "muller::lifecycle",
        "event=autostart.change_finished enabled={} error_code={}",
        status.enabled,
        status.error.as_ref().map_or("none", |error| error.code.as_str())
    );
    status
}

pub fn is_autostart_args(args: &[String]) -> bool {
    args.iter().any(|arg| arg == AUTOSTART_FLAG)
}

#[cfg(windows)]
fn refresh_enabled_autostart_registration_inner() -> io::Result<()> {
    let Some(registration) = read_enabled_run_registration()? else {
        return Ok(());
    };
    let executable = std::env::current_exe()?;
    if autostart_registration_matches_executable(&registration, &executable) {
        return Ok(());
    }

    enable_autostart()?;
    let refreshed = read_enabled_run_registration()?.ok_or_else(|| {
        io::Error::other("Windows disabled the Muller startup registration after it was refreshed")
    })?;
    validate_autostart_registration(&refreshed, &executable)
}

#[cfg(not(windows))]
fn refresh_enabled_autostart_registration_inner() -> io::Result<()> {
    Ok(())
}

pub fn refresh_enabled_autostart_registration() {
    let error = refresh_enabled_autostart_registration_inner()
        .err()
        .map(LifecycleError::autostart);
    if error.is_some() {
        log::warn!(target: "muller::lifecycle", "event=autostart.refresh_failed");
    } else {
        log::debug!(target: "muller::lifecycle", "event=autostart.refresh_finished");
    }
    replace_autostart_refresh_error(error);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_behavior_defaults_to_hide_and_accepts_legacy_names() {
        assert_eq!(CloseBehavior::default(), CloseBehavior::Hide);
        assert_eq!(
            serde_json::from_str::<CloseBehavior>("\"hide_to_tray\"").unwrap(),
            CloseBehavior::Hide
        );
        assert_eq!(
            serde_json::from_str::<CloseBehavior>("\"exit\"").unwrap(),
            CloseBehavior::Quit
        );
        assert_eq!(
            serde_json::to_string(&CloseBehavior::Quit).unwrap(),
            "\"quit\""
        );
    }

    #[test]
    fn malformed_persisted_settings_are_not_deserialized() {
        assert!(serde_json::from_str::<PersistedSettings>("not-json").is_err());
        assert!(serde_json::from_str::<PersistedSettings>(r#"{"behavior":"unknown"}"#).is_err());
    }

    #[test]
    fn close_behavior_is_persisted_before_becoming_active() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SETTINGS_FILE);
        let state = LifecycleState::default();
        *state.settings_path.lock().unwrap() = Some(path.clone());

        state.set_close_behavior(CloseBehavior::Quit).unwrap();

        assert_eq!(state.close_behavior(), CloseBehavior::Quit);
        let persisted = fs::read_to_string(path).unwrap();
        assert_eq!(
            serde_json::from_str::<PersistedSettings>(&persisted)
                .unwrap()
                .behavior,
            CloseBehavior::Quit
        );
    }

    #[test]
    fn close_behavior_requires_an_initialized_settings_path() {
        let state = LifecycleState::default();
        let error = state.set_close_behavior(CloseBehavior::Quit).unwrap_err();
        assert_eq!(error.code, "persistence_failed");
        assert_eq!(state.close_behavior(), CloseBehavior::Hide);
    }

    #[test]
    fn pending_show_is_consumed_once() {
        let state = LifecycleState::default();
        assert!(!state.take_pending_show());
        state.mark_pending_show();
        assert!(state.take_pending_show());
        assert!(!state.take_pending_show());
    }

    #[test]
    fn actual_autostart_state_wins_over_an_idempotent_operation_error() {
        let operation_error = Some(LifecycleError::autostart("entry was already absent"));
        let status = AutostartStatus {
            enabled: false,
            error: None,
        };

        let reconciled = reconcile_autostart_status(false, operation_error, status);

        assert!(!reconciled.enabled);
        assert!(reconciled.error.is_none());
    }

    #[test]
    fn mismatched_autostart_state_reports_an_error() {
        let status = AutostartStatus {
            enabled: false,
            error: None,
        };

        let reconciled = reconcile_autostart_status(true, None, status);

        assert!(!reconciled.enabled);
        assert_eq!(reconciled.error.unwrap().code, "autostart_failed");
    }

    #[test]
    fn autostart_flag_is_distinguished_from_manual_launch() {
        assert!(is_autostart_args(&[
            "muller.exe".into(),
            AUTOSTART_FLAG.into()
        ]));
        assert!(!is_autostart_args(&["muller.exe".into()]));
    }

    #[test]
    fn autostart_command_quotes_paths_with_spaces_and_unicode() {
        let path = "C:\\Program Files\\Muller \u{7a0b}\u{5e8f}\\muller.exe";
        let command = autostart_command(Path::new(path));
        assert_eq!(command.to_string_lossy(), format!("\"{path}\" --autostart"));
    }

    #[test]
    fn autostart_registration_must_target_the_current_executable() {
        let current = Path::new("C:\\Program Files\\Muller\\muller.exe");
        let current_command = autostart_command(current);
        let differently_cased =
            OsString::from("\"c:\\program files\\muller\\MULLER.EXE\" --autostart");
        let stale_command = autostart_command(Path::new(
            "C:\\Users\\user\\AppData\\Local\\Muller-old\\muller.exe",
        ));

        assert!(autostart_registration_matches_executable(
            &current_command,
            current
        ));
        assert!(autostart_registration_matches_executable(
            &differently_cased,
            current
        ));
        assert!(!autostart_registration_matches_executable(
            &stale_command,
            current
        ));
        assert_eq!(
            validate_autostart_registration(&stale_command, current)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn startup_refresh_failure_is_exposed_by_the_next_status_read() {
        let refresh_error = LifecycleError::autostart("access denied while refreshing the path");

        let status = autostart_status_from_result(Ok(false), Some(refresh_error));

        assert!(!status.enabled);
        let error = status.error.unwrap();
        assert_eq!(error.code, "autostart_failed");
        assert!(error.message.contains("access denied"));
    }

    #[test]
    fn startup_refresh_and_status_failures_preserve_both_diagnostics() {
        let read_error = io::Error::new(io::ErrorKind::InvalidData, "stale Run command");
        let refresh_error = LifecycleError::autostart("registry write denied");

        let status = autostart_status_from_result(Err(read_error), Some(refresh_error));

        assert!(!status.enabled);
        let error = status.error.unwrap();
        assert_eq!(error.code, "autostart_status_failed");
        assert!(error.message.contains("stale Run command"));
        assert!(error.message.contains("registry write denied"));
    }

    #[test]
    fn startup_approved_state_rejects_disabled_and_malformed_values() {
        assert_eq!(
            startup_approved_enabled(&[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            Some(true)
        );
        assert_eq!(
            startup_approved_enabled(&[3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            Some(false)
        );
        assert_eq!(
            startup_approved_enabled(&[4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            None
        );
        assert_eq!(startup_approved_enabled(&[2, 0, 0, 0]), None);
    }
}
