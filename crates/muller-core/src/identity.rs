use std::{fs::Metadata, io, path::Path};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct FileIdentity {
    volume: u64,
    file: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct FileIdentityInfo {
    pub identity: FileIdentity,
    pub hard_link_count: u64,
}

#[cfg(windows)]
pub(crate) fn file_identity(path: &Path, _metadata: &Metadata) -> io::Result<FileIdentityInfo> {
    use std::{fs::File, mem::MaybeUninit, os::windows::io::AsRawHandle as _};

    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    let file = File::open(path)?;
    let mut information = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    // The handle remains valid for the call and Windows initializes the output
    // structure only when the function reports success.
    let succeeded = unsafe {
        GetFileInformationByHandle(file.as_raw_handle().cast(), information.as_mut_ptr())
    };
    if succeeded == 0 {
        return Err(io::Error::last_os_error());
    }
    let information = unsafe { information.assume_init() };
    let file_index =
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow);

    Ok(FileIdentityInfo {
        identity: FileIdentity {
            volume: u64::from(information.dwVolumeSerialNumber),
            file: file_index,
        },
        hard_link_count: u64::from(information.nNumberOfLinks),
    })
}

#[cfg(unix)]
pub(crate) fn file_identity(_path: &Path, metadata: &Metadata) -> io::Result<FileIdentityInfo> {
    use std::os::unix::fs::MetadataExt as _;

    Ok(FileIdentityInfo {
        identity: FileIdentity {
            volume: metadata.dev(),
            file: metadata.ino(),
        },
        hard_link_count: metadata.nlink(),
    })
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn file_identity(path: &Path, _metadata: &Metadata) -> io::Result<FileIdentityInfo> {
    use std::hash::{Hash as _, Hasher as _};

    let canonical = std::fs::canonicalize(path)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    canonical.hash(&mut hasher);
    Ok(FileIdentityInfo {
        identity: FileIdentity {
            volume: 0,
            file: hasher.finish(),
        },
        hard_link_count: 1,
    })
}
