use std::{fs, path::Path};

use encoding_rs::{GBK, WINDOWS_1252};
use muller_core::CancellationToken;
use muller_mutate::{MutationPolicy, open_document, rollback_document, save_document};
use tempfile::tempdir;

fn cancellation() -> CancellationToken {
    CancellationToken::default()
}

fn write_encoded(path: &Path, bom: &[u8], encoding: &'static encoding_rs::Encoding, text: &str) {
    let (encoded, _, had_errors) = encoding.encode(text);
    assert!(!had_errors);
    let mut bytes = bom.to_vec();
    bytes.extend_from_slice(&encoded);
    fs::write(path, bytes).expect("write encoded fixture");
}

fn write_utf16(path: &Path, little_endian: bool, text: &str) {
    let mut bytes = if little_endian {
        vec![0xff, 0xfe]
    } else {
        vec![0xfe, 0xff]
    };
    for unit in text.encode_utf16() {
        let encoded = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        bytes.extend_from_slice(&encoded);
    }
    fs::write(path, bytes).expect("write UTF-16 fixture");
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units = bytes
        .chunks_exact(2)
        .map(|pair| {
            let pair = [pair[0], pair[1]];
            if little_endian {
                u16::from_le_bytes(pair)
            } else {
                u16::from_be_bytes(pair)
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16(&units).expect("decode UTF-16 output")
}

#[test]
fn rejects_a_configured_protected_path() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("protected.txt");
    fs::write(&path, "protected").expect("write fixture");
    let policy = MutationPolicy::default().with_protected_path(directory.path());

    let error = open_document(&path, &policy, &cancellation()).expect_err("path is protected");

    assert!(error.to_string().contains("is protected by"));
}

#[cfg(windows)]
#[test]
fn rejects_a_symbolic_link() {
    use std::os::windows::fs::symlink_file;

    let directory = tempdir().expect("temporary directory");
    let target = directory.path().join("target.txt");
    let link = directory.path().join("link.txt");
    fs::write(&target, "target").expect("write fixture");
    if let Err(error) = symlink_file(&target, &link) {
        if error.kind() == std::io::ErrorKind::PermissionDenied
            || error.raw_os_error() == Some(1314)
        {
            return;
        }
        panic!("create symlink fixture: {error}");
    }

    let error = open_document(&link, &MutationPolicy::default(), &cancellation())
        .expect_err("symlink should be rejected");
    assert!(error.to_string().contains("aliases cannot be mutated"));
}

#[cfg(unix)]
#[test]
fn rejects_a_symbolic_link() {
    use std::os::unix::fs::symlink;

    let directory = tempdir().expect("temporary directory");
    let target = directory.path().join("target.txt");
    let link = directory.path().join("link.txt");
    fs::write(&target, "target").expect("write fixture");
    symlink(&target, &link).expect("create symlink fixture");

    let error = open_document(&link, &MutationPolicy::default(), &cancellation())
        .expect_err("symlink should be rejected");
    assert!(error.to_string().contains("aliases cannot be mutated"));
}

#[test]
fn rejects_save_after_an_external_change() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("conflict.txt");
    fs::write(&path, "opened\n").expect("write fixture");
    let policy = MutationPolicy::default();
    let cancellation = cancellation();
    let mut document = open_document(&path, &policy, &cancellation).expect("open document");
    fs::write(&path, "external\n").expect("write external change");

    let error = save_document(&mut document, "editor\n", &policy, &cancellation)
        .expect_err("external change should conflict");

    assert!(error.to_string().contains("changed outside Muller"));
    assert_eq!(fs::read_to_string(path).expect("read target"), "external\n");
}

#[test]
fn preserves_utf8_bom_and_crlf() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("utf8-bom.txt");
    fs::write(&path, b"\xef\xbb\xbfone\r\ntwo\r\n").expect("write fixture");
    let policy = MutationPolicy::default();
    let cancellation = cancellation();
    let mut document = open_document(&path, &policy, &cancellation).expect("open document");

    save_document(&mut document, "changed\ntext\n", &policy, &cancellation).expect("save document");

    assert_eq!(
        fs::read(path).expect("read target"),
        b"\xef\xbb\xbfchanged\r\ntext\r\n"
    );
}

