use std::path::{Path, PathBuf};

use encoding_rs::{GBK, WINDOWS_1252};
use muller_core::CancellationToken;
use muller_diff::{LineEnding, TextEncoding, decode_text_file};
use serde::Serialize;

use crate::{FileFingerprint, MutationError, MutationPolicy, fingerprint_file};

pub const MAX_EDITABLE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditableDocumentInfo {
    pub path: PathBuf,
    pub text: String,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
    pub byte_len: u64,
    pub fingerprint: FileFingerprint,
}

#[derive(Debug, Clone)]
pub struct EditableDocument {
    pub(crate) path: PathBuf,
    pub(crate) text: String,
    pub(crate) encoding: TextEncoding,
    pub(crate) line_ending: LineEnding,
    pub(crate) separators: Vec<LineSeparator>,
    pub(crate) fingerprint: FileFingerprint,
    pub(crate) backup: Option<BackupState>,
}

#[derive(Debug, Clone)]
pub(crate) struct BackupState {
    pub(crate) path: PathBuf,
    pub(crate) fingerprint: FileFingerprint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LineSeparator {
    Lf,
    Crlf,
    Cr,
}

impl EditableDocument {
    #[must_use]
    pub fn info(&self) -> EditableDocumentInfo {
        EditableDocumentInfo {
            path: self.path.clone(),
            text: self.text.clone(),
            encoding: self.encoding,
            line_ending: self.line_ending,
            byte_len: self.fingerprint.size,
            fingerprint: self.fingerprint.clone(),
        }
    }
}

pub fn open_document(
    path: &Path,
    policy: &MutationPolicy,
    cancellation: &CancellationToken,
) -> Result<EditableDocument, MutationError> {
    let path = policy.validate_file(path)?;
    let metadata = std::fs::metadata(&path).map_err(|source| MutationError::Io {
        path: path.clone(),
        source,
    })?;
    if metadata.len() > MAX_EDITABLE_BYTES {
        return Err(MutationError::EditableFileTooLarge {
            path,
            limit: MAX_EDITABLE_BYTES,
        });
    }

    let before = fingerprint_file(&path, cancellation)?;
    let decoded = decode_text_file(&path, cancellation)?;
    let after = fingerprint_file(&path, cancellation)?;
    if before != after || decoded.byte_len != after.size {
        return Err(MutationError::ExternalChange(path));
    }
    let (text, separators) = normalize_and_capture(&decoded.text);

    Ok(EditableDocument {
        path,
        text,
        encoding: decoded.encoding,
        line_ending: decoded.line_ending,
        separators,
        fingerprint: after,
        backup: None,
    })
}

pub(crate) fn normalize_and_capture(value: &str) -> (String, Vec<LineSeparator>) {
    let mut normalized = String::with_capacity(value.len());
    let mut separators = Vec::new();
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\r' if characters.peek() == Some(&'\n') => {
                characters.next();
                normalized.push('\n');
                separators.push(LineSeparator::Crlf);
            }
            '\r' => {
                normalized.push('\n');
                separators.push(LineSeparator::Cr);
            }
            '\n' => {
                normalized.push('\n');
                separators.push(LineSeparator::Lf);
            }
            _ => normalized.push(character),
        }
    }
    (normalized, separators)
}

pub(crate) fn restore_line_endings(
    editor_text: &str,
    original: &[LineSeparator],
) -> (String, Vec<LineSeparator>, LineEnding) {
    let (normalized, _) = normalize_and_capture(editor_text);
    let fallback = preferred_separator(original);
    let mut restored = String::with_capacity(normalized.len() + original.len());
    let mut used = Vec::with_capacity(normalized.bytes().filter(|byte| *byte == b'\n').count());
    let mut separator_index = 0_usize;
    for character in normalized.chars() {
        if character == '\n' {
            let separator = original.get(separator_index).copied().unwrap_or(fallback);
            restored.push_str(separator.as_str());
            used.push(separator);
            separator_index += 1;
        } else {
            restored.push(character);
        }
    }
    let line_ending = classify_line_endings(&used);
    (restored, used, line_ending)
}

