use std::{fs, io::Write as _, path::Path};

use criterion::{Criterion, criterion_group, criterion_main};
use muller_core::{ScanConfig, scan};
use tempfile::TempDir;

fn benchmark_funnel(criterion: &mut Criterion) {
    let small = small_file_fixture();
    let large = large_file_fixture();

    criterion.bench_function("dedup_funnel/small_files", |bencher| {
        let config = ScanConfig::new([small.path()]).with_hash_threads(4);
        bencher.iter(|| scan(&config).expect("small-file benchmark scan"));
    });

    criterion.bench_function("dedup_funnel/large_files", |bencher| {
        let config = ScanConfig::new([large.path()]).with_hash_threads(4);
        bencher.iter(|| scan(&config).expect("large-file benchmark scan"));
    });
}

fn small_file_fixture() -> TempDir {
    let directory = tempfile::tempdir().expect("small benchmark directory");
    for index in 0..100_u16 {
        let contents = vec![(index % 10) as u8; 16 * 1024];
        write_file(
            &directory.path().join(format!("small-{index:03}.bin")),
            &contents,
        );
    }
    directory
}

fn large_file_fixture() -> TempDir {
    let directory = tempfile::tempdir().expect("large benchmark directory");
    for index in 0..8_u8 {
        let contents = vec![index % 4; 4 * 1024 * 1024];
        write_file(
            &directory.path().join(format!("large-{index:02}.bin")),
            &contents,
        );
    }
    directory
}

fn write_file(path: &Path, contents: &[u8]) {
    let mut file = fs::File::create(path).expect("create benchmark file");
    file.write_all(contents).expect("write benchmark file");
}

criterion_group!(benches, benchmark_funnel);
criterion_main!(benches);
