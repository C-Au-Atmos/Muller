use std::{
    cell::Cell,
    fs,
    io::Write as _,
    path::Path,
    time::{Duration, Instant},
};

use muller_core::{ProgressEvent, ScanConfig, ScanPhase, scan_with_progress};
use rayon::prelude::*;

const FILE_COUNT: usize = 46_000;
const FILE_BYTES: usize = 1024;
const MEASUREMENTS: usize = 5;

#[derive(Debug, Clone, Copy)]
struct Timings {
    discovery: Duration,
    fingerprint: Duration,
    full_hash: Duration,
    total: Duration,
}

fn main() {
    let fixture = tempfile::tempdir().expect("benchmark fixture");
    build_fixture(fixture.path());

    let first_pass = run_once(fixture.path(), 4);
    println!("first-pass/4-thread: {}", format_timings(first_pass));

    let _ = run_once(fixture.path(), 1);
    let _ = run_once(fixture.path(), 4);
    let mut serial = Vec::with_capacity(MEASUREMENTS);
    let mut parallel = Vec::with_capacity(MEASUREMENTS);
    for _ in 0..MEASUREMENTS {
        serial.push(run_once(fixture.path(), 1));
        parallel.push(run_once(fixture.path(), 4));
    }

    println!(
        "warm-p50/1-thread-control: {}",
        format_timings(median(&mut serial))
    );
    println!(
        "warm-p50/4-thread-current: {}",
        format_timings(median(&mut parallel))
    );
    let serial_fingerprint = median_duration(serial.iter().map(|timing| timing.fingerprint));
    let parallel_fingerprint = median_duration(parallel.iter().map(|timing| timing.fingerprint));
    let improvement = if serial_fingerprint.is_zero() {
        0.0
    } else {
        (1.0 - parallel_fingerprint.as_secs_f64() / serial_fingerprint.as_secs_f64()) * 100.0
    };
    println!("fingerprint-p50-improvement: {improvement:.1}%");
}

fn build_fixture(root: &Path) {
    let started = Instant::now();
    (0..FILE_COUNT).into_par_iter().for_each(|index| {
        let mut contents = [0_u8; FILE_BYTES];
        contents[..8].copy_from_slice(&(index as u64).to_le_bytes());
        contents[8..16].copy_from_slice(&(index as u64).wrapping_mul(0x9e37_79b9).to_le_bytes());
        let path = root.join(format!("candidate-{index:05}.bin"));
        let mut file = fs::File::create(path).expect("create fixture file");
        file.write_all(&contents).expect("write fixture file");
    });
    println!(
        "fixture: {FILE_COUNT} files x {FILE_BYTES} bytes in {:.3}s",
        started.elapsed().as_secs_f64(),
    );
}

fn run_once(root: &Path, threads: usize) -> Timings {
    let started = Instant::now();
    let discovery_end = Cell::new(None);
    let fingerprint_end = Cell::new(None);
    let full_hash_end = Cell::new(None);
    let config = ScanConfig::new([root])
        .with_hash_threads(threads)
        .with_progress_batch_size(256);
    let report = scan_with_progress(&config, |event: &ProgressEvent| match event.phase {
        ScanPhase::Fingerprinting if event.processed == 0 => {
            discovery_end.set(Some(started.elapsed()));
        }
        ScanPhase::FullHashing if event.processed == 0 => {
            fingerprint_end.set(Some(started.elapsed()));
        }
        ScanPhase::Complete => full_hash_end.set(Some(started.elapsed())),
        ScanPhase::Discovering | ScanPhase::Fingerprinting | ScanPhase::FullHashing => {}
    })
    .expect("benchmark scan");
    assert_eq!(report.stats.files_seen, FILE_COUNT as u64);
    assert_eq!(report.stats.size_candidate_files, FILE_COUNT as u64);
    assert_eq!(report.stats.fully_hashed_files, 0);

    let total = started.elapsed();
    let discovery = discovery_end.get().expect("fingerprint phase");
    let fingerprint_boundary = fingerprint_end.get().expect("full hash phase");
    let full_hash_boundary = full_hash_end.get().expect("complete phase");
    Timings {
        discovery,
        fingerprint: fingerprint_boundary.saturating_sub(discovery),
        full_hash: full_hash_boundary.saturating_sub(fingerprint_boundary),
        total,
    }
}

fn median(values: &mut [Timings]) -> Timings {
    values.sort_by_key(|timing| timing.total);
    values[values.len() / 2]
}

fn median_duration(values: impl Iterator<Item = Duration>) -> Duration {
    let mut values = values.collect::<Vec<_>>();
    values.sort_unstable();
    values[values.len() / 2]
}

fn format_timings(timings: Timings) -> String {
    format!(
        "discovery {:.3}s, fingerprint {:.3}s, full-hash {:.3}s, total {:.3}s",
        timings.discovery.as_secs_f64(),
        timings.fingerprint.as_secs_f64(),
        timings.full_hash.as_secs_f64(),
        timings.total.as_secs_f64(),
    )
}
