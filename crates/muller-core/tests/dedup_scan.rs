use std::{fs, io::Write as _, path::Path, sync::Mutex};

use muller_core::{
    CancellationToken, ScanConfig, ScanError, ScanPhase, SkippedStage, scan,
    scan_cancellable_with_progress, scan_with_progress,
};
use tempfile::tempdir;

#[test]
fn exact_duplicates_survive_same_size_false_positives() {
    let directory = tempdir().expect("temporary directory");
    write_file(&directory.path().join("a.bin"), b"alpha");
    write_file(&directory.path().join("b.bin"), b"alpha");
    write_file(&directory.path().join("same-size-not-equal.bin"), b"omega");

    let report = scan(&ScanConfig::new([directory.path()])).expect("scan succeeds");

    assert_eq!(report.groups.len(), 1);
    assert_eq!(report.groups[0].files.len(), 2);
    assert_eq!(report.groups[0].reclaimable_bytes(), 5);
    assert_eq!(report.stats.size_candidate_files, 3);
    assert_eq!(report.stats.head_tail_candidate_files, 2);
    assert_eq!(report.stats.fully_hashed_files, 2);
}

#[test]
fn full_hash_rejects_equal_head_and_tail_with_different_middle() {
    let directory = tempdir().expect("temporary directory");
    let mut left = vec![0x11; 64 * 1024];
    left.extend(vec![0x22; 32 * 1024]);
    left.extend(vec![0x33; 64 * 1024]);
    let mut right = vec![0x11; 64 * 1024];
    right.extend(vec![0x44; 32 * 1024]);
    right.extend(vec![0x33; 64 * 1024]);
    write_file(&directory.path().join("left.bin"), &left);
    write_file(&directory.path().join("right.bin"), &right);

    let report = scan(&ScanConfig::new([directory.path()])).expect("scan succeeds");

    assert!(report.groups.is_empty());
    assert_eq!(report.stats.head_tail_candidate_files, 2);
    assert_eq!(report.stats.fully_hashed_files, 2);
}

#[test]
fn groups_and_reclaimable_math_are_deterministic() {
    let directory = tempdir().expect("temporary directory");
    for name in ["z.bin", "a.bin", "nested/m.bin"] {
        write_file(&directory.path().join(name), b"repeat");
    }
    write_file(&directory.path().join("unique.bin"), b"unique-value");
    let config = ScanConfig::new([directory.path()]).with_hash_threads(2);

    let first = scan(&config).expect("first scan succeeds");
    let second = scan(&config).expect("second scan succeeds");

    assert_eq!(first.groups.len(), 1);
    assert_eq!(first.groups[0].total_bytes(), 18);
    assert_eq!(first.groups[0].reclaimable_bytes(), 12);
    assert_eq!(first.reclaimable_bytes, 12);
    let first_paths = first.groups[0]
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let second_paths = second.groups[0]
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    assert_eq!(first_paths, second_paths);
    assert_eq!(first.groups[0].full_hash, second.groups[0].full_hash);
}

#[test]
fn blacklisted_subtrees_are_pruned_and_blacklisted_roots_are_rejected() {
    let directory = tempdir().expect("temporary directory");
    let protected = directory.path().join("protected");
    write_file(&directory.path().join("visible.bin"), b"duplicate");
    write_file(&protected.join("hidden.bin"), b"duplicate");

    let report = scan(&ScanConfig::new([directory.path()]).with_blacklist_path(protected.clone()))
        .expect("parent scan succeeds");
    assert!(report.groups.is_empty());
    assert_eq!(report.stats.blacklisted_entries_skipped, 1);

    let error = scan(&ScanConfig::new([&protected]).with_blacklist_path(&protected))
        .expect_err("protected root must be rejected");
    assert!(matches!(error, ScanError::ProtectedRoot { .. }));
}

#[test]
fn overlapping_roots_do_not_scan_the_same_files_twice() {
    let directory = tempdir().expect("temporary directory");
    let nested = directory.path().join("nested");
    write_file(&nested.join("a.bin"), b"same");
    write_file(&nested.join("b.bin"), b"same");

    let report = scan(&ScanConfig::new([directory.path(), nested.as_path()]))
        .expect("overlapping root scan succeeds");

    assert_eq!(report.stats.files_seen, 2);
    assert_eq!(report.groups.len(), 1);
    assert_eq!(report.groups[0].files.len(), 2);
}