#[test]
fn preserves_utf16_little_and_big_endian_boms() {
    let directory = tempdir().expect("temporary directory");
    let policy = MutationPolicy::default();
    for (name, bom, little_endian) in [
        ("little.txt", &[0xff, 0xfe][..], true),
        ("big.txt", &[0xfe, 0xff][..], false),
    ] {
        let path = directory.path().join(name);
        write_utf16(&path, little_endian, "original\r\n");
        let cancellation = cancellation();
        let mut document = open_document(&path, &policy, &cancellation).expect("open document");
        save_document(&mut document, "updated\n", &policy, &cancellation).expect("save document");
        let bytes = fs::read(&path).expect("read target");
        assert!(bytes.starts_with(bom));
        let decoded = decode_utf16(&bytes[bom.len()..], little_endian);
        assert_eq!(decoded, "updated\r\n");
    }
}

#[test]
fn preserves_gbk_text() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("gbk.txt");
    write_encoded(&path, &[], GBK, "\u{4e2d}\u{6587}\r\n");
    let policy = MutationPolicy::default();
    let cancellation = cancellation();
    let mut document = open_document(&path, &policy, &cancellation).expect("open document");

    save_document(
        &mut document,
        "\u{4fee}\u{6539}\u{540e}\n",
        &policy,
        &cancellation,
    )
    .expect("save document");

    let bytes = fs::read(path).expect("read target");
    let (decoded, _, had_errors) = GBK.decode(&bytes);
    assert!(!had_errors);
    assert_eq!(decoded, "\u{4fee}\u{6539}\u{540e}\r\n");
}

#[test]
fn preserves_windows_1252_text() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("windows-1252.txt");
    write_encoded(&path, &[], WINDOWS_1252, "caf\u{e9}\r\n");
    let policy = MutationPolicy::default();
    let cancellation = cancellation();
    let mut document = open_document(&path, &policy, &cancellation).expect("open document");

    save_document(&mut document, "r\u{e9}sum\u{e9}\n", &policy, &cancellation)
        .expect("save document");

    let bytes = fs::read(path).expect("read target");
    let (decoded, _, had_errors) = WINDOWS_1252.decode(&bytes);
    assert!(!had_errors);
    assert_eq!(decoded, "r\u{e9}sum\u{e9}\r\n");
}

#[test]
fn preserves_mixed_line_endings_by_ordinal() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("mixed.txt");
    fs::write(&path, "one\r\ntwo\nthree\rfour").expect("write fixture");
    let policy = MutationPolicy::default();
    let cancellation = cancellation();
    let mut document = open_document(&path, &policy, &cancellation).expect("open document");

    save_document(&mut document, "1\n2\n3\n4", &policy, &cancellation).expect("save document");

    assert_eq!(
        fs::read_to_string(path).expect("read target"),
        "1\r\n2\n3\r4"
    );
}

#[test]
fn rejects_encoding_loss_without_changing_the_file() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("gbk.txt");
    write_encoded(&path, &[], GBK, "\u{4e2d}\u{6587}\n");
    let original = fs::read(&path).expect("read fixture");
    let policy = MutationPolicy::default();
    let cancellation = cancellation();
    let mut document = open_document(&path, &policy, &cancellation).expect("open document");

    let error = save_document(&mut document, "emoji \u{1f642}\n", &policy, &cancellation)
        .expect_err("GBK cannot represent emoji");

    assert!(error.to_string().contains("cannot be represented"));
    assert_eq!(fs::read(path).expect("read target"), original);
}

#[test]
fn creates_a_backup_and_can_roll_back() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("rollback.txt");
    fs::write(&path, "original\r\n").expect("write fixture");
    let policy = MutationPolicy::default();
    let cancellation = cancellation();
    let mut document = open_document(&path, &policy, &cancellation).expect("open document");

    let saved =
        save_document(&mut document, "changed\n", &policy, &cancellation).expect("save document");
    assert!(saved.backup_path.is_file());
    assert_eq!(
        fs::read_to_string(&path).expect("read target"),
        "changed\r\n"
    );

    let rolled_back =
        rollback_document(&mut document, &policy, &cancellation).expect("rollback document");
    assert_eq!(rolled_back.text, "original\n");
    assert_eq!(
        fs::read_to_string(&path).expect("read target"),
        "original\r\n"
    );
    assert!(rolled_back.backup_path.is_file());
}

#[test]
fn refuses_rollback_after_an_external_change() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("rollback-conflict.txt");
    fs::write(&path, "original\n").expect("write fixture");
    let policy = MutationPolicy::default();
    let cancellation = cancellation();
    let mut document = open_document(&path, &policy, &cancellation).expect("open document");
    save_document(&mut document, "saved\n", &policy, &cancellation).expect("save document");
    fs::write(&path, "external\n").expect("write external change");

    let error = rollback_document(&mut document, &policy, &cancellation)
        .expect_err("rollback should conflict");

    assert!(error.to_string().contains("changed outside Muller"));
    assert_eq!(fs::read_to_string(path).expect("read target"), "external\n");
}
