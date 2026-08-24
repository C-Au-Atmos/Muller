use log::LevelFilter;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Manager, Runtime, State, plugin::TauriPlugin};
use tauri_plugin_log::{
    Builder as LogBuilder, RotationStrategy, Target, TargetKind, TimezoneStrategy,
};

const SETTINGS_FILE: &str = "diagnostics.json";
const LOG_FILE_NAME: &str = "muller";
const LOG_FILE_SIZE_BYTES: u128 = 5 * 1024 * 1024;
const ARCHIVED_LOG_FILES: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsError {
    pub code: String,
    pub message: String,
}

impl DiagnosticsError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn persistence() -> Self {
        Self::new(
            "diagnostics_persistence_failed",
            "The diagnostic logging preference could not be saved",
        )
    }

    fn unavailable() -> Self {
        Self::new(
            "diagnostics_unavailable",
            "The diagnostic log directory is unavailable",
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsStatus {
    pub debug_enabled: bool,
    pub effective_level: String,
    pub log_directory: Option<String>,
    pub error: Option<DiagnosticsError>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDiagnostics {
    debug_enabled: bool,
}

struct LoadedDiagnostics {
    settings: PersistedDiagnostics,
    rewrite: bool,
    error: Option<DiagnosticsError>,
}

pub struct DiagnosticsState {
    debug_enabled: AtomicBool,
    settings_path: Mutex<Option<PathBuf>>,
    log_directory: Mutex<Option<PathBuf>>,
    environment_level: Option<LevelFilter>,
    initialization_error: Mutex<Option<DiagnosticsError>>,
}

impl Default for DiagnosticsState {
    fn default() -> Self {
        Self {
            debug_enabled: AtomicBool::new(false),
            settings_path: Mutex::new(None),
            log_directory: Mutex::new(None),
            environment_level: parse_environment_level(std::env::var("MULLER_LOG").ok().as_deref()),
            initialization_error: Mutex::new(None),
        }
    }
}

impl DiagnosticsState {
    pub fn initialize(&self, app: &AppHandle, logger_error: Option<DiagnosticsError>) {
        let settings_path = app
            .path()
            .app_config_dir()
            .map(|directory| directory.join(SETTINGS_FILE));
        let log_directory = app.path().app_log_dir();
        let mut initialization_error = logger_error;

        if let Ok(path) = settings_path {
            let loaded = load_settings(&path);
            if let Some(error) = loaded.error {
                initialization_error.get_or_insert(error);
            }
            self.debug_enabled
                .store(loaded.settings.debug_enabled, Ordering::Release);
            if let Ok(mut stored_path) = self.settings_path.lock() {
                *stored_path = Some(path.clone());
            }
            if loaded.rewrite && write_settings(&path, &loaded.settings).is_err() {
                initialization_error.get_or_insert_with(DiagnosticsError::persistence);
            }
        } else {
            initialization_error.get_or_insert_with(DiagnosticsError::persistence);
        }

        if let Ok(directory) = log_directory {
            if let Ok(mut stored_directory) = self.log_directory.lock() {
                *stored_directory = Some(directory);
            }
        } else {
            initialization_error.get_or_insert_with(DiagnosticsError::unavailable);
        }

        if let Ok(mut stored_error) = self.initialization_error.lock() {
            *stored_error = initialization_error;
        }
        self.apply_level();
    }

    fn effective_level(&self) -> LevelFilter {
        effective_level(
            self.debug_enabled.load(Ordering::Acquire),
            cfg!(debug_assertions),
            self.environment_level,
        )
    }

    fn apply_level(&self) {
        log::set_max_level(self.effective_level());
    }

    fn status(&self) -> DiagnosticsStatus {
        let log_directory = self
            .log_directory
            .lock()
            .ok()
            .and_then(|directory| directory.clone())
            .map(|directory| directory.to_string_lossy().into_owned());
        let error = self
            .initialization_error
            .lock()
            .ok()
            .and_then(|error| error.clone());
        DiagnosticsStatus {
            debug_enabled: self.debug_enabled.load(Ordering::Acquire),
            effective_level: level_name(self.effective_level()).into(),
            log_directory,
            error,
        }
    }

    fn set_debug_enabled(&self, enabled: bool) -> Result<DiagnosticsStatus, DiagnosticsError> {
        let path = self
            .settings_path
            .lock()
            .map_err(|_| DiagnosticsError::persistence())?
            .clone()
            .ok_or_else(DiagnosticsError::persistence)?;
        write_settings(
            &path,
            &PersistedDiagnostics {
                debug_enabled: enabled,
            },
        )?;
        self.debug_enabled.store(enabled, Ordering::Release);
        self.apply_level();
        log::info!(
            target: "muller::diagnostics",
            "event=diagnostics.level_changed debug_enabled={} effective_level={}",
            enabled,
            level_name(self.effective_level())
        );
        Ok(self.status())
    }
}

fn load_settings(path: &Path) -> LoadedDiagnostics {
    match fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str::<PersistedDiagnostics>(&contents) {
            Ok(settings) => LoadedDiagnostics {
                settings,
                rewrite: false,
                error: None,
            },
            Err(_) => LoadedDiagnostics {
                settings: PersistedDiagnostics::default(),
                rewrite: true,
                error: Some(DiagnosticsError::new(
                    "diagnostics_config_invalid",
                    "The diagnostic logging preference was reset",
                )),
            },
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => LoadedDiagnostics {
            settings: PersistedDiagnostics::default(),
            rewrite: true,
            error: None,
        },
        Err(_) => LoadedDiagnostics {
            settings: PersistedDiagnostics::default(),
            rewrite: false,
            error: Some(DiagnosticsError::persistence()),
        },
    }
}

fn write_settings(path: &Path, settings: &PersistedDiagnostics) -> Result<(), DiagnosticsError> {
    let contents =
        serde_json::to_vec_pretty(settings).map_err(|_| DiagnosticsError::persistence())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| DiagnosticsError::persistence())?;
    }
    fs::write(path, contents).map_err(|_| DiagnosticsError::persistence())
}

fn parse_environment_level(value: Option<&str>) -> Option<LevelFilter> {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("debug") => Some(LevelFilter::Debug),
        Some("trace") => Some(LevelFilter::Trace),
        _ => None,
    }
}

