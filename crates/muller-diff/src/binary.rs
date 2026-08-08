use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use muller_core::CancellationToken;

use crate::{BinaryDiffRange, DiffError};

pub const MAX_BINARY_RANGE_BYTES: usize = 64 * 1024;

pub fn read_binary_diff_range(
    left_path: &Path,
    right_path: &Path,
    offset: u64,
    length: usize,
    cancellation: &CancellationToken,
) -> Result<BinaryDiffRange, DiffError> {
    if cancellation.is_cancelled() {
        return Err(DiffError::Cancelled);
    }
    if length > MAX_BINARY_RANGE_BYTES {
        return Err(DiffError::BinaryRangeTooLarge {
            requested: length,
            maximum: MAX_BINARY_RANGE_BYTES,
        });
    }
    let left_size = file_size(left_path)?;
    let right_size = file_size(right_path)?;
    let left = read_range(left_path, offset, length)?;
    if cancellation.is_cancelled() {
        return Err(DiffError::Cancelled);
    }
    let right = read_range(right_path, offset, length)?;
    let different_indices = (0..left.len().max(right.len()))
        .filter(|index| left.get(*index) != right.get(*index))
        .collect();

    Ok(BinaryDiffRange {
        offset,
        left_size,
        right_size,
        left,
        right,
        different_indices,
    })
}

fn file_size(path: &Path) -> Result<u64, DiffError> {
    let metadata = fs::metadata(path).map_err(|source| DiffError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if !metadata.is_file() {
        return Err(DiffError::PathNotFile(path.to_path_buf()));
    }
    Ok(metadata.len())
}

fn read_range(path: &Path, offset: u64, length: usize) -> Result<Vec<u8>, DiffError> {
    let mut file = File::open(path).map_err(|source| DiffError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|source| DiffError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    let mut bytes = vec![0; length];
    let count = file.read(&mut bytes).map_err(|source| DiffError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    bytes.truncate(count);
    Ok(bytes)
}
