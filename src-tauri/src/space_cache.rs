//! Ordinary-user space measurements, used only as a preview after an NTFS
//! watermark check. Every displayed cache is followed by a normal traversal.
use crate::space_sniffer::{SpaceNode, SpaceNodeKind};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    hash::{Hash, Hasher},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 32 * 1024 * 1024;
pub(crate) const MAX_NODES: usize = 100_000;
const VERSION: u32 = 2;

#[derive(Serialize, Deserialize)]
pub(crate) struct SpaceCache {
    version: u32,
    root: PathBuf,
    depth: u32,
    display_depth: u32,
    stamp: String,
    pub nodes: Vec<SpaceNode>,
}

pub(crate) fn path_for(root: &Path) -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    root.hash(&mut hash);
    Some(
        PathBuf::from(base)
            .join("Muller")
            .join("space-cache-v2")
            .join(format!("{:016x}.json", hash.finish())),
    )
}

pub(crate) fn load(
    path: &Path,
    root: &Path,
    depth: u32,
    display_depth: u32,
    stamp: &str,
) -> Option<SpaceCache> {
    let file = fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_BYTES {
        return None;
    }
    let cache: SpaceCache = serde_json::from_slice(&bytes).ok()?;
    if cache.version != VERSION
        || cache.root != root
        || cache.depth != depth
        || cache.display_depth != display_depth
        || cache.stamp != stamp
        || cache.nodes.is_empty()
        || cache.nodes.len() > MAX_NODES
    {
        return None;
    }
    let mut seen = std::collections::HashSet::new();
    for node in &cache.nodes {
        if node.partial
            || node.scanning
            || !node.path.starts_with(root)
            || node
                .path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
            || !seen.insert(&node.path)
        {
            return None;
        }
        if node.path != root
            && node
                .parent
                .as_ref()
                .is_none_or(|parent| !seen.contains(parent))
        {
            return None;
        }
    }
    let first = &cache.nodes[0];
    if first.path != root || first.parent.is_some() || first.kind != SpaceNodeKind::Directory {
        return None;
    }
    Some(cache)
}

pub(crate) fn save(
    path: &Path,
    root: PathBuf,
    depth: u32,
    display_depth: u32,
    stamp: String,
    nodes: Vec<SpaceNode>,
) -> Result<(), String> {
    if nodes.is_empty() || nodes.len() > MAX_NODES || nodes.iter().any(|n| n.partial || n.scanning)
    {
        return Err("space measurements incomplete or too large to cache".into());
    }
    let bytes = serde_json::to_vec(&SpaceCache {
        version: VERSION,
        root,
        depth,
        display_depth,
        stamp,
        nodes,
    })
    .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("space cache exceeds size limit".into());
    }
    let parent = path.parent().ok_or("space cache has no directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // This module runs in the ordinary GUI process; cache writes never elevate.
    static NEXT_TEMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let sequence = NEXT_TEMP.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp = path.with_extension(format!("{}.{time}.{sequence}.tmp", std::process::id()));
    let mut created = false;
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        created = true;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() && created {
        let _ = fs::remove_file(&temp);
    }
    if result.is_ok() {
        prune(parent, path);
    }
    result
}

fn prune(directory: &Path, keep: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut caches: Vec<_> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_stem()?.to_str()?;
            if path.extension()?.to_str()? != "json"
                || name.len() != 16
                || !name.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return None;
            }
            let metadata = fs::symlink_metadata(&path).ok()?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return None;
            }
            Some((path, metadata.modified().ok()?))
        })
        .collect();
    caches.sort_unstable_by_key(|entry| std::cmp::Reverse(entry.1));
    // At most eight 32 MiB measurements; never prune unrelated files.
    for (path, _) in caches.into_iter().skip(8) {
        if path != keep {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_requires_matching_root_depth_stamp_and_complete_measurements() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("cache.json");
        let root = tmp.path().join("measured");
        let node = SpaceNode {
            path: root.clone(),
            parent: None,
            name: "measured".into(),
            kind: SpaceNodeKind::Directory,
            bytes: 12,
            modified_unix_ms: Some(1_700_000_000_000),
            depth: 0,
            child_count: 0,
            partial: false,
            scanning: false,
        };
        save(
            &path,
            root.clone(),
            64,
            3,
            "usn1".into(),
            vec![node.clone()],
        )
        .unwrap();
        assert_eq!(
            load(&path, &root, 64, 3, "usn1").unwrap().nodes[0].bytes,
            12
        );
        assert_eq!(
            load(&path, &root, 64, 3, "usn1").unwrap().nodes[0].modified_unix_ms,
            node.modified_unix_ms
        );
        assert!(load(&path, &root, 64, 3, "usn2").is_none());
        assert!(load(&path, &root, 32, 3, "usn1").is_none());
        assert!(load(&path, &root, 64, 4, "usn1").is_none());
        assert!(load(&path, tmp.path(), 64, 3, "usn1").is_none());
        let mut changed = node;
        changed.bytes = 30;
        save(
            &path,
            root.clone(),
            64,
            3,
            "usn2".into(),
            vec![changed.clone()],
        )
        .unwrap();
        assert_eq!(
            load(&path, &root, 64, 3, "usn2").unwrap().nodes[0].bytes,
            30
        );
        changed.partial = true;
        assert!(save(&path, root, 64, 3, "usn3".into(), vec![changed]).is_err());
        fs::write(&path, b"broken").unwrap();
        assert!(load(&path, tmp.path(), 64, 3, "usn2").is_none());
    }

    #[test]
    fn rejects_legacy_measurements_without_a_mutation_timestamp() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("cache.json");
        let root = tmp.path().join("measured");
        let legacy = serde_json::json!({
            "version": 1,
            "root": root,
            "depth": 64,
            "stamp": "usn1",
            "nodes": [{
                "path": root,
                "parent": null,
                "name": "measured",
                "kind": "directory",
                "bytes": 12,
                "depth": 0,
                "childCount": 0,
                "partial": false,
                "scanning": false
            }]
        });
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert!(load(&path, &root, 64, 3, "usn1").is_none());
    }
}
