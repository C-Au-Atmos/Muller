use std::{
    fs::{self, File},
    io::{Read as _, Take},
    path::Path,
};

use chardetng::EncodingDetector;
use encoding_rs::{GBK, UTF_16BE, UTF_16LE, WINDOWS_1252};
use muller_core::CancellationToken;
use similar::{Algorithm, ChangeTag, DiffTag, TextDiff};

use crate::{
    DecodedText, DiffError, FileDiffKind, FilePairInspection, HighlightRange, LineEnding,
    TextDiffReport, TextDiffRow, TextDiffTag, TextEncoding,
};

pub const MAX_TEXT_FILE_BYTES: u64 = 64 * 1024 * 1024;
const TEXT_SAMPLE_BYTES: usize = 64 * 1024;

/// Returns whether a path belongs to a developer-facing text format that is safe to
/// offer as an inline preview after its bytes pass [`decode_text_bytes`].
pub fn is_developer_text_path(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        file_name.as_str(),
        "makefile"
            | "gnumakefile"
            | "dockerfile"
            | "containerfile"
            | "jenkinsfile"
            | "procfile"
            | "rakefile"
            | "gemfile"
            | "podfile"
            | "brewfile"
            | "justfile"
            | "vagrantfile"
            | "cmakelists.txt"
            | ".env"
            | ".gitignore"
            | ".gitattributes"
            | ".gitmodules"
            | ".editorconfig"
            | ".dockerignore"
            | ".npmrc"
            | ".yarnrc"
            | ".prettierrc"
            | ".eslintrc"
            | ".babelrc"
    ) {
        return true;
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "txt"
            | "text"
            | "md"
            | "markdown"
            | "rst"
            | "adoc"
            | "log"
            | "csv"
            | "tsv"
            | "ini"
            | "cfg"
            | "conf"
            | "config"
            | "properties"
            | "env"
            | "toml"
            | "yaml"
            | "yml"
            | "json"
            | "jsonc"
            | "json5"
            | "xml"
            | "xsd"
            | "xsl"
            | "xslt"
            | "plist"
            | "html"
            | "htm"
            | "css"
            | "scss"
            | "sass"
            | "less"
            | "vue"
            | "svelte"
            | "astro"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "ts"
            | "tsx"
            | "mts"
            | "cts"
            | "c"
            | "h"
            | "cc"
            | "hh"
            | "cpp"
            | "cxx"
            | "hpp"
            | "hxx"
            | "inl"
            | "ipp"
            | "rs"
            | "go"
            | "zig"
            | "java"
            | "kt"
            | "kts"
            | "scala"
            | "groovy"
            | "gradle"
            | "swift"
            | "m"
            | "mm"
            | "cs"
            | "fs"
            | "fsx"
            | "vb"
            | "py"
            | "pyw"
            | "pyx"
            | "rb"
            | "php"
            | "lua"
            | "pl"
            | "pm"
            | "r"
            | "jl"
            | "dart"
            | "ex"
            | "exs"
            | "erl"
            | "hrl"
            | "clj"
            | "cljs"
            | "cljc"
            | "edn"
            | "hs"
            | "lhs"
            | "bat"
            | "cmd"
            | "ps1"
            | "psm1"
            | "psd1"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "sql"
            | "graphql"
            | "gql"
            | "proto"
            | "cmake"
            | "make"
            | "mk"
            | "ninja"
            | "bazel"
            | "bzl"
            | "build"
            | "workspace"
            | "tex"
            | "bib"
            | "diff"
            | "patch"
            | "lock"
            | "sln"
            | "csproj"
            | "vcxproj"
            | "fsproj"
            | "props"
            | "targets"
            | "manifest"
            | "blob"
    )
}

pub fn inspect_file_pair(
    left_path: &Path,
    right_path: &Path,
    cancellation: &CancellationToken,
) -> Result<FilePairInspection, DiffError> {
    ensure_file(left_path)?;
    ensure_file(right_path)?;
    let left_size = file_size(left_path)?;
    let right_size = file_size(right_path)?;
    let left_sample = read_sample(left_path)?;
    if cancellation.is_cancelled() {
        return Err(DiffError::Cancelled);
    }
    let right_sample = read_sample(right_path)?;
    let left_text = detect_text(&left_sample);
    let right_text = detect_text(&right_sample);
    let kind = if left_text.is_some() && right_text.is_some() {
        FileDiffKind::Text
    } else {
        FileDiffKind::Binary
    };

    Ok(FilePairInspection {
        left_path: left_path.to_path_buf(),
        right_path: right_path.to_path_buf(),
        kind,
        left_size,
        right_size,
        left_encoding: left_text.map(|(encoding, _)| encoding),
        right_encoding: right_text.map(|(encoding, _)| encoding),
        left_line_ending: left_text.map(|(_, line_ending)| line_ending),
        right_line_ending: right_text.map(|(_, line_ending)| line_ending),
    })
}

