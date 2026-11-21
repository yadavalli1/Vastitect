//! Native services kept deliberately thin. All domain logic lives in TypeScript;
//! this crate only moves bytes, indexes text and shells out to Git.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use rusqlite::{params, Connection};
use serde::Serialize;

pub type Result<T> = std::result::Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// True for paths that are part of the workspace format.
pub fn is_workspace_path(rel: &str) -> bool {
    rel == "vastitecture.yaml"
        || rel == "model/relationships.yaml"
        || ((rel.starts_with("model/elements/") || rel.starts_with("views/")) && rel.ends_with(".yaml"))
        || (rel.starts_with("adrs/") && rel.ends_with(".md"))
}

/// Resolve a workspace-relative path, refusing anything that escapes the root.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let p = Path::new(rel);
    if p.is_absolute() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Refusing path outside the workspace: {rel}"));
    }
    Ok(root.join(p))
}

fn walk(dir: &Path, prefix: &str, out: &mut BTreeMap<String, String>) -> Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel = format!("{prefix}{name}");
        let ty = entry.file_type().map_err(err)?;
        if ty.is_dir() {
            walk(&entry.path(), &format!("{rel}/"), out)?;
        } else if is_workspace_path(&rel) {
            out.insert(rel, fs::read_to_string(entry.path()).map_err(err)?);
        }
    }
    Ok(())
}

/// Read every workspace file in one call so the webview gets a single batched payload.
pub fn read_all(root: &Path) -> Result<BTreeMap<String, String>> {
    let mut out = BTreeMap::new();
    let settings = root.join("vastitecture.yaml");
    if settings.is_file() {
        out.insert("vastitecture.yaml".into(), fs::read_to_string(settings).map_err(err)?);
    }
    for dir in ["model", "views", "adrs"] {
        walk(&root.join(dir), &format!("{dir}/"), &mut out)?;
    }
    Ok(out)
}

