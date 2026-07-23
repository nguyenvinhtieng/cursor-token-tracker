import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

function slugifyWorkspaceFolder(folder: string): string {
  // Cursor stores project slugs like: Users-nguyenvinhtieng-vn-Documents-smilegate-analysis-token
  return folder.replace(/^[/\\]+/, '').replace(/[/\\:.]/g, '-');
}

export interface WorkspaceTranscriptDir {
  name: string;
  folderPath: string;
  dir: string;
}

export function getTranscriptDirForFolder(folderPath: string): string | undefined {
  const slug = slugifyWorkspaceFolder(folderPath);
  const home = os.homedir();
  const candidates = [
    path.join(home, '.cursor', 'projects', slug, 'agent-transcripts'),
    path.join(home, '.cursor', 'projects', slug.replace(/-/g, '_'), 'agent-transcripts'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }

  const projectsDir = path.join(home, '.cursor', 'projects');
  if (fs.existsSync(projectsDir)) {
    const workspaceName = path.basename(folderPath).toLowerCase();
    for (const entry of fs.readdirSync(projectsDir)) {
      if (entry.toLowerCase().includes(workspaceName)) {
        const transcriptDir = path.join(projectsDir, entry, 'agent-transcripts');
        if (fs.existsSync(transcriptDir)) {
          return transcriptDir;
        }
      }
    }
  }

  return undefined;
}

export function getTranscriptDirForWorkspace(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return getTranscriptDirForFolder(folders[0].uri.fsPath);
}

export function getTranscriptDirsForAllWorkspaces(): WorkspaceTranscriptDir[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [];
  }

  const result: WorkspaceTranscriptDir[] = [];
  for (const folder of folders) {
    const dir = getTranscriptDirForFolder(folder.uri.fsPath);
    if (dir) {
      result.push({ name: folder.name, folderPath: folder.uri.fsPath, dir });
    }
  }
  return result;
}

function getFileBirthTimeMs(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    const birth = stat.birthtimeMs;
    if (birth > 0) {
      return birth;
    }
    return stat.mtimeMs;
  } catch {
    return Date.now();
  }
}

function findNewestTranscript(transcriptDir: string): { path: string; startMs: number } | undefined {
  if (!fs.existsSync(transcriptDir)) {
    return undefined;
  }

  let newest: { path: string; startMs: number; mtime: number } | undefined;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.jsonl')) {
        const mtime = fs.statSync(full).mtimeMs;
        if (!newest || mtime > newest.mtime) {
          newest = { path: full, startMs: getFileBirthTimeMs(full), mtime };
        }
      }
    }
  };

  walk(transcriptDir);
  return newest ? { path: newest.path, startMs: newest.startMs } : undefined;
}

export class ChatSessionTracker implements vscode.Disposable {
  private sessionStartMs: number;
  private watchers: vscode.FileSystemWatcher[] = [];
  private activeTranscript: string | undefined;
  private onSessionChange: (() => void) | undefined;
  private onActivity: (() => void) | undefined;
  private activityDebounce: NodeJS.Timeout | undefined;
  private lastActivityMs = 0;

  constructor() {
    this.sessionStartMs = Date.now();
  }

  getSessionStartMs(): number {
    return this.sessionStartMs;
  }

  getActiveTranscriptPath(): string | undefined {
    return this.activeTranscript;
  }

  isChatActive(): boolean {
    if (!this.activeTranscript) {
      return false;
    }
    return Date.now() - this.lastActivityMs < 5 * 60 * 1000;
  }

  reset(): void {
    // Keep the active transcript so thread attribution still works; only count
    // billing events after this point toward the session total.
    this.sessionStartMs = Date.now();
    this.lastActivityMs = 0;
  }

  setOnSessionChange(callback: () => void): void {
    this.onSessionChange = callback;
  }

  setOnActivity(callback: () => void): void {
    this.onActivity = callback;
  }

  startWatching(): void {
    this.stopWatching();
    const workspaceDirs = getTranscriptDirsForAllWorkspaces();
    if (workspaceDirs.length === 0) {
      return;
    }

    const watchers: vscode.FileSystemWatcher[] = [];
    for (const { dir } of workspaceDirs) {
      const pattern = new vscode.RelativePattern(dir, '**/*.jsonl');
      watchers.push(vscode.workspace.createFileSystemWatcher(pattern));
    }
    this.watchers = watchers;

    const notifyActivity = () => {
      this.lastActivityMs = Date.now();
      if (this.activityDebounce) {
        clearTimeout(this.activityDebounce);
      }
      this.activityDebounce = setTimeout(() => {
        this.onActivity?.();
      }, 3000);
    };

    const handleCreate = (uri: vscode.Uri) => {
      const filePath = uri.fsPath;
      const birthMs = getFileBirthTimeMs(filePath);
      const isNewSession = this.activeTranscript !== filePath;
      this.activeTranscript = filePath;
      this.sessionStartMs = birthMs;
      this.lastActivityMs = Date.now();
      if (isNewSession) {
        this.onSessionChange?.();
      }
      notifyActivity();
    };

    const handleChange = (uri: vscode.Uri) => {
      const filePath = uri.fsPath;
      const birthMs = getFileBirthTimeMs(filePath);
      if (this.activeTranscript !== filePath) {
        this.activeTranscript = filePath;
        this.sessionStartMs = birthMs;
        this.onSessionChange?.();
      }
      notifyActivity();
    };

    for (const w of watchers) {
      w.onDidCreate(handleCreate);
      w.onDidChange(handleChange);
    }

    let newest: { path: string; startMs: number; mtime: number } | undefined;
    for (const { dir } of workspaceDirs) {
      const current = findNewestTranscript(dir);
      if (current) {
        const mtime = fs.statSync(current.path).mtimeMs;
        if (!newest || mtime > newest.mtime) {
          newest = { path: current.path, startMs: current.startMs, mtime };
        }
      }
    }
    if (newest) {
      this.activeTranscript = newest.path;
      this.sessionStartMs = newest.startMs;
    }
  }

  stopWatching(): void {
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
  }

  dispose(): void {
    if (this.activityDebounce) {
      clearTimeout(this.activityDebounce);
    }
    this.stopWatching();
  }
}
