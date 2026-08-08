use std::{fs, path::Path, time::UNIX_EPOCH};

use muller_core::{CancellationToken, FileHashError, hash_file_blake3};
use serde::{Serialize, Serializer};

use crate::MutationError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileFingerprint {
    pub size: u64,
    pub modified_unix_ms: Option<u64>,
    #[serde(serialize_with = "serialize_hash")]
    pub blake3: [u8; 32],
}

impl FileFingerprint {
    #[must_use]
    pub fn hash_hex(&self) -> String {
        hex_bytes(&self.blake3)
    }
}

pub fn fingerprint_file(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<FileFingerprint, MutationError> {
    let metadata_before = fs::metadata(path).map_err(|source| MutationError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let (blake3, bytes_read) =
        hash_file_blake3(path, cancellation).map_err(|error| match error {
            FileHashError::Cancelled => MutationError::Cancelled,
            FileHashError::Io(source) => MutationError::Io {
                path: path.to_path_buf(),
                source,
            },
        })?;
    let metadata_after = fs::metadata(path).map_err(|source| MutationError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let modified_unix_ms = |metadata: &fs::Metadata| {
        metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| u64::try_from(duration.as_millis()).ok())
    };
    if bytes_read != metadata_before.len()
        || metadata_before.len() != metadata_after.len()
        || modified_unix_ms(&metadata_before) != modified_unix_ms(&metadata_after)
    {
        return Err(MutationError::ExternalChange(path.to_path_buf()));
    }
    Ok(FileFingerprint {
        size: metadata_after.len(),
        modified_unix_ms: modified_unix_ms(&metadata_after),
        blake3,
    })
}

pub fn parse_hash_hex(value: &str) -> Result<[u8; 32], MutationError> {
    if value.len() != 64 {
        return Err(MutationError::InvalidFingerprint(value.to_owned()));
    }
    let mut bytes = [0_u8; 32];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        let encoded = std::str::from_utf8(chunk)
            .map_err(|_| MutationError::InvalidFingerprint(value.to_owned()))?;
        bytes[index] = u8::from_str_radix(encoded, 16)
            .map_err(|_| MutationError::InvalidFingerprint(value.to_owned()))?;
    }
    Ok(bytes)
}

fn serialize_hash<S>(hash: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&hex_bytes(hash))
}

fn hex_bytes(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}
