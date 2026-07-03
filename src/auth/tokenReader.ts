import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildSessionCookie, describeTokenSource } from './sessionToken';

const TOKEN_KEY = 'cursorAuth/accessToken';
const SECRET_KEY = 'cursorUsage.sessionToken';

export interface TokenDiagnostics {
  dbPath: string;
  dbExists: boolean;
  sqlite3Available: boolean;
  rawTokenFound: boolean;
  rawTokenSource: string;
  sessionCookieBuilt: boolean;
  tokenDescription: string;
  keychainTried: boolean;
  error?: string;
}

export function getCursorStateDbPath(): string {
  const configPath = vscode.workspace.getConfiguration('cursorUsage').get<string>('stateDbPath');
  if (configPath && configPath.trim()) {
    return configPath.trim();
  }

  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    case 'win32':
      return path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    default:
      return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
}

function isSqlite3Available(): boolean {
  try {
    execFileSync('sqlite3', ['-version'], { encoding: 'utf8', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function readRawTokenFromDb(dbPath: string): string | undefined {
  if (!fs.existsSync(dbPath)) {
    return undefined;
  }

  const uri = `file:${dbPath}?mode=ro&immutable=1`;
  const sql = `SELECT value FROM ItemTable WHERE key='${TOKEN_KEY}';`;

  try {
    const output = execFileSync('sqlite3', [uri, sql], { encoding: 'utf8', timeout: 5000 });
    const token = output.trim();
    return token || undefined;
  } catch {
    // Fallback without immutable URI (older sqlite3 builds)
    try {
      const output = execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8', timeout: 5000 });
      const token = output.trim();
      return token || undefined;
    } catch (err) {
      console.error('[cursor-usage] Failed to read token from state.vscdb:', err);
      return undefined;
    }
  }
}

function readRawTokenFromKeychain(): string | undefined {
  if (process.platform !== 'darwin') {
    return undefined;
  }

  try {
    const output = execFileSync(
      'security',
      ['find-generic-password', '-s', 'cursor-access-token', '-w'],
      { encoding: 'utf8', timeout: 5000 },
    );
    const token = output.trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

function readRawTokenFromDbOrKeychain(): { token?: string; source: string; keychainTried: boolean } {
  const dbToken = readRawTokenFromDb(getCursorStateDbPath());
  if (dbToken) {
    return { token: dbToken, source: 'state.vscdb', keychainTried: false };
  }

  const keychainToken = readRawTokenFromKeychain();
  return {
    token: keychainToken,
    source: keychainToken ? 'macOS keychain' : 'none',
    keychainTried: process.platform === 'darwin',
  };
}

export class TokenReader {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async diagnose(): Promise<TokenDiagnostics> {
    const dbPath = getCursorStateDbPath();
    const sqlite3Available = isSqlite3Available();
    const manualRaw = await this.secrets.get(SECRET_KEY);

    let rawToken: string | undefined;
    let rawTokenSource = 'none';
    let keychainTried = false;

    const config = vscode.workspace.getConfiguration('cursorUsage');
    if (config.get<boolean>('autoDetectToken', true)) {
      const detected = readRawTokenFromDbOrKeychain();
      rawToken = detected.token;
      rawTokenSource = detected.source;
      keychainTried = detected.keychainTried;
    }

    if (!rawToken && manualRaw) {
      rawToken = manualRaw;
      rawTokenSource = 'manual (SecretStorage)';
    }

    const sessionCookie = rawToken ? buildSessionCookie(rawToken) : undefined;

    return {
      dbPath,
      dbExists: fs.existsSync(dbPath),
      sqlite3Available,
      rawTokenFound: Boolean(rawToken),
      rawTokenSource,
      sessionCookieBuilt: Boolean(sessionCookie),
      tokenDescription: rawToken ? describeTokenSource(rawToken) : 'not found',
      keychainTried,
      error: rawToken && !sessionCookie ? 'Token found but could not build sub::jwt cookie' : undefined,
    };
  }

  async getToken(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('cursorUsage');
    const autoDetect = config.get<boolean>('autoDetectToken', true);

    if (autoDetect) {
      const detected = readRawTokenFromDbOrKeychain();
      if (detected.token) {
        const cookie = buildSessionCookie(detected.token);
        if (cookie) {
          return cookie;
        }
      }
    }

    const manual = await this.secrets.get(SECRET_KEY);
    if (manual) {
      return buildSessionCookie(manual);
    }

    return undefined;
  }

  async setManualToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY, token.trim());
  }

  async clearManualToken(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }
}