pub(crate) fn encode_text(text: &str, encoding: TextEncoding) -> Result<Vec<u8>, MutationError> {
    match encoding {
        TextEncoding::Utf8 => Ok(text.as_bytes().to_vec()),
        TextEncoding::Utf8Bom => {
            let mut bytes = Vec::with_capacity(text.len().saturating_add(3));
            bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        TextEncoding::Utf16Le => Ok(encode_utf16(text, true)),
        TextEncoding::Utf16Be => Ok(encode_utf16(text, false)),
        TextEncoding::Gbk => encode_without_bom(text, GBK, "GBK"),
        TextEncoding::Windows1252 => encode_without_bom(text, WINDOWS_1252, "Windows-1252"),
    }
}

fn encode_utf16(text: &str, little_endian: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len().saturating_mul(2).saturating_add(2));
    bytes.extend_from_slice(if little_endian {
        &[0xff, 0xfe]
    } else {
        &[0xfe, 0xff]
    });
    for unit in text.encode_utf16() {
        let encoded = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        bytes.extend_from_slice(&encoded);
    }
    bytes
}

fn encode_without_bom(
    text: &str,
    encoding: &'static encoding_rs::Encoding,
    name: &str,
) -> Result<Vec<u8>, MutationError> {
    let (bytes, _, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(MutationError::EncodingLoss {
            encoding: name.to_owned(),
        });
    }
    Ok(bytes.into_owned())
}

fn preferred_separator(separators: &[LineSeparator]) -> LineSeparator {
    let counts = separators
        .iter()
        .fold([0_usize; 3], |mut counts, separator| {
            counts[separator.index()] += 1;
            counts
        });
    let index = counts
        .iter()
        .enumerate()
        .max_by_key(|(index, count)| (**count, std::cmp::Reverse(*index)))
        .map_or(0, |(index, _)| index);
    [LineSeparator::Lf, LineSeparator::Crlf, LineSeparator::Cr][index]
}

fn classify_line_endings(separators: &[LineSeparator]) -> LineEnding {
    let first = separators.first();
    if separators.is_empty() {
        LineEnding::None
    } else if separators.iter().all(|separator| Some(separator) == first) {
        match first.expect("non-empty separator list") {
            LineSeparator::Lf => LineEnding::Lf,
            LineSeparator::Crlf => LineEnding::Crlf,
            LineSeparator::Cr => LineEnding::Cr,
        }
    } else {
        LineEnding::Mixed
    }
}

impl LineSeparator {
    fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "\n",
            Self::Crlf => "\r\n",
            Self::Cr => "\r",
        }
    }

    fn index(self) -> usize {
        match self {
            Self::Lf => 0,
            Self::Crlf => 1,
            Self::Cr => 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use muller_diff::{LineEnding, TextEncoding};

    use super::{LineSeparator, encode_text, normalize_and_capture, restore_line_endings};

    #[test]
    fn preserves_a_mixed_separator_sequence() {
        let (text, separators) = normalize_and_capture("one\r\ntwo\nthree\rfour");
        assert_eq!(text, "one\ntwo\nthree\nfour");
        let (restored, used, ending) = restore_line_endings(&text, &separators);
        assert_eq!(restored, "one\r\ntwo\nthree\rfour");
        assert_eq!(used, separators);
        assert_eq!(ending, LineEnding::Mixed);
    }

    #[test]
    fn added_lines_use_the_predominant_separator() {
        let original = [LineSeparator::Crlf, LineSeparator::Crlf, LineSeparator::Lf];
        let (restored, _, _) = restore_line_endings("a\nb\nc\nd\n", &original);
        assert_eq!(restored, "a\r\nb\r\nc\nd\r\n");
    }

    #[test]
    fn rejects_unrepresentable_windows_1252_text() {
        let error = encode_text("not representable: \u{4e2d}", TextEncoding::Windows1252)
            .expect_err("encoding should be rejected");
        assert!(error.to_string().contains("Windows-1252"));
    }
}
