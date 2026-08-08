use std::{fs, process::Command};

use serde_json::Value;
use tempfile::tempdir;

#[test]
fn cli_emits_machine_readable_json_without_progress_noise() {
    let directory = tempdir().expect("temporary directory");
    fs::write(directory.path().join("first.bin"), b"same").expect("write first fixture");
    fs::write(directory.path().join("second.bin"), b"same").expect("write second fixture");

    let output = Command::new(env!("CARGO_BIN_EXE_muller-dedup"))
        .arg("--json")
        .arg("--quiet")
        .arg(directory.path())
        .output()
        .expect("run CLI");

    assert!(
        output.status.success(),
        "CLI stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let report: Value = serde_json::from_slice(&output.stdout).expect("valid JSON report");
    assert_eq!(report["groups"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        report["groups"][0]["files"].as_array().map(Vec::len),
        Some(2)
    );
    assert_eq!(
        report["groups"][0]["full_hash"].as_str().map(str::len),
        Some(64)
    );
    assert_eq!(
        report["groups"][0]["files"][0]["head_tail"]
            .as_str()
            .map(str::len),
        Some(16)
    );
    assert_eq!(report["reclaimable_bytes"], 4);
}

#[test]
fn cli_rejects_missing_roots_with_a_nonzero_exit() {
    let output = Command::new(env!("CARGO_BIN_EXE_muller-dedup"))
        .output()
        .expect("run CLI");

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("required"));
}