/// Atomic write: temp file in the same directory, then rename.
pub fn write_file(root: &Path, rel: &str, content: &str) -> Result<()> {
    let path = resolve(root, rel)?;
    let dir = path.parent().ok_or("No parent directory")?;
    fs::create_dir_all(dir).map_err(err)?;
    let tmp = dir.join(format!(".{}.tmp", path.file_name().unwrap().to_string_lossy()));
    {
        let mut f = fs::File::create(&tmp).map_err(err)?;
        f.write_all(content.as_bytes()).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    fs::rename(&tmp, &path).map_err(err)
}

/// Remove a file and any directories it leaves empty (up to the root).
pub fn remove_file(root: &Path, rel: &str) -> Result<()> {
    let path = resolve(root, rel)?;
    if path.exists() {
        fs::remove_file(&path).map_err(err)?;
    }
    let mut dir = path.parent();
    while let Some(d) = dir {
        if d == root || fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
    Ok(())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct GitFile {
    pub status: String,
    pub path: String,
}

#[derive(Serialize, Debug, Default)]
pub struct GitInfo {
    pub is_repo: bool,
    pub branch: String,
    pub files: Vec<GitFile>,
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(root).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

/// Read-only Git status for the workspace. Pull, commit and push are left to the user's own tooling.
pub fn git_status(root: &Path) -> GitInfo {
    let Some(porcelain) = git(root, &["status", "--porcelain", "--untracked-files=all", "--", "."]) else {
        return GitInfo::default();
    };
    GitInfo {
        is_repo: true,
        branch: git(root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default().trim().to_string(),
        files: porcelain
            .lines()
            .filter(|l| l.len() > 3)
            .map(|l| GitFile { status: l[..2].trim().to_string(), path: l[3..].to_string() })
            .collect(),
    }
}

/// Unified diff of one workspace file against HEAD.
pub fn git_diff(root: &Path, rel: &str) -> Result<String> {
    resolve(root, rel)?;
    Ok(git(root, &["diff", "HEAD", "--", rel]).unwrap_or_default())
}

/// A revision name a user may pick: a commit hash, branch, tag or HEAD~n. Never an option.
fn safe_rev(rev: &str) -> bool {
    !rev.is_empty() && rev.len() <= 80 && !rev.starts_with('-') && rev.chars().all(|c| c.is_ascii_alphanumeric() || "_./~^-".contains(c)) && !rev.contains("..")
}

fn workspace_file(p: &str) -> bool {
    p == "vastitecture.yaml"
        || ((p.starts_with("model/") || p.starts_with("views/") || p.starts_with("comments/")) && p.ends_with(".yaml"))
        || (p.starts_with("adrs/") && p.ends_with(".md"))
}

/// The workspace's files as they were at a revision (for comparing the model with an earlier version).
pub fn git_files_at(root: &Path, rev: &str) -> Result<std::collections::BTreeMap<String, String>> {
    if !safe_rev(rev) {
        return Err(format!("Not a revision name: {rev}"));
    }
    let list = git(root, &["ls-tree", "-r", "--name-only", rev, "--", "."]).ok_or_else(|| format!("{rev} is not a revision of this repository, or the workspace is not under Git"))?;
    let mut out = std::collections::BTreeMap::new();
    for p in list.lines().filter(|p| workspace_file(p)) {
        if let Some(text) = git(root, &["show", &format!("{rev}:./{p}")]) {
            out.insert(p.to_string(), text);
        }
    }
    Ok(out)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct GitCommit {
    pub hash: String,
    pub subject: String,
    pub date: String,
}

/// Recent commits that touched the workspace.
pub fn git_log(root: &Path, limit: usize) -> Vec<GitCommit> {
    git(root, &["log", &format!("-n{}", limit.min(200)), "--format=%h%x1f%s%x1f%cs", "--", "."])
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let mut p = l.split('\x1f');
            Some(GitCommit { hash: p.next()?.to_string(), subject: p.next()?.to_string(), date: p.next()?.to_string() })
        })
        .collect()
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SearchHit {
    pub path: String,
    pub snippet: String,
}

/// Full-text index over the workspace files. A cache: it can be deleted at any time and is rebuilt from the files.
pub struct SearchIndex {
    conn: Connection,
}

impl SearchIndex {
    pub fn open(db: Option<&Path>) -> Result<Self> {
        let conn = match db {
            Some(p) => {
                if let Some(dir) = p.parent() {
                    fs::create_dir_all(dir).map_err(err)?;
                }
                Connection::open(p)
            }
            None => Connection::open_in_memory(),
        }
        .map_err(err)?;
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(path UNINDEXED, body, tokenize='unicode61 remove_diacritics 2');
             CREATE TABLE IF NOT EXISTS seen(path TEXT PRIMARY KEY, hash INTEGER NOT NULL);",
        )
        .map_err(err)?;
        Ok(Self { conn })
    }

    fn hash(s: &str) -> i64 {
        // FNV-1a: only used to skip unchanged files.
        let mut h: u64 = 0xcbf29ce484222325;
        for b in s.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        h as i64
    }

    /// Bring the index in line with the files. Returns how many documents were (re)indexed.
    pub fn sync(&mut self, files: &BTreeMap<String, String>) -> Result<usize> {
        let tx = self.conn.transaction().map_err(err)?;
        let mut changed = 0;
        {
            let mut known: BTreeMap<String, i64> = BTreeMap::new();
            let mut stmt = tx.prepare("SELECT path, hash FROM seen").map_err(err)?;
            for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(err)? {
                let (p, h) = row.map_err(err)?;
                known.insert(p, h);
            }
            for (path, body) in files {
                let h = Self::hash(body);
                if known.remove(path) == Some(h) {
                    continue;
                }
                tx.execute("DELETE FROM docs WHERE path = ?1", params![path]).map_err(err)?;
                tx.execute("INSERT INTO docs(path, body) VALUES (?1, ?2)", params![path, body]).map_err(err)?;
                tx.execute("INSERT OR REPLACE INTO seen(path, hash) VALUES (?1, ?2)", params![path, h]).map_err(err)?;
                changed += 1;
            }
            for path in known.keys() {
                tx.execute("DELETE FROM docs WHERE path = ?1", params![path]).map_err(err)?;
                tx.execute("DELETE FROM seen WHERE path = ?1", params![path]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)?;
        Ok(changed)
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        // Quote each term so user input is never parsed as FTS syntax; the last term is a prefix match.
        let terms: Vec<String> = query.split_whitespace().map(|t| format!("\"{}\"", t.replace('"', ""))).collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let q = format!("{}*", terms.join(" "));
        let mut stmt = self
            .conn
            .prepare("SELECT path, snippet(docs, 1, '[', ']', '…', 12) FROM docs WHERE docs MATCH ?1 ORDER BY rank LIMIT ?2")
            .map_err(err)?;
        let rows = stmt
            .query_map(params![q, limit as i64], |r| Ok(SearchHit { path: r.get(0)?, snippet: r.get(1)? }))
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_workspace_files_and_writes_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(root, "vastitecture.yaml", "name: Shop\n").unwrap();
        write_file(root, "model/elements/c4/container/web.yaml", "id: a\nname: Web\n").unwrap();
        write_file(root, "views/c4/context.yaml", "id: v\n").unwrap();
        write_file(root, "adrs/0001-use-yaml.md", "# hi\n").unwrap();
        fs::write(root.join("README.md"), "ignored").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "ignored").unwrap();
        let files = read_all(root).unwrap();
        assert_eq!(
            files.keys().cloned().collect::<Vec<_>>(),
            vec!["adrs/0001-use-yaml.md", "model/elements/c4/container/web.yaml", "vastitecture.yaml", "views/c4/context.yaml"]
        );
        assert!(!root.join("model/elements/c4/container/.web.yaml.tmp").exists());

        remove_file(root, "model/elements/c4/container/web.yaml").unwrap();
        assert!(!root.join("model").exists(), "empty directories are pruned");
        assert!(root.join("views").exists());
    }

    #[test]
    fn refuses_paths_that_escape_the_workspace() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write_file(dir.path(), "../evil.yaml", "x").is_err());
        assert!(write_file(dir.path(), "/etc/evil.yaml", "x").is_err());
        assert!(remove_file(dir.path(), "model/../../x").is_err());
    }

    #[test]
    fn search_index_is_incremental_and_safe_against_fts_syntax() {
        let mut idx = SearchIndex::open(None).unwrap();
        let mut files = BTreeMap::new();
        files.insert("model/elements/a.yaml".to_string(), "name: Order Service\ndescription: Accepts customer orders".to_string());
        files.insert("model/elements/b.yaml".to_string(), "name: Payment Gateway".to_string());
        assert_eq!(idx.sync(&files).unwrap(), 2);
        assert_eq!(idx.sync(&files).unwrap(), 0);
        assert_eq!(idx.search("ord", 10).unwrap()[0].path, "model/elements/a.yaml");
        assert_eq!(idx.search("payment gate", 10).unwrap().len(), 1);
        assert!(idx.search("\"unbalanced AND (", 10).is_ok());
        files.remove("model/elements/b.yaml");
        files.insert("model/elements/a.yaml".to_string(), "name: Ordering".to_string());
        assert_eq!(idx.sync(&files).unwrap(), 1);
        assert!(idx.search("payment", 10).unwrap().is_empty());
        assert!(idx.search("customer", 10).unwrap().is_empty());
    }

    #[test]
    fn git_files_at_reads_a_committed_workspace_and_refuses_options() {
        let dir = std::env::temp_dir().join(format!("vast-git-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("ws/model/elements/c4/container")).unwrap();
        let run = |args: &[&str]| assert!(Command::new("git").arg("-C").arg(&dir).args(args).output().unwrap().status.success(), "git {args:?}");
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@example.com"]);
        run(&["config", "user.name", "t"]);
        fs::write(dir.join("ws/vastitecture.yaml"), "format: 1\nname: A\n").unwrap();
        fs::write(dir.join("ws/model/elements/c4/container/api.yaml"), "id: x\n").unwrap();
        fs::write(dir.join("ws/notes.txt"), "not part of the model").unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "first"]);
        fs::write(dir.join("ws/vastitecture.yaml"), "format: 1\nname: B\n").unwrap();
        let ws = dir.join("ws");
        let files = git_files_at(&ws, "HEAD").unwrap();
        assert_eq!(files.keys().collect::<Vec<_>>(), vec!["model/elements/c4/container/api.yaml", "vastitecture.yaml"]);
        assert_eq!(files["vastitecture.yaml"], "format: 1\nname: A\n");
        assert!(git_files_at(&ws, "--output=/tmp/x").is_err());
        assert!(git_files_at(&ws, "HEAD..main").is_err());
        assert_eq!(git_log(&ws, 5).iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), vec!["first"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_status_reports_changes_or_no_repo() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(!git_status(root).is_repo);
        if Command::new("git").arg("-C").arg(root).arg("init").arg("-q").status().map(|s| s.success()).unwrap_or(false) {
            write_file(root, "vastitecture.yaml", "name: x\n").unwrap();
            let info = git_status(root);
            assert!(info.is_repo);
            assert_eq!(info.files, vec![GitFile { status: "??".into(), path: "vastitecture.yaml".into() }]);
        }
    }
}

#[derive(Serialize, Debug)]
pub struct PluginFolder {
    /// Absolute folder path.
    pub dir: String,
    /// Raw plugin.json contents; parsed and validated by the host in TypeScript.
    pub manifest: String,
    /// "user" for ~/.vastitecture/plugins, "workspace" for <workspace>/.vastitecture/plugins.
    pub source: String,
}

/// Find plugin folders (those containing a plugin.json) directly under `dir`.
pub fn list_plugins(dir: &Path, source: &str) -> Vec<PluginFolder> {
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<PluginFolder> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let manifest = fs::read_to_string(e.path().join("plugin.json")).ok()?;
            Some(PluginFolder { dir: e.path().to_string_lossy().to_string(), manifest, source: source.to_string() })
        })
        .collect();
    out.sort_by(|a, b| a.dir.cmp(&b.dir));
    out
}

/// Read one file from inside a plugin folder. Nothing outside the folder is reachable.
pub fn read_plugin_file(plugin_dir: &Path, rel: &str) -> Result<String> {
    fs::read_to_string(resolve(plugin_dir, rel.trim_start_matches("./"))?).map_err(err)
}

#[cfg(test)]
mod plugin_tests {
    use super::*;

    #[test]
    fn lists_plugin_folders_and_confines_reads() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("hello")).unwrap();
        fs::create_dir_all(dir.path().join("not-a-plugin")).unwrap();
        fs::write(dir.path().join("hello/plugin.json"), "{\"id\":\"hello\"}").unwrap();
        fs::write(dir.path().join("hello/index.js"), "export default {}").unwrap();
        let found = list_plugins(dir.path(), "user");
        assert_eq!(found.len(), 1);
        assert_eq!(read_plugin_file(Path::new(&found[0].dir), "./index.js").unwrap(), "export default {}");
        assert!(read_plugin_file(Path::new(&found[0].dir), "../not-a-plugin/x").is_err());
    }
}

