import { UsageEvent } from '../api/types';

export function parseEventCostCents(event: UsageEvent): number {
  if (typeof event.chargedCents === 'number' && !Number.isNaN(event.chargedCents)) {
    return event.chargedCents;
  }
  if (typeof event.tokenUsage?.totalCents === 'number' && !Number.isNaN(event.tokenUsage.totalCents)) {
    const fee = event.cursorTokenFee ?? 0;
    return event.tokenUsage.totalCents + fee;
  }
  if (event.usageBasedCosts) {
    const parsed = parseFloat(event.usageBasedCosts.replace(/[^0-9.]/g, ''));
    if (!Number.isNaN(parsed)) {
      return parsed * 100;
    }
  }
  return 0;
}

export function parseEventCostDollars(event: UsageEvent): number {
  return parseEventCostCents(event) / 100;
}

export function parseEventTokens(event: UsageEvent): number {
  const usage = event.tokenUsage;
  if (!usage) {
    return 0;
  }
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

export function formatDollars(amount: number): string {
  if (amount < 0.01 && amount > 0) {
    return `${(amount * 100).toFixed(2)}¢`;
  }
  return `$${amount.toFixed(2)}`;
}

export function formatDollarsCompact(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

export function formatEventKind(kind: string): string {
  if (kind.includes('INCLUDED')) {
    return 'Included';
  }
  if (kind.includes('USAGE_BASED')) {
    return 'On-demand';
  }
  return kind.replace('USAGE_EVENT_KIND_', '').replace(/_/g, ' ');
}

export function formatTimestamp(ms: string | number): string {
  const date = new Date(typeof ms === 'string' ? parseInt(ms, 10) : ms);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface PeriodTotals {
  cost: number;
  tokens: number;
  eventCount: number;
}

export function sumEvents(events: UsageEvent[]): PeriodTotals {
  return events.reduce(
    (acc, event) => {
      acc.cost += parseEventCostDollars(event);
      acc.tokens += parseEventTokens(event);
      acc.eventCount += 1;
      return acc;
    },
    { cost: 0, tokens: 0, eventCount: 0 },
  );
}

export function filterEventsSince(events: UsageEvent[], sinceMs: number): UsageEvent[] {
  return events.filter((e) => parseInt(e.timestamp, 10) >= sinceMs);
}

export function filterEventsInRange(events: UsageEvent[], startMs: number, endMs: number): UsageEvent[] {
  return events.filter((e) => {
    const ts = parseInt(e.timestamp, 10);
    return ts >= startMs && ts <= endMs;
  });
}

export function sortEventsDesc(events: UsageEvent[]): UsageEvent[] {
  return [...events].sort((a, b) => parseInt(b.timestamp, 10) - parseInt(a.timestamp, 10));
}