pub fn compare_text_files(
    left_path: &Path,
    right_path: &Path,
    cancellation: &CancellationToken,
) -> Result<TextDiffReport, DiffError> {
    let left = decode_text_file(left_path, cancellation)?;
    let right = decode_text_file(right_path, cancellation)?;
    let inspection = FilePairInspection {
        left_path: left_path.to_path_buf(),
        right_path: right_path.to_path_buf(),
        kind: FileDiffKind::Text,
        left_size: left.byte_len,
        right_size: right.byte_len,
        left_encoding: Some(left.encoding),
        right_encoding: Some(right.encoding),
        left_line_ending: Some(left.line_ending),
        right_line_ending: Some(right.line_ending),
    };
    let rows = build_diff_rows(&left.text, &right.text, cancellation)?;
    Ok(TextDiffReport { inspection, rows })
}

pub fn decode_text_file(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<DecodedText, DiffError> {
    let size = file_size(path)?;
    if size > MAX_TEXT_FILE_BYTES {
        return Err(DiffError::TextTooLarge {
            path: path.to_path_buf(),
            limit: MAX_TEXT_FILE_BYTES,
        });
    }
    let bytes = read_limited(path, MAX_TEXT_FILE_BYTES, cancellation)?;
    let (encoding, text) =
        decode_text_bytes(&bytes).ok_or_else(|| DiffError::NotText(path.into()))?;
    Ok(DecodedText {
        line_ending: detect_line_ending(&text),
        text,
        encoding,
        byte_len: size,
    })
}

fn build_diff_rows(
    left: &str,
    right: &str,
    cancellation: &CancellationToken,
) -> Result<Vec<TextDiffRow>, DiffError> {
    let normalized_left = normalize_line_endings(left);
    let normalized_right = normalize_line_endings(right);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&normalized_left, &normalized_right);
    let mut rows = Vec::new();
    let mut left_line = 1_u64;
    let mut right_line = 1_u64;

    for op in diff.ops() {
        if cancellation.is_cancelled() {
            return Err(DiffError::Cancelled);
        }
        match op.tag() {
            DiffTag::Equal => {
                for change in diff.iter_changes(op) {
                    let value = clean_line(change.value());
                    rows.push(TextDiffRow {
                        tag: TextDiffTag::Equal,
                        left_line_number: Some(left_line),
                        right_line_number: Some(right_line),
                        left_text: Some(value.clone()),
                        right_text: Some(value),
                        left_highlights: Vec::new(),
                        right_highlights: Vec::new(),
                    });
                    left_line += 1;
                    right_line += 1;
                }
            }
            DiffTag::Delete => {
                for change in diff.iter_changes(op) {
                    rows.push(delete_row(change.value(), left_line));
                    left_line += 1;
                }
            }
            DiffTag::Insert => {
                for change in diff.iter_changes(op) {
                    rows.push(insert_row(change.value(), right_line));
                    right_line += 1;
                }
            }
            DiffTag::Replace => {
                let mut deleted = Vec::new();
                let mut inserted = Vec::new();
                for change in diff.iter_changes(op) {
                    match change.tag() {
                        ChangeTag::Delete => deleted.push(clean_line(change.value())),
                        ChangeTag::Insert => inserted.push(clean_line(change.value())),
                        ChangeTag::Equal => {}
                    }
                }
                for index in 0..deleted.len().max(inserted.len()) {
                    let left_text = deleted.get(index).cloned();
                    let right_text = inserted.get(index).cloned();
                    match (left_text, right_text) {
                        (Some(left_text), Some(right_text)) => {
                            let (left_highlights, right_highlights) =
                                character_highlights(&left_text, &right_text);
                            rows.push(TextDiffRow {
                                tag: TextDiffTag::Replace,
                                left_line_number: Some(left_line),
                                right_line_number: Some(right_line),
                                left_text: Some(left_text),
                                right_text: Some(right_text),
                                left_highlights,
                                right_highlights,
                            });
                            left_line += 1;
                            right_line += 1;
                        }
                        (Some(left_text), None) => {
                            rows.push(delete_row(&left_text, left_line));
                            left_line += 1;
                        }
                        (None, Some(right_text)) => {
                            rows.push(insert_row(&right_text, right_line));
                            right_line += 1;
                        }
                        (None, None) => {}
                    }
                }
            }
        }
    }
    Ok(rows)
}

fn delete_row(value: &str, line: u64) -> TextDiffRow {
    TextDiffRow {
        tag: TextDiffTag::Delete,
        left_line_number: Some(line),
        right_line_number: None,
        left_text: Some(clean_line(value)),
        right_text: None,
        left_highlights: Vec::new(),
        right_highlights: Vec::new(),
    }
}

fn insert_row(value: &str, line: u64) -> TextDiffRow {
    TextDiffRow {
        tag: TextDiffTag::Insert,
        left_line_number: None,
        right_line_number: Some(line),
        left_text: None,
        right_text: Some(clean_line(value)),
        left_highlights: Vec::new(),
        right_highlights: Vec::new(),
    }
}

