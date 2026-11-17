import type { Workspace } from "./model";
import { fromFiles, isWorkspacePath, toFiles, type FileMap, type LoadIssue, type PathIndex } from "./serialize";

/** Minimal filesystem abstraction over a workspace folder. Paths are '/'-separated and relative to the root. */
export interface WorkspaceFS {
  /** Human-readable location, shown in the title bar. */
  readonly label: string;
  /** Read every workspace-format file under the root. */
  readAll(): Promise<FileMap>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Notify when files change outside the app. Optional. */
  watch?(onChange: () => void): () => void;
}

export class MemoryFS implements WorkspaceFS {
  label = "memory";
  private watchers = new Set<() => void>();
  constructor(public files: FileMap = {}) {}
  async readAll() {
    return { ...this.files };
  }
  async write(path: string, content: string) {
    this.files[path] = content;
  }
  async remove(path: string) {
    delete this.files[path];
  }
  watch(cb: () => void) {
    this.watchers.add(cb);
    return () => void this.watchers.delete(cb);
  }
  /** Simulate an outside edit (tests, git pull). */
  externalWrite(path: string, content: string | null) {
    if (content === null) delete this.files[path];
    else this.files[path] = content;
    for (const w of this.watchers) w();
  }
}

export interface ExternalChange {
  workspace: Workspace;
  issues: LoadIssue[];
  /** Paths changed on disk that also have unsaved local edits. */
  conflicts: { path: string; ours: string | undefined; theirs: string | undefined; base: string | undefined }[];
}

/**
 * Keeps a folder in sync with the model: writes only changed files, ignores its own echoes,
 * and detects outside edits (and conflicts with unsaved local changes).
 */
export class Persister {
  /** Last content known to be on disk, per path. */
  private disk: FileMap = {};
  private index: PathIndex = {};

  constructor(public fs: WorkspaceFS) {}

  async load(): Promise<{ workspace: Workspace; issues: LoadIssue[] }> {
    const files = await this.fs.readAll();
    const { workspace, index, issues } = fromFiles(files);
    this.disk = Object.fromEntries(Object.entries(files).filter(([p]) => isWorkspacePath(p)));
    this.index = index;
    return { workspace, issues };
  }

  /** Write the files that differ from disk. Returns the changed paths. */
  async save(ws: Workspace): Promise<string[]> {
    const { files, index } = toFiles(ws, this.index);
    const changed: string[] = [];
    for (const [path, content] of Object.entries(files)) {
      if (this.disk[path] !== content) {
        await this.fs.write(path, content);
        changed.push(path);
      }
    }
    for (const path of Object.keys(this.disk)) {
      if (!(path in files)) {
        await this.fs.remove(path);
        changed.push(path);
      }
    }
    this.disk = files;
    this.index = index;
    return changed;
  }

  /**
   * Compare the folder with what we last wrote. Returns undefined when nothing changed outside
   * (including our own write echoes). `current` is the in-memory workspace, used to detect conflicts.
   */
  async checkExternal(current: Workspace): Promise<ExternalChange | undefined> {
    const onDisk = await this.fs.readAll();
    const theirs: FileMap = Object.fromEntries(Object.entries(onDisk).filter(([p]) => isWorkspacePath(p)));
    const paths = new Set([...Object.keys(theirs), ...Object.keys(this.disk)]);
    const changedOutside = [...paths].filter((p) => theirs[p] !== this.disk[p]);
    if (!changedOutside.length) return undefined;

    const ours = toFiles(current, this.index).files;
    const conflicts = changedOutside
      .filter((p) => ours[p] !== this.disk[p] && ours[p] !== theirs[p])
      .map((path) => ({ path, ours: ours[path], theirs: theirs[path], base: this.disk[path] }));

    // Outside changes win for files we have not touched; unsaved local edits to other files are kept.
    const merged: FileMap = { ...ours };
    for (const p of changedOutside) {
      if (conflicts.some((c) => c.path === p)) continue;
      if (theirs[p] === undefined) delete merged[p];
      else merged[p] = theirs[p];
    }
    const { workspace, index, issues } = fromFiles(merged);
    this.disk = theirs;
    this.index = { ...this.index, ...index };
    return { workspace, issues, conflicts };
  }

  /** The workspace with one file's content replaced; used to take "theirs" when resolving a conflict. */
  withFile(current: Workspace, path: string, content: string | undefined): Workspace {
    const { files } = toFiles(current, this.index);
    if (content === undefined) delete files[path];
    else files[path] = content;
    const r = fromFiles(files);
    this.index = { ...this.index, ...r.index };
    return r.workspace;
  }
}
