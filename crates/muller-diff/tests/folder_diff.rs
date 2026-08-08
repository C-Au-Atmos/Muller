use std::{fs, thread, time::Duration};

use muller_diff::{
    FolderDiffConfig, FolderDiffPhase, FolderDiffStatus, compare_folders,
    compare_folders_cancellable_with_progress,
};
use tempfile::tempdir;

#[test]
fn folder_diff_classifies_content_and_side_presence_deterministically() {
    let fixture = tempdir().expect("fixture");
    let left = fixture.path().join("left");
    let right = fixture.path().join("right");
    fs::create_dir_all(left.join("nested")).expect("left directories");
    fs::create_dir_all(right.join("nested")).expect("right directories");
    fs::write(left.join("same.txt"), "same").expect("left same");
    fs::write(right.join("same.txt"), "same").expect("right same");
    let same_modified = fs::metadata(left.join("same.txt"))
        .and_then(|metadata| metadata.modified())
        .expect("left same modified time");
    fs::File::options()
        .write(true)
        .open(right.join("same.txt"))
        .and_then(|file| file.set_times(fs::FileTimes::new().set_modified(same_modified)))
        .expect("align same file modified time");
    fs::write(left.join("changed.txt"), "left").expect("left changed");
    fs::write(right.join("changed.txt"), "right").expect("right changed");
    fs::write(left.join("left-only.txt"), "left").expect("left only");
    fs::write(right.join("right-only.txt"), "right").expect("right only");

    let report = compare_folders(&FolderDiffConfig::new(&left, &right)).expect("compare");
    let statuses = report
        .entries
        .iter()
        .map(|entry| {
            (
                entry.relative_path.to_string_lossy().replace('\\', "/"),
                entry.status,
            )
        })
        .collect::<Vec<_>>();

    assert_eq!(
        statuses,
        vec![
            ("changed.txt".to_owned(), FolderDiffStatus::Different),
            ("left-only.txt".to_owned(), FolderDiffStatus::LeftOnly),
            ("nested".to_owned(), FolderDiffStatus::Equal),
            ("right-only.txt".to_owned(), FolderDiffStatus::RightOnly),
            ("same.txt".to_owned(), FolderDiffStatus::Equal),
        ]
    );
    assert_eq!(report.stats.different, 1);
    assert_eq!(report.stats.left_only, 1);
    assert_eq!(report.stats.right_only, 1);
    assert_eq!(report.stats.hashed_files, 2);
}

#[test]
fn equal_content_with_different_mtime_is_metadata_only_by_default() {
    let fixture = tempdir().expect("fixture");
    let left = fixture.path().join("left");
    let right = fixture.path().join("right");
    fs::create_dir_all(&left).expect("left");
    fs::create_dir_all(&right).expect("right");
    fs::write(left.join("same.txt"), "same").expect("left file");
    thread::sleep(Duration::from_millis(20));
    fs::write(right.join("same.txt"), "same").expect("right file");

    let report = compare_folders(&FolderDiffConfig::new(&left, &right)).expect("compare");
    assert_eq!(report.entries[0].status, FolderDiffStatus::MetadataOnly);

    let strict = compare_folders(&FolderDiffConfig::new(&left, &right).with_mtime_as_diff(true))
        .expect("strict compare");
    assert_eq!(strict.entries[0].status, FolderDiffStatus::Different);
}

#[test]
fn cancellation_never_emits_complete() {
    let fixture = tempdir().expect("fixture");
    let left = fixture.path().join("left");
    let right = fixture.path().join("right");
    fs::create_dir_all(&left).expect("left");
    fs::create_dir_all(&right).expect("right");
    let cancellation = muller_core::CancellationToken::default();
    cancellation.cancel();
    let phases = std::sync::Mutex::new(Vec::new());

    let error = compare_folders_cancellable_with_progress(
        &FolderDiffConfig::new(&left, &right),
        &cancellation,
        |progress| phases.lock().expect("phases").push(progress.phase),
    )
    .expect_err("cancelled");

    assert!(matches!(error, muller_diff::DiffError::Cancelled));
    assert!(
        !phases
            .lock()
            .expect("phases")
            .contains(&FolderDiffPhase::Complete)
    );
}