fn character_highlights(left: &str, right: &str) -> (Vec<HighlightRange>, Vec<HighlightRange>) {
    let diff = TextDiff::from_chars(left, right);
    let mut left_position = 0;
    let mut right_position = 0;
    let mut left_ranges = Vec::new();
    let mut right_ranges = Vec::new();
    for change in diff.iter_all_changes() {
        let length = change.value().chars().count();
        match change.tag() {
            ChangeTag::Equal => {
                left_position += length;
                right_position += length;
            }
            ChangeTag::Delete => {
                push_range(&mut left_ranges, left_position, left_position + length);
                left_position += length;
            }
            ChangeTag::Insert => {
                push_range(&mut right_ranges, right_position, right_position + length);
                right_position += length;
            }
        }
    }
    (left_ranges, right_ranges)
}

fn push_range(ranges: &mut Vec<HighlightRange>, start: usize, end: usize) {
    if let Some(last) = ranges.last_mut()
        && last.end == start
    {
        last.end = end;
        return;
    }
    ranges.push(HighlightRange { start, end });
}

fn read_limited(
    path: &Path,
    limit: u64,
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, DiffError> {
    let file = File::open(path).map_err(|source| DiffError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let mut reader: Take<File> = file.take(limit.saturating_add(1));
    let mut bytes = Vec::with_capacity(file_size(path)?.min(limit) as usize);
    let mut chunk = [0_u8; 256 * 1024];
    loop {
        if cancellation.is_cancelled() {
            return Err(DiffError::Cancelled);
        }
        let count = reader.read(&mut chunk).map_err(|source| DiffError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.len() as u64 > limit {
            return Err(DiffError::TextTooLarge {
                path: path.to_path_buf(),
                limit,
            });
        }
    }
    Ok(bytes)
}

fn read_sample(path: &Path) -> Result<Vec<u8>, DiffError> {
    let mut file = File::open(path).map_err(|source| DiffError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let mut sample = vec![0; TEXT_SAMPLE_BYTES];
    let count = file.read(&mut sample).map_err(|source| DiffError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    sample.truncate(count);
    Ok(sample)
}

pub fn decode_text_bytes(bytes: &[u8]) -> Option<(TextEncoding, String)> {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8(bytes[3..].to_vec())
            .ok()
            .map(|text| (TextEncoding::Utf8Bom, text));
    }
    if bytes.starts_with(&[0xff, 0xfe]) {
        let (text, _, had_errors) = UTF_16LE.decode(&bytes[2..]);
        return (!had_errors).then(|| (TextEncoding::Utf16Le, text.into_owned()));
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        let (text, _, had_errors) = UTF_16BE.decode(&bytes[2..]);
        return (!had_errors).then(|| (TextEncoding::Utf16Be, text.into_owned()));
    }
    if looks_binary(bytes) {
        return None;
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Some((TextEncoding::Utf8, text.to_owned()));
    }

    let mut detector = EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let (text, _, had_errors) = encoding.decode(bytes);
    if had_errors {
        return None;
    }
    if encoding == GBK {
        Some((TextEncoding::Gbk, text.into_owned()))
    } else if encoding == WINDOWS_1252 {
        Some((TextEncoding::Windows1252, text.into_owned()))
    } else {
        None
    }
}

fn detect_text(bytes: &[u8]) -> Option<(TextEncoding, LineEnding)> {
    decode_text_bytes(bytes).map(|(encoding, text)| (encoding, detect_line_ending(&text)))
}

fn looks_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    if bytes.contains(&0) {
        return true;
    }
    let controls = bytes
        .iter()
        .filter(|byte| **byte < 0x20 && !matches!(**byte, b'\t' | b'\n' | b'\r' | 0x0c))
        .count();
    controls.saturating_mul(20) > bytes.len()
}

fn detect_line_ending(text: &str) -> LineEnding {
    let bytes = text.as_bytes();
    let mut crlf = 0;
    let mut lf = 0;
    let mut cr = 0;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                crlf += 1;
                index += 2;
            }
            b'\r' => {
                cr += 1;
                index += 1;
            }
            b'\n' => {
                lf += 1;
                index += 1;
            }
            _ => index += 1,
        }
    }
    match (crlf > 0, lf > 0, cr > 0) {
        (false, false, false) => LineEnding::None,
        (true, false, false) => LineEnding::Crlf,
        (false, true, false) => LineEnding::Lf,
        (false, false, true) => LineEnding::Cr,
        _ => LineEnding::Mixed,
    }
}

fn clean_line(value: &str) -> String {
    value.trim_end_matches(['\r', '\n']).to_owned()
}

fn normalize_line_endings(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}

fn ensure_file(path: &Path) -> Result<(), DiffError> {
    if !path.exists() {
        return Err(DiffError::PathNotFound(path.to_path_buf()));
    }
    if !fs::metadata(path)
        .map_err(|source| DiffError::Io {
            path: path.to_path_buf(),
            source,
        })?
        .is_file()
    {
        return Err(DiffError::PathNotFile(path.to_path_buf()));
    }
    Ok(())
}

fn file_size(path: &Path) -> Result<u64, DiffError> {
    ensure_file(path)?;
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|source| DiffError::Io {
            path: path.to_path_buf(),
            source,
        })
}