fn effective_level(
    debug_enabled: bool,
    debug_build: bool,
    environment_level: Option<LevelFilter>,
) -> LevelFilter {
    environment_level.unwrap_or(if debug_enabled || debug_build {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    })
}

fn level_name(level: LevelFilter) -> &'static str {
    match level {
        LevelFilter::Off => "off",
        LevelFilter::Error => "error",
        LevelFilter::Warn => "warn",
        LevelFilter::Info => "info",
        LevelFilter::Debug => "debug",
        LevelFilter::Trace => "trace",
    }
}

fn is_muller_log_target(target: &str) -> bool {
    target == "muller"
        || target.starts_with("muller::")
        || target == tauri_plugin_log::WEBVIEW_TARGET
        || target
            .strip_prefix(tauri_plugin_log::WEBVIEW_TARGET)
            .is_some_and(|suffix| suffix.starts_with(':'))
}

fn safe_log_target(target: &str) -> &str {
    if target == tauri_plugin_log::WEBVIEW_TARGET
        || target
            .strip_prefix(tauri_plugin_log::WEBVIEW_TARGET)
            .is_some_and(|suffix| suffix.starts_with(':'))
    {
        tauri_plugin_log::WEBVIEW_TARGET
    } else {
        target
    }
}

fn format_log_line(
    timestamp: impl std::fmt::Display,
    level: impl std::fmt::Display,
    target: &str,
    message: impl std::fmt::Display,
) -> String {
    format!("[{timestamp}][{level}][{target}] {message}")
}

