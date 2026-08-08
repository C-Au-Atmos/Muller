use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const MAX_COMPLETIONS: usize = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellLocation {
    id: &'static str,
    label: &'static str,
    path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalDrive {
    path: PathBuf,
    label: String,
    file_system: Option<String>,
    drive_type: String,
    total_bytes: Option<u64>,
    free_bytes: Option<u64>,
}

#[tauri::command]
pub fn get_shell_locations(app: AppHandle) -> Vec<ShellLocation> {
    let resolver = app.path();
    [
        ("profile", "Profile", resolver.home_dir()),
        ("desktop", "Desktop", resolver.desktop_dir()),
        ("documents", "Documents", resolver.document_dir()),
        ("downloads", "Downloads", resolver.download_dir()),
        ("pictures", "Pictures", resolver.picture_dir()),
        ("music", "Music", resolver.audio_dir()),
        ("videos", "Videos", resolver.video_dir()),
    ]
    .into_iter()
    .filter_map(|(id, label, result)| {
        result.ok().map(|path| ShellLocation {
            id,
            label,
            path: user_path(&path),
        })
    })
    .collect()
}

#[tauri::command]
pub fn complete_directory_path(input: String) -> Result<Vec<PathBuf>, String> {
    complete_path(&input)
}

fn complete_path(input: &str) -> Result<Vec<PathBuf>, String> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(Vec::new());
    }
    #[cfg(windows)]
    if let Some((server, prefix)) = unc_share_completion(input) {
        let prefix = prefix.to_lowercase();
        let mut matches = list_unc_shares(&server)?
            .into_iter()
            .filter(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().to_lowercase().starts_with(&prefix))
            })
            .collect::<Vec<_>>();
        matches.sort_by(|left, right| {
            left.to_string_lossy()
                .to_lowercase()
                .cmp(&right.to_string_lossy().to_lowercase())
        });
        matches.truncate(MAX_COMPLETIONS);
        return Ok(matches);
    }
    let requested = Path::new(input);
    let ends_with_separator = input.ends_with(['\\', '/']);
    let (parent, prefix) = if ends_with_separator {
        (requested, "")
    } else {
        (
            requested.parent().unwrap_or_else(|| Path::new(".")),
            requested
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(""),
        )
    };
    let prefix = prefix.to_lowercase();
    let mut matches = fs::read_dir(parent)
        .map_err(|error| format!("cannot complete {}: {error}", parent.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                return None;
            }
            let name = entry.file_name();
            if !name.to_string_lossy().to_lowercase().starts_with(&prefix) {
                return None;
            }
            Some(user_path(&entry.path()))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        left.to_string_lossy()
            .to_lowercase()
            .cmp(&right.to_string_lossy().to_lowercase())
    });
    matches.truncate(MAX_COMPLETIONS);
    Ok(matches)
}

#[cfg(windows)]
fn unc_share_completion(input: &str) -> Option<(String, String)> {
    let normalized = input.replace('/', "\\");
    let remainder = normalized.strip_prefix(r"\\")?;
    let parts = remainder.split('\\').collect::<Vec<_>>();
    let server = parts.first()?.trim();
    if server.is_empty() || parts.len() != 2 {
        return None;
    }
    Some((server.to_owned(), parts[1].to_owned()))
}

#[cfg(windows)]
pub(crate) fn list_unc_shares(server: &str) -> Result<Vec<PathBuf>, String> {
    use std::{os::windows::ffi::OsStrExt as _, ptr};
    use windows_sys::Win32::{
        Foundation::ERROR_MORE_DATA,
        NetworkManagement::NetManagement::{MAX_PREFERRED_LENGTH, NERR_Success, NetApiBufferFree},
        Storage::FileSystem::{NetShareEnum, SHARE_INFO_1, STYPE_DISKTREE},
    };

    let server_name = format!(r"\\{}", server.trim_matches(['\\', '/']));
    let wide = Path::new(&server_name)
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut resume = 0_u32;
    let mut shares = Vec::new();
    loop {
        let mut buffer = ptr::null_mut::<u8>();
        let mut entries_read = 0_u32;
        let mut total_entries = 0_u32;
        let status = unsafe {
            NetShareEnum(
                wide.as_ptr(),
                1,
                &mut buffer,
                MAX_PREFERRED_LENGTH,
                &mut entries_read,
                &mut total_entries,
                &mut resume,
            )
        };
        if !buffer.is_null() {
            let entries = unsafe {
                std::slice::from_raw_parts(buffer.cast::<SHARE_INFO_1>(), entries_read as usize)
            };
            for entry in entries {
                if entry.shi1_type & 0xffff != STYPE_DISKTREE {
                    continue;
                }
                let name = wide_ptr_to_string(entry.shi1_netname);
                if name.is_empty() || name.ends_with('$') {
                    continue;
                }
                shares.push(PathBuf::from(format!(r"\\{server}\{name}")));
            }
            unsafe { NetApiBufferFree(buffer.cast()) };
        }
        if status == NERR_Success {
            break;
        }
        if status != ERROR_MORE_DATA {
            return Err(format!(
                "cannot enumerate shares on {server_name}: Windows error {status}"
            ));
        }
    }
    shares.sort_by(|left, right| {
        left.to_string_lossy()
            .to_lowercase()
            .cmp(&right.to_string_lossy().to_lowercase())
    });
    Ok(shares)
}

