use std::{path::PathBuf, process::ExitCode};

use anyhow::Context as _;
use clap::Parser;
use muller_core::{MAX_HASH_THREADS, ProgressEvent, ScanConfig, ScanPhase, scan_with_progress};

#[derive(Debug, Parser)]
#[command(
    name = "muller-dedup",
    version,
    about = "Read-only duplicate-file discovery using Muller's three-stage funnel"
)]
struct Arguments {
    #[arg(required = true, value_name = "ROOT")]
    roots: Vec<PathBuf>,

    #[arg(long, default_value_t = 1, value_name = "BYTES")]
    min_size: u64,

    #[arg(
        long,
        default_value_t = default_hash_threads(),
        value_parser = parse_thread_count,
        value_name = "COUNT"
    )]
    threads: usize,

    #[arg(long = "blacklist", value_name = "PATH")]
    blacklist: Vec<PathBuf>,

    #[arg(long)]
    json: bool,

    #[arg(long)]
    quiet: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> anyhow::Result<()> {
    let arguments = Arguments::parse();
    let mut config = ScanConfig::new(arguments.roots)
        .with_min_size(arguments.min_size)
        .with_hash_threads(arguments.threads);
    for path in arguments.blacklist {
        config = config.with_blacklist_path(path);
    }

    let report = if arguments.quiet {
        muller_core::scan(&config)
    } else {
        scan_with_progress(&config, print_progress)
    }
    .context("duplicate scan failed")?;

    if arguments.json {
        serde_json::to_writer_pretty(std::io::stdout().lock(), &report)
            .context("cannot write JSON report")?;
        println!();
    } else {
        print_human_report(&report);
    }
    Ok(())
}

fn print_progress(event: &ProgressEvent) {
    let phase = match event.phase {
        ScanPhase::Discovering => "discover",
        ScanPhase::Fingerprinting => "head-tail",
        ScanPhase::FullHashing => "full-hash",
        ScanPhase::Complete => "complete",
    };
    match event.total {
        Some(total) => eprintln!(
            "[{phase:>9}] {:>8}/{:<8} candidates {:>8}  read {}",
            event.processed,
            total,
            event.candidate_files,
            format_bytes(event.bytes_read)
        ),
        None => eprintln!("[{phase:>9}] {:>8} files discovered", event.processed),
    }
}

fn print_human_report(report: &muller_core::ScanReport) {
    println!(
        "{} duplicate group(s), {} reclaimable, {} skipped file(s)",
        report.groups.len(),
        format_bytes(report.reclaimable_bytes),
        report.skipped.len()
    );

    for (group_index, group) in report.groups.iter().enumerate() {
        println!();
        println!(
            "Group {}  {} each  {} reclaimable  {}",
            group_index + 1,
            format_bytes(group.size),
            format_bytes(group.reclaimable_bytes()),
            &group.hash_hex()[..16]
        );
        for (file_index, file) in group.files.iter().enumerate() {
            let action = if file_index == group.suggested_keep {
                "KEEP"
            } else {
                "DUP "
            };
            println!("  {action}  {}", file.path.display());
        }
    }

    if !report.skipped.is_empty() {
        println!();
        println!("Skipped:");
        for file in &report.skipped {
            let lock = if file.locked { " [locked]" } else { "" };
            println!(
                "  {:?}{}  {}: {}",
                file.stage,
                lock,
                file.path.display(),
                file.error
            );
        }
    }
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn default_hash_threads() -> usize {
    std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .unwrap_or(1)
        .min(8)
}

fn parse_thread_count(value: &str) -> Result<usize, String> {
    let threads = value
        .parse::<usize>()
        .map_err(|_| "thread count must be a positive integer".to_owned())?;
    if threads == 0 {
        return Err("thread count must be at least 1".to_owned());
    }
    if threads > MAX_HASH_THREADS {
        return Err(format!("thread count must not exceed {MAX_HASH_THREADS}"));
    }
    Ok(threads)
}