fn log_builder(include_file: bool) -> LogBuilder {
    let mut targets = vec![
        Target::new(TargetKind::Stdout).filter(|metadata| is_muller_log_target(metadata.target())),
    ];
    if include_file {
        targets.push(
            Target::new(TargetKind::LogDir {
                file_name: Some(LOG_FILE_NAME.into()),
            })
            .filter(|metadata| is_muller_log_target(metadata.target())),
        );
    }
    LogBuilder::new()
        .level(LevelFilter::Trace)
        .filter(|metadata| is_muller_log_target(metadata.target()))
        .rotation_strategy(RotationStrategy::KeepSome(ARCHIVED_LOG_FILES))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .format(|out, message, record| {
            let line = format_log_line(
                TimezoneStrategy::UseLocal.get_now(),
                record.level(),
                safe_log_target(record.target()),
                message,
            );
            out.finish(format_args!("{line}"));
        })
        .max_file_size(LOG_FILE_SIZE_BYTES)
        .targets(targets)
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    LogBuilder::new().skip_logger().build()
}

pub fn initialize_logging(app: &AppHandle, state: &DiagnosticsState) {
    let (logger_error, logger, file_sink_active) = match log_builder(true).split(app) {
        Ok((_plugin, max_level, logger)) => (None, Some((max_level, logger)), true),
        Err(_) => match log_builder(false).split(app) {
            Ok((_plugin, max_level, logger)) => (
                Some(DiagnosticsError::new(
                    "diagnostics_file_unavailable",
                    "File logging is unavailable; diagnostic output uses the console",
                )),
                Some((max_level, logger)),
                false,
            ),
            Err(_) => (
                Some(DiagnosticsError::new(
                    "diagnostics_logger_unavailable",
                    "Diagnostic logging could not be initialized",
                )),
                None,
                false,
            ),
        },
    };

    let (logger_error, logger_attached) = if let Some((max_level, logger)) = logger {
        if tauri_plugin_log::attach_logger(max_level, logger).is_err() {
            (
                Some(DiagnosticsError::new(
                    "diagnostics_logger_conflict",
                    "Another diagnostic logger is already active",
                )),
                false,
            )
        } else {
            (logger_error, true)
        }
    } else {
        (logger_error, false)
    };

    state.initialize(app, logger_error);
    install_panic_hook();
    log::info!(
        target: "muller::diagnostics",
        "event=diagnostics.initialized effective_level={} file_sink={}",
        level_name(state.effective_level()),
        file_sink_active && logger_attached
    );
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let payload_kind = if panic_info.payload().downcast_ref::<&str>().is_some()
            || panic_info.payload().downcast_ref::<String>().is_some()
        {
            "text"
        } else {
            "unknown"
        };
        log::error!(
            target: "muller::diagnostics",
            "event=runtime.panic payload_kind={payload_kind}"
        );
        previous(panic_info);
    }));
}

#[tauri::command]
pub fn get_diagnostics_status(state: State<'_, DiagnosticsState>) -> DiagnosticsStatus {
    state.status()
}

#[tauri::command]
pub fn set_debug_logging(
    enabled: bool,
    state: State<'_, DiagnosticsState>,
) -> Result<DiagnosticsStatus, DiagnosticsError> {
    state.set_debug_enabled(enabled)
}