#[cfg(windows)]
fn wide_ptr_to_string(pointer: *const u16) -> String {
    if pointer.is_null() {
        return String::new();
    }
    let mut length = 0_usize;
    unsafe {
        while *pointer.add(length) != 0 {
            length += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length))
    }
}

#[tauri::command]
pub fn list_logical_drives() -> Result<Vec<LogicalDrive>, String> {
    platform_drives()
}

// Compatibility for pre-7.9 frontends that shipped the command name with an extra `r`.
#[tauri::command]
pub fn list_logical_drivers() -> Result<Vec<LogicalDrive>, String> {
    list_logical_drives()
}

#[cfg(windows)]
fn platform_drives() -> Result<Vec<LogicalDrive>, String> {
    use std::{os::windows::ffi::OsStrExt as _, ptr};
    use windows_sys::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };

    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let mut drives = Vec::new();
    for index in 0..26_u32 {
        if mask & (1 << index) == 0 {
            continue;
        }
        let root = format!(
            "{}:\\",
            char::from_u32(u32::from(b'A') + index).unwrap_or('A')
        );
        let wide = Path::new(&root)
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let drive_type_code = unsafe { GetDriveTypeW(wide.as_ptr()) };
        let mut volume_name = [0_u16; 261];
        let mut file_system = [0_u16; 64];
        let has_volume = unsafe {
            GetVolumeInformationW(
                wide.as_ptr(),
                volume_name.as_mut_ptr(),
                volume_name.len() as u32,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                file_system.as_mut_ptr(),
                file_system.len() as u32,
            ) != 0
        };
        let mut available = 0_u64;
        let mut total = 0_u64;
        let has_space = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, ptr::null_mut()) != 0
        };
        let label = if has_volume {
            wide_string(&volume_name)
        } else {
            String::new()
        };
        drives.push(LogicalDrive {
            path: PathBuf::from(&root),
            label,
            file_system: has_volume
                .then(|| wide_string(&file_system))
                .filter(|value| !value.is_empty()),
            drive_type: drive_type_label(drive_type_code).to_owned(),
            total_bytes: has_space.then_some(total),
            free_bytes: has_space.then_some(available),
        });
    }
    Ok(drives)
}

#[cfg(windows)]
fn wide_string(buffer: &[u16]) -> String {
    let end = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

#[cfg(windows)]
fn drive_type_label(value: u32) -> &'static str {
    match value {
        2 => "removable",
        3 => "fixed",
        4 => "network",
        5 => "optical",
        6 => "ramdisk",
        _ => "unknown",
    }
}

#[cfg(not(windows))]
fn platform_drives() -> Result<Vec<LogicalDrive>, String> {
    Ok(vec![LogicalDrive {
        path: PathBuf::from("/"),
        label: "Root".into(),
        file_system: None,
        drive_type: "fixed".into(),
        total_bytes: None,
        free_bytes: None,
    }])
}

#[cfg(windows)]
fn user_path(path: &Path) -> PathBuf {
    let value = path.as_os_str().to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    if let Some(local) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(local);
    }
    if let Some(local) = value.strip_prefix(r"\??\") {
        return PathBuf::from(local);
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn user_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    #[test]
    fn completion_only_returns_matching_directories() {
        let fixture = tempdir().expect("fixture");
        fs::create_dir(fixture.path().join("Alpha")).expect("directory");
        fs::create_dir(fixture.path().join("alpine")).expect("directory");
        fs::write(fixture.path().join("also.txt"), "file").expect("file");
        let input = fixture.path().join("al").to_string_lossy().into_owned();
        let matches = super::complete_path(&input).expect("completion");
        assert_eq!(matches.len(), 2);
        assert!(matches.iter().all(|path| path.is_dir()));
    }

    #[cfg(windows)]
    #[test]
    fn unc_completion_identifies_server_and_share_prefix() {
        assert_eq!(super::unc_share_completion(r"\\10.1.10.8"), None);
        assert_eq!(
            super::unc_share_completion(r"\\10.1.10.8\pub"),
            Some(("10.1.10.8".into(), "pub".into()))
        );
        assert_eq!(
            super::unc_share_completion(r"\\server\"),
            Some(("server".into(), String::new()))
        );
        assert_eq!(super::unc_share_completion(r"\\server\share\folder"), None);
    }
}
