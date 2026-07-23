import * as fs from 'fs';
import * as path from 'path';
import { UsageEvent } from '../api/types';
import { PeriodTotals, parseEventCostDollars, parseEventTokens } from '../metrics/format';
import {
  getTranscriptDirsForAllWorkspaces,
} from './chatSessionTracker';

// Billing events carry no thread id, so cost is attributed to threads by
// timestamp: an event belongs to the thread whose active time-range covers it.
// This is an approximation — accurate enough for a per-thread breakdown, but it
// cannot separate two threads that were genuinely active at the same instant.

const ATTRIBUTION_BUFFER_MS = 2 * 60 * 1000; // billing events lag behind activity

export interface ThreadUsage {
  id: string;
  filePath: string;
  title: string;
  workspaceName?: string;
  startMs: number;
  lastActivityMs: number;
  cost: number;
  tokens: number;
  eventCount: number;
  models: string[];
}

interface ThreadMeta {
  id: string;
  filePath: string;
  title: string;
  startMs: number;
  lastActivityMs: number;
  workspaceName?: string;
}

function getFileBirthTimeMs(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
  } catch {
    return Date.now();
  }
}

function extractTitle(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      const entry = JSON.parse(line) as { role?: string; message?: { content?: unknown } };
      if (entry.role !== 'user') {
        continue;
      }
      const text = flattenContent(entry.message?.content);
      const title = cleanTitle(text);
      if (title) {
        return title;
      }
    }
  } catch {
    // fall through to default
  }
  return 'Untitled chat';
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join(' ');
  }
  return '';
}

function cleanTitle(raw: string): string {
  let text = raw;
  const query = /<user_query>([\s\S]*?)<\/user_query>/i.exec(text);
  if (query) {
    text = query[1];
  }
  text = text
    .replace(/<[^>]+>/g, ' ') // strip any remaining tags (timestamp, etc.)
    .replace(/@\/\S+/g, ' ') // strip @file mentions
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return '';
  }
  return text.length > 64 ? `${text.slice(0, 64)}…` : text;
}

function listThreadMeta(transcriptDir: string): ThreadMeta[] {
  const threads: ThreadMeta[] = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.jsonl')) {
        let mtimeMs: number;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          continue;
        }
        threads.push({
          id: path.basename(entry.name, '.jsonl'),
          filePath: full,
          title: extractTitle(full),
          startMs: getFileBirthTimeMs(full),
          lastActivityMs: mtimeMs,
        });
      }
    }
  };

  walk(transcriptDir);
  return threads;
}

function attributeEvent(threads: ThreadMeta[], eventMs: number): ThreadMeta | undefined {
  let best: ThreadMeta | undefined;
  for (const thread of threads) {
    if (eventMs >= thread.startMs && eventMs <= thread.lastActivityMs + ATTRIBUTION_BUFFER_MS) {
      // Prefer the most recently started thread that still contains the event.
      if (!best || thread.startMs > best.startMs) {
        best = thread;
      }
    }
  }
  return best;
}

export function listAllThreadMeta(): ThreadMeta[] {
  const workspaces = getTranscriptDirsForAllWorkspaces();
  const threads: ThreadMeta[] = [];
  for (const ws of workspaces) {
    for (const thread of listThreadMeta(ws.dir)) {
      threads.push({ ...thread, workspaceName: ws.name });
    }
  }
  return threads;
}

export function findTranscriptPathForEvent(event: UsageEvent): string | undefined {
  const eventMs = parseInt(event.timestamp, 10);
  if (Number.isNaN(eventMs)) {
    return undefined;
  }
  return attributeEvent(listAllThreadMeta(), eventMs)?.filePath;
}

export interface WorkspaceUsageBreakdown {
  name: string;
  cost: number;
  tokens: number;
  eventCount: number;
}

export function buildWorkspaceBreakdown(events: UsageEvent[], sinceMs = 0): WorkspaceUsageBreakdown[] {
  const workspaces = getTranscriptDirsForAllWorkspaces();
  if (workspaces.length === 0) {
    return [];
  }

  const totals = new Map<string, WorkspaceUsageBreakdown>();
  for (const ws of workspaces) {
    totals.set(ws.name, { name: ws.name, cost: 0, tokens: 0, eventCount: 0 });
  }

  for (const event of events) {
    const eventMs = parseInt(event.timestamp, 10);
    if (Number.isNaN(eventMs) || eventMs < sinceMs) {
      continue;
    }
    const owner = attributeEvent(listAllThreadMeta(), eventMs);
    if (!owner?.workspaceName) {
      continue;
    }
    const row = totals.get(owner.workspaceName);
    if (!row) {
      continue;
    }
    row.cost += parseEventCostDollars(event);
    row.tokens += parseEventTokens(event);
    row.eventCount += 1;
  }

  return [...totals.values()].filter((w) => w.eventCount > 0).sort((a, b) => b.cost - a.cost);
}

export function computeThreadTotalsForPath(
  events: UsageEvent[],
  transcriptPath: string,
  sinceMs = 0,
): PeriodTotals {
  const allMeta = listAllThreadMeta();
  if (!allMeta.some((t) => t.filePath === transcriptPath)) {
    return { cost: 0, tokens: 0, eventCount: 0 };
  }

  const totals: PeriodTotals = { cost: 0, tokens: 0, eventCount: 0 };
  for (const event of events) {
    const eventMs = parseInt(event.timestamp, 10);
    if (Number.isNaN(eventMs) || eventMs < sinceMs) {
      continue;
    }
    const owner = attributeEvent(allMeta, eventMs);
    if (owner?.filePath === transcriptPath) {
      totals.cost += parseEventCostDollars(event);
      totals.tokens += parseEventTokens(event);
      totals.eventCount += 1;
    }
  }
  return totals;
}

export function buildThreadUsage(events: UsageEvent[], limit = 8): ThreadUsage[] {
  const meta = listAllThreadMeta();
  if (meta.length === 0) {
    return [];
  }

  const usageByPath = new Map<string, ThreadUsage>();
  for (const t of meta) {
    usageByPath.set(t.filePath, {
      id: t.id,
      filePath: t.filePath,
      title: t.title,
      workspaceName: t.workspaceName,
      startMs: t.startMs,
      lastActivityMs: t.lastActivityMs,
      cost: 0,
      tokens: 0,
      eventCount: 0,
      models: [],
    });
  }

  for (const event of events) {
    const eventMs = parseInt(event.timestamp, 10);
    if (Number.isNaN(eventMs)) {
      continue;
    }
    const owner = attributeEvent(meta, eventMs);
    if (!owner) {
      continue;
    }
    const usage = usageByPath.get(owner.filePath);
    if (!usage) {
      continue;
    }
    usage.cost += parseEventCostDollars(event);
    usage.tokens += parseEventTokens(event);
    usage.eventCount += 1;
    if (event.model && !usage.models.includes(event.model)) {
      usage.models.push(event.model);
    }
  }

  return [...usageByPath.values()]
    .filter((t) => t.eventCount > 0)
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
    .slice(0, limit);
}