#[test]
fn hard_links_are_counted_once_as_physical_files() {
    let directory = tempdir().expect("temporary directory");
    let original = directory.path().join("original.bin");
    let hard_link = directory.path().join("hard-link.bin");
    let copy = directory.path().join("copy.bin");
    write_file(&original, b"physical-content");
    fs::hard_link(&original, &hard_link).expect("create hard link");
    fs::copy(&original, &copy).expect("create independent copy");

    let report = scan(&ScanConfig::new([directory.path()])).expect("scan succeeds");

    assert_eq!(report.stats.physical_duplicates_skipped, 1);
    assert_eq!(report.groups.len(), 1);
    assert_eq!(report.groups[0].files.len(), 2);
    assert!(report.groups[0].files[report.groups[0].suggested_keep].hard_link_count > 1);
    assert_eq!(report.reclaimable_bytes, b"physical-content".len() as u64);
}

#[cfg(windows)]
#[test]
fn exclusively_locked_candidates_are_reported_without_aborting() {
    use std::os::windows::fs::OpenOptionsExt as _;

    let directory = tempdir().expect("temporary directory");
    let locked_path = directory.path().join("locked.bin");
    let readable_path = directory.path().join("readable.bin");
    write_file(&locked_path, b"locked-content");
    write_file(&readable_path, b"locked-content");
    let _lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&locked_path)
        .expect("hold exclusive lock");

    let report = scan(&ScanConfig::new([directory.path()])).expect("scan still succeeds");

    assert!(report.groups.is_empty());
    assert_eq!(report.skipped.len(), 1);
    assert_eq!(report.skipped[0].stage, SkippedStage::Identity);
    assert!(report.skipped[0].locked);
}

#[test]
fn minimum_size_excludes_small_files_before_fingerprinting() {
    let directory = tempdir().expect("temporary directory");
    write_file(&directory.path().join("small-a.bin"), b"tiny");
    write_file(&directory.path().join("small-b.bin"), b"tiny");

    let report =
        scan(&ScanConfig::new([directory.path()]).with_min_size(8)).expect("scan succeeds");

    assert!(report.groups.is_empty());
    assert_eq!(report.stats.files_below_min_size, 2);
    assert_eq!(report.stats.bytes_read, 0);
}

#[test]
fn progress_events_are_ordered_and_finish_with_complete() {
    let directory = tempdir().expect("temporary directory");
    write_file(&directory.path().join("a.bin"), b"same");
    write_file(&directory.path().join("b.bin"), b"same");
    let events = Mutex::new(Vec::new());

    let report = scan_with_progress(&ScanConfig::new([directory.path()]), |event| {
        events.lock().expect("event lock").push(event.clone());
    })
    .expect("scan succeeds");
    assert_eq!(report.stats.bytes_read, 16);

    let events = events.into_inner().expect("event list");
    let phases = events.iter().map(|event| event.phase).collect::<Vec<_>>();
    assert_eq!(phases.first(), Some(&ScanPhase::Discovering));
    assert_eq!(phases.last(), Some(&ScanPhase::Complete));
    let phase_rank = |phase| match phase {
        ScanPhase::Discovering => 0,
        ScanPhase::Fingerprinting => 1,
        ScanPhase::FullHashing => 2,
        ScanPhase::Complete => 3,
    };
    assert!(
        phases
            .windows(2)
            .all(|pair| phase_rank(pair[0]) <= phase_rank(pair[1]))
    );
    assert!(
        events
            .iter()
            .all(|event| { event.total.is_none_or(|total| event.processed <= total) })
    );
}

#[test]
fn cancellation_stops_before_full_hash_and_never_emits_complete() {
    let directory = tempdir().expect("temporary directory");
    write_file(&directory.path().join("a.bin"), &vec![0x44; 512 * 1024]);
    write_file(&directory.path().join("b.bin"), &vec![0x44; 512 * 1024]);
    let cancellation = CancellationToken::default();
    let phases = Mutex::new(Vec::new());

    let result = scan_cancellable_with_progress(
        &ScanConfig::new([directory.path()]),
        &cancellation,
        |event| {
            phases.lock().expect("phase lock").push(event.phase);
            if event.phase == ScanPhase::FullHashing {
                cancellation.cancel();
            }
        },
    );

    assert!(matches!(result, Err(ScanError::Cancelled)));
    assert!(
        !phases
            .into_inner()
            .expect("phases")
            .contains(&ScanPhase::Complete)
    );
}

fn write_file(path: &Path, contents: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create fixture directory");
    }
    let mut file = fs::File::create(path).expect("create fixture file");
    file.write_all(contents).expect("write fixture file");
}
