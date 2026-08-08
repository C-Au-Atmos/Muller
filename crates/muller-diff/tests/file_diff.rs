use std::fs;

use encoding_rs::GBK;
use muller_core::CancellationToken;
use muller_diff::{
    FileDiffKind, LineEnding, TextDiffTag, TextEncoding, compare_text_files, inspect_file_pair,
    is_developer_text_path, read_binary_diff_range,
};
use tempfile::tempdir;

#[test]
fn text_diff_detects_utf8_utf16_and_character_replacements() {
    let fixture = tempdir().expect("fixture");
    let left = fixture.path().join("left.txt");
    let right = fixture.path().join("right.txt");
    fs::write(&left, "alpha\r\nbeta\r\n").expect("left");
    let utf16 = "alpha\nbetter\n"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    fs::write(&right, [vec![0xff, 0xfe], utf16].concat()).expect("right");

    let report =
        compare_text_files(&left, &right, &CancellationToken::default()).expect("text diff");

    assert_eq!(report.inspection.left_encoding, Some(TextEncoding::Utf8));
    assert_eq!(
        report.inspection.right_encoding,
        Some(TextEncoding::Utf16Le)
    );
    assert_eq!(report.inspection.left_line_ending, Some(LineEnding::Crlf));
    assert_eq!(report.inspection.right_line_ending, Some(LineEnding::Lf));
    let replacement = report
        .rows
        .iter()
        .find(|row| row.tag == TextDiffTag::Replace)
        .expect("replacement");
    assert!(!replacement.left_highlights.is_empty());
    assert!(!replacement.right_highlights.is_empty());
}

#[test]
fn gbk_text_is_routed_to_text_diff() {
    let fixture = tempdir().expect("fixture");
    let left = fixture.path().join("left-gbk.txt");
    let right = fixture.path().join("right-gbk.txt");
    let (left_bytes, _, _) = GBK.encode("你好，世界\r\n");
    let (right_bytes, _, _) = GBK.encode("你好，Muller\r\n");
    fs::write(&left, left_bytes.as_ref()).expect("left GBK");
    fs::write(&right, right_bytes.as_ref()).expect("right GBK");

    let inspection =
        inspect_file_pair(&left, &right, &CancellationToken::default()).expect("inspect");
    assert_eq!(inspection.kind, FileDiffKind::Text);
    assert_eq!(inspection.left_encoding, Some(TextEncoding::Gbk));
    assert_eq!(inspection.right_encoding, Some(TextEncoding::Gbk));
}

#[test]
fn binary_ranges_are_bounded_and_mark_different_bytes() {
    let fixture = tempdir().expect("fixture");
    let left = fixture.path().join("left.bin");
    let right = fixture.path().join("right.bin");
    fs::write(&left, [0, 1, 2, 3, 4, 5]).expect("left");
    fs::write(&right, [0, 1, 9, 3]).expect("right");

    let inspection =
        inspect_file_pair(&left, &right, &CancellationToken::default()).expect("inspect");
    assert_eq!(inspection.kind, FileDiffKind::Binary);
    let range =
        read_binary_diff_range(&left, &right, 0, 16, &CancellationToken::default()).expect("range");
    assert_eq!(range.different_indices, vec![2, 4, 5]);
}

#[test]
fn developer_formats_are_recognized_and_compared_as_text() {
    let fixture = tempdir().expect("fixture");
    for extension in ["ini", "bat", "c", "rs", "toml", "ts"] {
        let left = fixture.path().join(format!("left.{extension}"));
        let right = fixture.path().join(format!("right.{extension}"));
        fs::write(&left, "name = left\n").expect("left developer file");
        fs::write(&right, "name = right\n").expect("right developer file");
        assert!(is_developer_text_path(&left));
        let inspection = inspect_file_pair(&left, &right, &CancellationToken::default())
            .expect("inspect developer files");
        assert_eq!(
            inspection.kind,
            FileDiffKind::Text,
            "extension: {extension}"
        );
    }
    assert!(is_developer_text_path(&fixture.path().join("Makefile")));
    assert!(is_developer_text_path(&fixture.path().join(".env")));
}

#[test]
fn blob_comparison_uses_content_to_choose_text_or_binary() {
    let fixture = tempdir().expect("fixture");
    let text_left = fixture.path().join("left.blob");
    let text_right = fixture.path().join("right.blob");
    fs::write(&text_left, "const value = 1;\n").expect("text blob left");
    fs::write(&text_right, "const value = 2;\n").expect("text blob right");
    assert_eq!(
        inspect_file_pair(&text_left, &text_right, &CancellationToken::default())
            .expect("inspect text blobs")
            .kind,
        FileDiffKind::Text
    );

    let binary_left = fixture.path().join("binary-left.blob");
    let binary_right = fixture.path().join("binary-right.blob");
    fs::write(&binary_left, [0, 1, 2, 3]).expect("binary blob left");
    fs::write(&binary_right, [0, 1, 9, 3]).expect("binary blob right");
    assert_eq!(
        inspect_file_pair(&binary_left, &binary_right, &CancellationToken::default())
            .expect("inspect binary blobs")
            .kind,
        FileDiffKind::Binary
    );
}

#[test]
fn bom_variants_and_large_text_remain_backend_diff_data() {
    let fixture = tempdir().expect("fixture");
    let utf8 = fixture.path().join("utf8-bom.txt");
    let utf16be = fixture.path().join("utf16be.txt");
    fs::write(
        &utf8,
        [vec![0xef, 0xbb, 0xbf], b"hello\n".to_vec()].concat(),
    )
    .expect("UTF-8 BOM");
    let utf16_bytes = "hello\n"
        .encode_utf16()
        .flat_map(u16::to_be_bytes)
        .collect::<Vec<_>>();
    fs::write(&utf16be, [vec![0xfe, 0xff], utf16_bytes].concat()).expect("UTF-16BE");
    let inspection = inspect_file_pair(&utf8, &utf16be, &CancellationToken::default())
        .expect("inspect BOM pair");
    assert_eq!(inspection.left_encoding, Some(TextEncoding::Utf8Bom));
    assert_eq!(inspection.right_encoding, Some(TextEncoding::Utf16Be));

    let left = fixture.path().join("large-left.txt");
    let right = fixture.path().join("large-right.txt");
    let left_text = (0..20_000)
        .map(|line| format!("line {line}\n"))
        .collect::<String>();
    let mut right_text = left_text.clone();
    right_text = right_text.replacen("line 10000\n", "line changed\n", 1);
    fs::write(&left, left_text).expect("large left");
    fs::write(&right, right_text).expect("large right");

    let report =
        compare_text_files(&left, &right, &CancellationToken::default()).expect("large text diff");
    assert_eq!(report.rows.len(), 20_000);
    assert_eq!(
        report
            .rows
            .iter()
            .filter(|row| row.tag != TextDiffTag::Equal)
            .count(),
        1
    );
}
