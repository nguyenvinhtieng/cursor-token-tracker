import { CursorUsageClient, sleep } from './client';
import { FetchEventsOptions, UsageEvent } from './types';

export async function fetchAllEvents(
  client: CursorUsageClient,
  options: FetchEventsOptions = {},
): Promise<UsageEvent[]> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 100;
  const pageDelayMs = options.pageDelayMs ?? 200;

  const body: Record<string, unknown> = {
    page: 1,
    pageSize,
  };
  if (options.startDate !== undefined) {
    body.startDate = String(options.startDate);
  }
  if (options.endDate !== undefined) {
    body.endDate = String(options.endDate);
  }

  const allEvents: UsageEvent[] = [];
  let page = 1;
  let totalCount = Infinity;

  while (page <= maxPages && allEvents.length < totalCount) {
    const response = await client.getFilteredUsageEvents({ ...body, page });
    totalCount = response.totalUsageEventsCount;
    const events = response.usageEventsDisplay ?? [];
    if (events.length === 0) {
      break;
    }
    allEvents.push(...events);
    if (allEvents.length >= totalCount) {
      break;
    }
    page += 1;
    if (pageDelayMs > 0) {
      await sleep(pageDelayMs);
    }
  }

  return allEvents;
}

export function startOfLocalDay(date: Date = new Date()): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfLocalDay(date: Date = new Date()): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function daysAgoStart(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return startOfLocalDay(d);
}

export function parseBillingCycleRange(summary: { billingCycleStart: string; billingCycleEnd: string }): {
  start: number;
  end: number;
} {
  return {
    start: new Date(summary.billingCycleStart).getTime(),
    end: new Date(summary.billingCycleEnd).getTime(),
  };
}
