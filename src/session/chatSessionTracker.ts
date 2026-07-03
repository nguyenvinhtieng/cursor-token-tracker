import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

function slugifyWorkspaceFolder(folder: string): string {
  // Cursor stores project slugs like: Users-nguyenvinhtieng-vn-Documents-smilegate-analysis-token
  return folder.replace(/^[/\\]+/, '').replace(/[/\\:.]/g, '-');
}

function getTranscriptDirForWorkspace(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  const slug = slugifyWorkspaceFolder(folders[0].uri.fsPath);
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

  // Try to find by partial match in projects dir
  const projectsDir = path.join(home, '.cursor', 'projects');
  if (fs.existsSync(projectsDir)) {
    const workspaceName = path.basename(folders[0].uri.fsPath).toLowerCase();
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
  private watcher: vscode.FileSystemWatcher | undefined;
  private activeTranscript: string | undefined;
  private onSessionChange: (() => void) | undefined;
  private onActivity: (() => void) | undefined;
  private activityDebounce: NodeJS.Timeout | undefined;
  private lastActivityMs = 0;

  constructor() {
    // Track spend from extension activation until a transcript session is detected.
    this.sessionStartMs = Date.now() - 30 * 60 * 1000;
  }

  getSessionStartMs(): number {
    return this.sessionStartMs;
  }

  isChatActive(): boolean {
    if (!this.activeTranscript) {
      return false;
    }
    return Date.now() - this.lastActivityMs < 5 * 60 * 1000;
  }

  reset(): void {
    this.sessionStartMs = Date.now();
    this.activeTranscript = undefined;
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
    const transcriptDir = getTranscriptDirForWorkspace();
    if (!transcriptDir) {
      return;
    }

    const pattern = new vscode.RelativePattern(transcriptDir, '**/*.jsonl');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

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

    this.watcher.onDidCreate(handleCreate);
    this.watcher.onDidChange(handleChange);

    const current = findNewestTranscript(transcriptDir);
    if (current) {
      this.activeTranscript = current.path;
      this.sessionStartMs = current.startMs;
    }
  }

  stopWatching(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  dispose(): void {
    if (this.activityDebounce) {
      clearTimeout(this.activityDebounce);
    }
    this.stopWatching();
  }
}
