import * as fs from 'fs';
import * as vscode from 'vscode';
import { UsageEvent } from '../api/types';
import {
  formatDollars,
  formatEventKind,
  formatTimestamp,
  parseEventCostDollars,
  parseEventTokens,
} from '../metrics/format';
import { findTranscriptPathForEvent } from '../session/threadIndex';

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function eventsToCsv(events: UsageEvent[]): string {
  const header = [
    'timestamp',
    'date',
    'kind',
    'model',
    'input_tokens',
    'output_tokens',
    'cache_write_tokens',
    'total_tokens',
    'cost_usd',
    'transcript_path',
  ].join(',');

  const rows = events.map((event) => {
    const usage = event.tokenUsage;
    const transcript = findTranscriptPathForEvent(event) ?? '';
    return [
      event.timestamp,
      formatTimestamp(event.timestamp),
      formatEventKind(event.kind),
      event.model,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
      usage?.cacheWriteTokens ?? 0,
      parseEventTokens(event),
      parseEventCostDollars(event).toFixed(4),
      transcript,
    ]
      .map((v) => escapeCsvField(String(v)))
      .join(',');
  });

  return [header, ...rows].join('\n');
}

export function eventsToJson(events: UsageEvent[]): string {
  const enriched = events.map((event) => ({
    ...event,
    costUsd: parseEventCostDollars(event),
    totalTokens: parseEventTokens(event),
    transcriptPath: findTranscriptPathForEvent(event),
  }));
  return JSON.stringify(enriched, null, 2);
}

export async function exportEvents(
  events: UsageEvent[],
  format: 'csv' | 'json',
): Promise<void> {
  if (events.length === 0) {
    void vscode.window.showWarningMessage('Cursor Usage: no events to export.');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const defaultName = `cursor-usage-${stamp}.${format}`;
  const filters: Record<string, string[]> =
    format === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] };

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultName),
    filters,
    saveLabel: 'Export',
  });
  if (!uri) {
    return;
  }

  const content = format === 'csv' ? eventsToCsv(events) : eventsToJson(events);
  await fs.promises.writeFile(uri.fsPath, content, 'utf8');
  void vscode.window.showInformationMessage(
    `Cursor Usage: exported ${events.length} events (${formatDollars(events.reduce((s, e) => s + parseEventCostDollars(e), 0))}).`,
  );
}

export async function openTranscriptPath(transcriptPath: string): Promise<void> {
  if (!fs.existsSync(transcriptPath)) {
    void vscode.window.showWarningMessage(`Transcript not found: ${transcriptPath}`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(transcriptPath));
  await vscode.window.showTextDocument(doc, { preview: true });
}

export async function openTranscriptForEvent(event: UsageEvent): Promise<void> {
  const path = findTranscriptPathForEvent(event);
  if (!path) {
    void vscode.window.showWarningMessage(
      'No matching chat transcript found for this usage event.',
    );
    return;
  }
  await openTranscriptPath(path);
}
