use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

use xxhash_rust::xxh3::Xxh3;

use crate::CancellationToken;

pub const HEAD_TAIL_BYTES: usize = 64 * 1024;
pub const FULL_HASH_BUFFER_BYTES: usize = 256 * 1024;

pub(crate) fn head_tail_fingerprint(path: &Path, size: u64) -> io::Result<(u64, u64)> {
    let mut file = File::open(path)?;
    let mut hasher = Xxh3::new();
    hasher.update(&size.to_le_bytes());

    if size <= (HEAD_TAIL_BYTES * 2) as u64 {
        let mut contents = Vec::with_capacity(size as usize);
        file.read_to_end(&mut contents)?;
        if contents.len() as u64 != size {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "file size changed while reading the head/tail fingerprint",
            ));
        }
        hasher.update(&contents);
        return Ok((hasher.digest(), contents.len() as u64));
    }

    let mut buffer = vec![0_u8; HEAD_TAIL_BYTES];
    file.read_exact(&mut buffer)?;
    hasher.update(&[0x48]);
    hasher.update(&buffer);
    file.seek(SeekFrom::End(-(HEAD_TAIL_BYTES as i64)))?;
    file.read_exact(&mut buffer)?;
    hasher.update(&[0x54]);
    hasher.update(&buffer);

    Ok((hasher.digest(), (HEAD_TAIL_BYTES * 2) as u64))
}

#[derive(Debug)]
pub enum FileHashError {
    Io(io::Error),
    Cancelled,
}

impl std::fmt::Display for FileHashError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => error.fmt(formatter),
            Self::Cancelled => formatter.write_str("file hashing cancelled"),
        }
    }
}

impl std::error::Error for FileHashError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Cancelled => None,
        }
    }
}

pub fn hash_file_blake3(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<([u8; 32], u64), FileHashError> {
    let mut file = File::open(path).map_err(FileHashError::Io)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0_u8; FULL_HASH_BUFFER_BYTES];
    let mut bytes_read = 0_u64;

    loop {
        if cancellation.is_cancelled() {
            return Err(FileHashError::Cancelled);
        }
        let count = file.read(&mut buffer).map_err(FileHashError::Io)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        bytes_read = bytes_read.saturating_add(count as u64);
    }

    Ok((*hasher.finalize().as_bytes(), bytes_read))
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write as _};

    use tempfile::tempdir;

    use crate::CancellationToken;

    use super::{FULL_HASH_BUFFER_BYTES, HEAD_TAIL_BYTES, hash_file_blake3, head_tail_fingerprint};

    #[test]
    fn fingerprints_boundary_sizes_without_unbounded_buffers() {
        let directory = tempdir().expect("temporary directory");
        let sizes = [
            0,
            1,
            HEAD_TAIL_BYTES - 1,
            HEAD_TAIL_BYTES,
            HEAD_TAIL_BYTES * 2,
            HEAD_TAIL_BYTES * 2 + 1,
        ];

        for size in sizes {
            let path = directory.path().join(format!("boundary-{size}.bin"));
            let mut file = fs::File::create(&path).expect("create fixture");
            file.write_all(&vec![0x5a; size]).expect("write fixture");
            drop(file);

            let (_, partial_bytes) =
                head_tail_fingerprint(&path, size as u64).expect("head/tail hash");
            let (_, full_bytes) =
                hash_file_blake3(&path, &CancellationToken::default()).expect("full hash");
            assert_eq!(partial_bytes, size.min(HEAD_TAIL_BYTES * 2) as u64);
            assert_eq!(full_bytes, size as u64);
        }

        assert_eq!(FULL_HASH_BUFFER_BYTES, 256 * 1024);
    }
}
