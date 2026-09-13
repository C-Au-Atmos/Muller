//! Opt-in native integration probe used to validate a test executable on real
//! NTFS. All fixture writes run in the ordinary-privilege parent process.

use crate::native_broker;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub fn entry() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|arg| arg != "--native-index-probe") {
        return false;
    }
    if args.len() != 4 {
        eprintln!("Usage: Muller.exe --native-index-probe <fixture-parent> <report.json>");
        return true;
    }
    let report_path = PathBuf::from(&args[3]);
    let report = match probe(Path::new(&args[2])) {
        Ok(report) => report,
        Err(error) => json!({"passed": false, "error": error}),
    };
    let _ = native_broker::cancel_native_indexer();
    if let Ok(bytes) = serde_json::to_vec_pretty(&report) {
        let _ = fs::write(report_path, bytes);
    }
    true
}

fn wait_for(
    mut check: impl FnMut() -> Result<bool, String>,
    timeout: Duration,
) -> Result<(), String> {
    let start = Instant::now();
    loop {
        if check()? {
            return Ok(());
        }
        if start.elapsed() > timeout {
            return Err("native probe timed out".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn probe(parent: &Path) -> Result<Value, String> {
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    let marker = format!(
        "muller_native_probe_{}_{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    );
    let fixture = parent.join(&marker);
    fs::create_dir(&fixture).map_err(|e| e.to_string())?;
    let result = probe_fixture(&fixture, &marker);
    // The only cleanup target is the unique directory created above.
    if fixture.parent() == Some(parent.as_path())
        && fixture
            .file_name()
            .is_some_and(|name| name == marker.as_str())
    {
        let _ = fs::remove_dir_all(&fixture);
    }
    result
}

fn probe_fixture(fixture: &Path, marker: &str) -> Result<Value, String> {
    let original = fixture.join(format!("{marker}_before.txt"));
    fs::write(&original, b"native indexing fixture").map_err(|e| e.to_string())?;
    let roots = vec![fixture.to_path_buf()];
    let started = Instant::now();
    native_broker::launch_native_indexer(roots.clone())?;
    wait_for(
        || {
            let status = native_broker::native_status();
            match status.state.as_str() {
                "ready" => Ok(true),
                "error" | "degraded" => Err(status
                    .message
                    .unwrap_or_else(|| "native provider unavailable".into())),
                _ => Ok(false),
            }
        },
        Duration::from_secs(180),
    )?;
    let build_ms = started.elapsed().as_millis();
    let status = native_broker::native_status();
    let query_start = Instant::now();
    let first = native_broker::search_native_index(&roots, marker, 0, 100)?;
    let query_ms = query_start.elapsed().as_micros() as f64 / 1000.0;
    if !first
        .hits
        .iter()
        .any(|hit| hit.name.ends_with("_before.txt"))
    {
        return Err("MFT enumeration missed pre-existing fixture".into());
    }
    let mutations = Instant::now();
    let renamed = fixture.join(format!("{marker}_after.txt"));
    fs::rename(original, &renamed).map_err(|e| e.to_string())?;
    wait_for(
        || {
            let page = native_broker::search_native_index(&roots, marker, 0, 100)?;
            Ok(page.hits.iter().any(|hit| hit.name.ends_with("_after.txt"))
                && !page
                    .hits
                    .iter()
                    .any(|hit| hit.name.ends_with("_before.txt")))
        },
        Duration::from_secs(20),
    )?;
    let nested = fixture.join("parent_before");
    fs::create_dir(&nested).map_err(|e| e.to_string())?;
    fs::write(
        nested.join(format!("{marker}_nested.txt")),
        b"created after initial build",
    )
    .map_err(|e| e.to_string())?;
    wait_for(
        || {
            Ok(native_broker::search_native_index(&roots, marker, 0, 100)?
                .hits
                .iter()
                .any(|hit| hit.name.ends_with("_nested.txt")))
        },
        Duration::from_secs(20),
    )?;
    fs::rename(&nested, fixture.join("parent_after")).map_err(|e| e.to_string())?;
    wait_for(
        || {
            Ok(native_broker::search_native_index(&roots, marker, 0, 100)?
                .hits
                .iter()
                .any(|hit| {
                    hit.name.ends_with("_nested.txt")
                        && hit.path.to_string_lossy().contains("parent_after")
                }))
        },
        Duration::from_secs(20),
    )?;
    fs::remove_file(renamed).map_err(|e| e.to_string())?;
    wait_for(
        || {
            Ok(!native_broker::search_native_index(&roots, marker, 0, 100)?
                .hits
                .iter()
                .any(|hit| hit.name.ends_with("_after.txt")))
        },
        Duration::from_secs(20),
    )?;
    Ok(
        json!({"passed": true, "provider": status.provider, "entries":status.entries, "volumes":status.volumes,
        "buildIncludingElevationMs":build_ms,"initialQueryMs":query_ms,"mutationChecksMs":mutations.elapsed().as_millis(),
        "checks":["MFT pre-existing file", "USN file rename", "USN create", "USN parent rename changes descendant path", "USN delete"]}),
    )
}