#[tauri::command]
pub fn get_diagnostics_log_directory(
    state: State<'_, DiagnosticsState>,
) -> Result<String, DiagnosticsError> {
    state
        .log_directory
        .lock()
        .map_err(|_| DiagnosticsError::unavailable())?
        .clone()
        .map(|directory| directory.to_string_lossy().into_owned())
        .ok_or_else(DiagnosticsError::unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_level_only_accepts_explicit_debug_or_trace() {
        assert_eq!(
            parse_environment_level(Some(" DEBUG ")),
            Some(LevelFilter::Debug)
        );
        assert_eq!(
            parse_environment_level(Some("trace")),
            Some(LevelFilter::Trace)
        );
        assert_eq!(parse_environment_level(Some("info")), None);
        assert_eq!(parse_environment_level(Some("private path")), None);
        assert_eq!(parse_environment_level(None), None);
    }

    #[test]
    fn effective_level_respects_defaults_setting_and_environment_override() {
        assert_eq!(effective_level(false, false, None), LevelFilter::Info);
        assert_eq!(effective_level(true, false, None), LevelFilter::Debug);
        assert_eq!(effective_level(false, true, None), LevelFilter::Debug);
        assert_eq!(
            effective_level(false, false, Some(LevelFilter::Trace)),
            LevelFilter::Trace
        );
    }

    #[test]
    fn log_targets_only_allow_muller_and_sanitized_frontend_events() {
        assert!(is_muller_log_target("muller"));
        assert!(is_muller_log_target("muller::search"));
        assert!(is_muller_log_target("webview"));
        assert!(is_muller_log_target(
            "webview:diagnosticInfo@http://tauri.localhost/app.js:1:2"
        ));
        assert!(!is_muller_log_target("muller_other"));
        assert!(!is_muller_log_target("tauri::runtime"));
        assert!(!is_muller_log_target("wry"));
        assert_eq!(
            safe_log_target("webview:diagnosticInfo@http://tauri.localhost/app.js:1:2"),
            "webview"
        );
        assert_eq!(
            safe_log_target("muller::diagnostics"),
            "muller::diagnostics"
        );
        assert_eq!(
            format_log_line(
                "2026-08-25 09:00:00",
                log::Level::Info,
                "muller::diagnostics",
                "event=diagnostics.initialized"
            ),
            "[2026-08-25 09:00:00][INFO][muller::diagnostics] event=diagnostics.initialized"
        );
    }

    #[test]
    fn persisted_settings_round_trip_and_reject_malformed_values() {
        let settings = PersistedDiagnostics {
            debug_enabled: true,
        };
        let serialized = serde_json::to_string(&settings).unwrap();
        assert!(
            serde_json::from_str::<PersistedDiagnostics>(&serialized)
                .unwrap()
                .debug_enabled
        );
        assert!(serde_json::from_str::<PersistedDiagnostics>("not-json").is_err());
    }

    #[test]
    fn settings_loader_distinguishes_missing_valid_invalid_and_unreadable_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SETTINGS_FILE);

        let missing = load_settings(&path);
        assert!(!missing.settings.debug_enabled);
        assert!(missing.rewrite);
        assert!(missing.error.is_none());

        fs::write(&path, r#"{"debugEnabled":true}"#).unwrap();
        let valid = load_settings(&path);
        assert!(valid.settings.debug_enabled);
        assert!(!valid.rewrite);
        assert!(valid.error.is_none());

        fs::write(&path, "not-json").unwrap();
        let invalid = load_settings(&path);
        assert!(!invalid.settings.debug_enabled);
        assert!(invalid.rewrite);
        assert_eq!(invalid.error.unwrap().code, "diagnostics_config_invalid");

        let unreadable = load_settings(directory.path());
        assert!(!unreadable.settings.debug_enabled);
        assert!(!unreadable.rewrite);
        assert_eq!(
            unreadable.error.unwrap().code,
            "diagnostics_persistence_failed"
        );
    }

    #[test]
    fn debug_preference_is_persisted_before_becoming_active() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SETTINGS_FILE);
        let state = DiagnosticsState::default();
        *state.settings_path.lock().unwrap() = Some(path.clone());

        let status = state.set_debug_enabled(true).unwrap();

        assert!(status.debug_enabled);
        assert!(state.debug_enabled.load(Ordering::Acquire));
        let persisted = fs::read_to_string(path).unwrap();
        assert!(
            serde_json::from_str::<PersistedDiagnostics>(&persisted)
                .unwrap()
                .debug_enabled
        );
    }

    #[test]
    fn failed_persistence_does_not_change_the_active_preference() {
        let state = DiagnosticsState::default();

        let error = state.set_debug_enabled(true).unwrap_err();

        assert_eq!(error.code, "diagnostics_persistence_failed");
        assert!(!state.debug_enabled.load(Ordering::Acquire));

        state.debug_enabled.store(true, Ordering::Release);
        let error = state.set_debug_enabled(false).unwrap_err();
        assert_eq!(error.code, "diagnostics_persistence_failed");
        assert!(state.debug_enabled.load(Ordering::Acquire));
    }
}
