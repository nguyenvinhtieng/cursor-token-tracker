import { CursorUsageClient } from '../api/client';
import { UsageEvent, UsageSummary } from '../api/types';
import {
  daysAgoStart,
  endOfLocalDay,
  fetchAllEvents,
  parseBillingCycleRange,
  startOfLocalDay,
} from '../api/usageEvents';
import { extractMonthlyUsage } from '../api/usageSummary';
import {
  filterEventsInRange,
  filterEventsSince,
  PeriodTotals,
  parseEventCostDollars,
  sortEventsDesc,
  sumEvents,
} from './format';

export interface UsageMetrics {
  summary: UsageSummary;
  monthlyUsed: number;
  monthlyLimit: number | null;
  today: PeriodTotals;
  last1d: PeriodTotals;
  last7d: PeriodTotals;
  last30d: PeriodTotals;
  billingCycle: PeriodTotals;
  lastEvent: UsageEvent | null;
  lastEventCost: number;
  recentEvents: UsageEvent[];
  allEventsInWindow: UsageEvent[];
}

export async function fetchUsageMetrics(client: CursorUsageClient): Promise<UsageMetrics> {
  const summary = await client.getUsageSummary();
  const { used: summaryMonthlyUsed, limit: monthlyLimit } = extractMonthlyUsage(summary);
  // Prefer billing-cycle event sum when summary API doesn't expose dollar amounts
  const monthlyUsed = summaryMonthlyUsed > 0 ? summaryMonthlyUsed : 0;

  const now = Date.now();
  const cycle = parseBillingCycleRange(summary);
  const windowStart = Math.min(daysAgoStart(30), cycle.start);
  const windowEnd = Math.max(now, endOfLocalDay());

  const allEvents = await fetchAllEvents(client, {
    startDate: windowStart,
    endDate: windowEnd,
    pageSize: 100,
    maxPages: 100,
    pageDelayMs: 200,
  });

  const sorted = sortEventsDesc(allEvents);
  const todayStart = startOfLocalDay();
  const todayEnd = endOfLocalDay();
  const last1dStart = daysAgoStart(1);
  const last7dStart = daysAgoStart(7);
  const last30dStart = daysAgoStart(30);

  const todayEvents = filterEventsInRange(allEvents, todayStart, todayEnd);
  const last1dEvents = filterEventsSince(allEvents, last1dStart);
  const last7dEvents = filterEventsSince(allEvents, last7dStart);
  const last30dEvents = filterEventsSince(allEvents, last30dStart);
  const cycleEvents = filterEventsInRange(allEvents, cycle.start, cycle.end);
  const billingCycle = sumEvents(cycleEvents);

  const resolvedMonthlyUsed = monthlyUsed > 0 ? monthlyUsed : billingCycle.cost;
  const resolvedMonthlyLimit = monthlyLimit;

  const lastEvent = sorted[0] ?? null;
  const lastEventCost = lastEvent ? parseEventCostDollars(lastEvent) : 0;

  return {
    summary,
    monthlyUsed: resolvedMonthlyUsed,
    monthlyLimit: resolvedMonthlyLimit,
    today: sumEvents(todayEvents),
    last1d: sumEvents(last1dEvents),
    last7d: sumEvents(last7dEvents),
    last30d: sumEvents(last30dEvents),
    billingCycle,
    lastEvent,
    lastEventCost,
    recentEvents: sorted.slice(0, 20),
    allEventsInWindow: sorted,
  };
}

export function computeSessionTotals(events: UsageEvent[], sessionStartMs: number): PeriodTotals {
  return sumEvents(filterEventsSince(events, sessionStartMs));
}