/// Only read-only AWS CLI operations may run: describe-*, list-* and sts get-caller-identity.
pub fn aws_read_only(service: &str, operation: &str) -> bool {
    let word = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    word(service)
        && word(operation)
        && (operation.starts_with("describe-") || operation.starts_with("list-") || (service == "sts" && operation == "get-caller-identity"))
}

/// Run one read-only AWS CLI call with the user's local profile and return its JSON output.
pub fn aws_cli(service: &str, operation: &str, profile: Option<&str>, region: Option<&str>) -> Result<String> {
    if !aws_read_only(service, operation) {
        return Err(format!("Refusing AWS operation {service} {operation}: only read-only describe-/list- calls are allowed"));
    }
    let profile_ok = |s: &str| s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    let mut cmd = Command::new("aws");
    cmd.args([service, operation, "--output", "json", "--no-cli-pager"]);
    if let Some(p) = profile.filter(|p| !p.is_empty()) {
        if !profile_ok(p) {
            return Err("Invalid profile name".into());
        }
        cmd.args(["--profile", p]);
    }
    if let Some(r) = region.filter(|r| !r.is_empty()) {
        if !profile_ok(r) {
            return Err("Invalid region".into());
        }
        cmd.args(["--region", r]);
    }
    let out = cmd.output().map_err(|e| format!("Could not run the AWS CLI ({e}). Is it installed and on PATH?"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(test)]
mod aws_tests {
    use super::*;

    #[test]
    fn only_read_only_aws_calls_are_allowed() {
        assert!(aws_read_only("ec2", "describe-instances"));
        assert!(aws_read_only("lambda", "list-functions"));
        assert!(aws_read_only("sts", "get-caller-identity"));
        assert!(!aws_read_only("ec2", "terminate-instances"));
        assert!(!aws_read_only("s3", "rm"));
        assert!(!aws_read_only("iam", "get-caller-identity"));
        assert!(!aws_read_only("ec2", "describe-instances --dry-run"));
        assert!(!aws_read_only("ec2;rm", "describe-x"));
        assert!(aws_cli("ec2", "run-instances", None, None).is_err());
    }
}

/// Open a directory in the platform's file manager (Finder, Explorer, or the desktop's default).
pub fn reveal_folder(path: &Path) -> Result<()> {
    if !path.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    Command::new(program).arg(path).spawn().map(|_| ()).map_err(|e| format!("Could not open the folder: {e}"))
}

/// Read-only cloud CLI calls for discovery. Only listing and describing verbs are accepted, flags come
/// from a short allow-list, and every value is restricted to a safe character set, so no plugin or
/// connector can make the user's cloud login change anything.
pub fn cloud_read_only(tool: &str, args: &[String]) -> Result<()> {
    let word = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    // kubectl takes a comma-separated resource list: `get deployments,services`.
    let resources = |s: &str| !s.is_empty() && s.len() <= 200 && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == ',' || c == '.');
    if tool == "kubectl" {
        return if args.len() == 2 && args[0] == "get" && resources(&args[1]) && !args[1].split(',').any(|r| r.starts_with("secret")) {
            Ok(())
        } else {
            Err(format!("Refusing kubectl {}: only `kubectl get <resources>` (never secrets) is allowed", args.join(" ")))
        };
    }
    if args.is_empty() || args.len() > 6 || !args.iter().all(|a| word(a)) {
        return Err(format!("Refusing {tool} command: arguments must be plain lowercase words"));
    }
    let verb = args.last().unwrap().as_str();
    let ok = match tool {
        "aws" => args.len() == 2 && (verb.starts_with("describe-") || verb.starts_with("list-") || (args[0] == "sts" && verb == "get-caller-identity")),
        "gcloud" => matches!(verb, "list" | "describe") || args == ["config", "get-value", "project"],
        "az" => matches!(verb, "list" | "show"),
        _ => return Err(format!("Unknown cloud CLI {tool}")),
    };
    if ok { Ok(()) } else { Err(format!("Refusing {tool} {}: only read-only list/describe/show commands are allowed", args.join(" "))) }
}

/// Run one read-only cloud CLI command with the user's own login and return its JSON output.
/// `flags` are (name, value) pairs such as ("--profile", "dev"); names must be on the tool's allow-list.
pub fn cloud_cli(tool: &str, args: &[String], flags: &[(String, String)]) -> Result<String> {
    cloud_read_only(tool, args)?;
    let allowed: &[&str] = match tool {
        "aws" => &["--profile", "--region"],
        "gcloud" => &["--project"],
        "az" => &["--subscription"],
        "kubectl" => &["--context", "--namespace"],
        _ => &[],
    };
    let safe = |s: &str| !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || " -_.".contains(c));
    let mut cmd = Command::new(if cfg!(windows) && (tool == "gcloud" || tool == "az") { format!("{tool}.cmd") } else { tool.to_string() });
    cmd.args(args);
    match tool {
        "aws" => cmd.args(["--output", "json", "--no-cli-pager"]),
        "gcloud" => cmd.args(["--format=json", "--quiet"]),
        "kubectl" => {
            if !flags.iter().any(|(n, v)| n == "--namespace" && !v.is_empty()) {
                cmd.arg("--all-namespaces");
            }
            cmd.args(["-o", "json", "--request-timeout=20s"])
        }
        _ => cmd.args(["-o", "json", "--only-show-errors"]),
    };
    for (name, value) in flags {
        if value.is_empty() {
            continue;
        }
        if !allowed.contains(&name.as_str()) || !safe(value) {
            return Err(format!("Refusing flag {name} for {tool}"));
        }
        cmd.args([name.as_str(), value.as_str()]);
    }
    let out = cmd.output().map_err(|e| format!("Could not run {tool} ({e}). Is it installed, on PATH, and signed in?"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(test)]
mod cloud_tests {
    use super::*;
    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn kubectl_may_only_get_non_secret_resources() {
        assert!(cloud_read_only("kubectl", &a(&["get", "deployments,statefulsets,services,ingresses.networking.k8s.io"])).is_ok());
        assert!(cloud_read_only("kubectl", &a(&["get", "secrets"])).is_err());
        assert!(cloud_read_only("kubectl", &a(&["get", "pods,secret"])).is_err());
        assert!(cloud_read_only("kubectl", &a(&["delete", "pods"])).is_err());
        assert!(cloud_read_only("kubectl", &a(&["get", "pods", "--kubeconfig=/x"])).is_err());
        assert!(cloud_read_only("kubectl", &a(&["get", "pods;rm"])).is_err());
    }

    #[test]
    fn only_read_only_cloud_commands_are_allowed() {
        assert!(cloud_read_only("gcloud", &a(&["compute", "instances", "list"])).is_ok());
        assert!(cloud_read_only("gcloud", &a(&["config", "get-value", "project"])).is_ok());
        assert!(cloud_read_only("az", &a(&["network", "vnet", "list"])).is_ok());
        assert!(cloud_read_only("az", &a(&["account", "show"])).is_ok());
        assert!(cloud_read_only("aws", &a(&["ec2", "describe-vpcs"])).is_ok());
        assert!(cloud_read_only("gcloud", &a(&["compute", "instances", "delete"])).is_err());
        assert!(cloud_read_only("gcloud", &a(&["config", "set", "project"])).is_err());
        assert!(cloud_read_only("az", &a(&["vm", "delete"])).is_err());
        assert!(cloud_read_only("az", &a(&["group", "list;rm"])).is_err());
        assert!(cloud_read_only("az", &a(&["vm", "list", "--query"])).is_err());
        assert!(cloud_read_only("terraform", &a(&["show"])).is_err());
        assert!(cloud_cli("az", &a(&["vm", "list"]), &[("--resource-group".into(), "x".into())]).is_err());
        assert!(cloud_cli("gcloud", &a(&["compute", "instances", "list"]), &[("--project".into(), "a;b".into())]).is_err());
    }
}
