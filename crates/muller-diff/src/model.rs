use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone)]
pub struct FolderDiffConfig {
    pub left_root: PathBuf,
    pub right_root: PathBuf,
    pub treat_mtime_as_diff: bool,
}

impl FolderDiffConfig {
    #[must_use]
    pub fn new(left_root: impl Into<PathBuf>, right_root: impl Into<PathBuf>) -> Self {
        Self {
            left_root: left_root.into(),
            right_root: right_root.into(),
            treat_mtime_as_diff: false,
        }
    }

    #[must_use]
    pub fn with_mtime_as_diff(mut self, enabled: bool) -> Self {
        self.treat_mtime_as_diff = enabled;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderEntryKind {
    File,
    Directory,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderDiffStatus {
    LeftOnly,
    RightOnly,
    Different,
    Equal,
    MetadataOnly,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderSide {
    pub path: PathBuf,
    pub size: u64,
    pub modified_unix_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderDiffEntry {
    pub relative_path: PathBuf,
    pub kind: FolderEntryKind,
    pub left: Option<FolderSide>,
    pub right: Option<FolderSide>,
    pub status: FolderDiffStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderDiffIssue {
    pub path: PathBuf,
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct FolderDiffStats {
    pub total_entries: u64,
    pub equal: u64,
    pub metadata_only: u64,
    pub different: u64,
    pub left_only: u64,
    pub right_only: u64,
    pub errors: u64,
    pub hashed_files: u64,
    pub bytes_hashed: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderDiffReport {
    pub left_root: PathBuf,
    pub right_root: PathBuf,
    pub entries: Vec<FolderDiffEntry>,
    pub issues: Vec<FolderDiffIssue>,
    pub stats: FolderDiffStats,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderDiffPhase {
    Discovering,
    Comparing,
    Complete,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderDiffProgress {
    pub phase: FolderDiffPhase,
    pub processed: u64,
    pub total: Option<u64>,
    pub bytes_hashed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TextEncoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Gbk,
    Windows1252,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LineEnding {
    None,
    Lf,
    Crlf,
    Cr,
    Mixed,
}

#[derive(Debug, Clone)]
pub struct DecodedText {
    pub text: String,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
    pub byte_len: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileDiffKind {
    Text,
    Binary,
}

#[derive(Debug, Clone, Serialize)]
pub struct FilePairInspection {
    pub left_path: PathBuf,
    pub right_path: PathBuf,
    pub kind: FileDiffKind,
    pub left_size: u64,
    pub right_size: u64,
    pub left_encoding: Option<TextEncoding>,
    pub right_encoding: Option<TextEncoding>,
    pub left_line_ending: Option<LineEnding>,
    pub right_line_ending: Option<LineEnding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TextDiffTag {
    Equal,
    Insert,
    Delete,
    Replace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct HighlightRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TextDiffRow {
    pub tag: TextDiffTag,
    pub left_line_number: Option<u64>,
    pub right_line_number: Option<u64>,
    pub left_text: Option<String>,
    pub right_text: Option<String>,
    pub left_highlights: Vec<HighlightRange>,
    pub right_highlights: Vec<HighlightRange>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TextDiffReport {
    pub inspection: FilePairInspection,
    pub rows: Vec<TextDiffRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BinaryDiffRange {
    pub offset: u64,
    pub left_size: u64,
    pub right_size: u64,
    pub left: Vec<u8>,
    pub right: Vec<u8>,
    pub different_indices: Vec<usize>,
}
