import * as vscode from 'vscode';
import { UsageEvent } from '../api/types';
import { UsageMetrics } from '../metrics/aggregator';
import { daysAgoStart, endOfLocalDay, startOfLocalDay } from '../api/usageEvents';
import {
  filterEventsInRange,
  filterEventsSince,
  formatDollars,
  formatDollarsCompact,
  formatEventKind,
  formatTimestamp,
  formatTokens,
  parseEventCostDollars,
  parseEventTokens,
  sumEvents,
} from '../metrics/format';
import { buildWorkspaceBreakdown } from '../session/threadIndex';
import { openTranscriptForEvent } from '../export/exportUsage';

export type HistoryPeriodFilter = 'today' | '7d' | '30d' | 'all';

export const PERIOD_LABELS: Record<HistoryPeriodFilter, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All (30d window)',
};

type TreeItemKind = 'summary' | 'workspace' | 'day' | 'event';

export class UsageTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: TreeItemKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly event?: UsageEvent,
    public readonly dayKey?: string,
  ) {
    super(label, collapsibleState);
    if (kind === 'event' && event) {
      this.contextValue = 'usageEvent';
      this.iconPath = new vscode.ThemeIcon('comment-discussion');
      this.description = formatDollars(parseEventCostDollars(event));
      this.tooltip = `${formatEventKind(event.kind)} · ${event.model}\n${formatTokens(parseEventTokens(event))} tokens`;
      this.command = {
        command: 'cursorUsage.openTranscript',
        title: 'Open Transcript',
        arguments: [event],
      };
    } else if (kind === 'workspace') {
      this.iconPath = new vscode.ThemeIcon('folder');
    } else if (kind === 'day') {
      this.iconPath = new vscode.ThemeIcon('calendar');
    } else if (kind === 'summary') {
      this.iconPath = new vscode.ThemeIcon('graph');
    }
  }
}

export class UsageHistoryTreeProvider implements vscode.TreeDataProvider<UsageTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<UsageTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private metrics: UsageMetrics | undefined;
  private periodFilter: HistoryPeriodFilter = '7d';
  private modelFilter = 'all';

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  update(metrics: UsageMetrics): void {
    this.metrics = metrics;
    this.refresh();
  }

  getPeriodFilter(): HistoryPeriodFilter {
    return this.periodFilter;
  }

  getModelFilter(): string {
    return this.modelFilter;
  }

  setPeriodFilter(period: HistoryPeriodFilter): void {
    this.periodFilter = period;
    this.refresh();
  }

  setModelFilter(model: string): void {
    this.modelFilter = model;
    this.refresh();
  }

  getFilteredEvents(): UsageEvent[] {
    if (!this.metrics) {
      return [];
    }

    let events = this.metrics.allEventsInWindow;
    const now = Date.now();

    switch (this.periodFilter) {
      case 'today':
        events = filterEventsInRange(events, startOfLocalDay(), endOfLocalDay());
        break;
      case '7d':
        events = filterEventsSince(events, daysAgoStart(7));
        break;
      case '30d':
        events = filterEventsSince(events, daysAgoStart(30));
        break;
      case 'all':
        break;
    }

    if (this.modelFilter !== 'all') {
      events = events.filter((e) => e.model === this.modelFilter);
    }

    return events;
  }

  getAvailableModels(): string[] {
    if (!this.metrics) {
      return [];
    }
    const models = new Set<string>();
    for (const event of this.metrics.allEventsInWindow) {
      if (event.model) {
        models.add(event.model);
      }
    }
    return [...models].sort();
  }

  getTreeItem(element: UsageTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: UsageTreeItem): UsageTreeItem[] {
    if (!this.metrics) {
      return [new UsageTreeItem('summary', 'Loading usage data…', vscode.TreeItemCollapsibleState.None)];
    }

    const events = this.getFilteredEvents();

    if (!element) {
      const items: UsageTreeItem[] = [];
      const totals = sumEvents(events);
      const periodLabel = PERIOD_LABELS[this.periodFilter];
      const modelLabel = this.modelFilter === 'all' ? 'all models' : this.modelFilter;
      items.push(
        new UsageTreeItem(
          'summary',
          `${periodLabel} · ${formatDollarsCompact(totals.cost)} · ${formatTokens(totals.tokens)} · ${totals.eventCount} events (${modelLabel})`,
          vscode.TreeItemCollapsibleState.None,
        ),
      );

      const workspaces = buildWorkspaceBreakdown(events);
      if (workspaces.length > 1) {
        for (const ws of workspaces) {
          items.push(
            new UsageTreeItem(
              'workspace',
              `${ws.name} — ${formatDollarsCompact(ws.cost)} · ${formatTokens(ws.tokens)}`,
              vscode.TreeItemCollapsibleState.None,
            ),
          );
        }
      }

      const dayGroups = groupEventsByDay(events);
      for (const [dayKey, dayEvents] of dayGroups) {
        const dayTotals = sumEvents(dayEvents);
        items.push(
          new UsageTreeItem(
            'day',
            `${dayKey} (${dayEvents.length}) — ${formatDollarsCompact(dayTotals.cost)}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            dayKey,
          ),
        );
      }

      if (items.length === 1 && events.length === 0) {
        items.push(
          new UsageTreeItem('summary', 'No events match the current filters', vscode.TreeItemCollapsibleState.None),
        );
      }

      return items;
    }

    if (element.kind === 'day' && element.dayKey) {
      const dayEvents = groupEventsByDay(this.getFilteredEvents()).get(element.dayKey) ?? [];
      return dayEvents.map(
        (event) =>
          new UsageTreeItem(
            'event',
            `${formatTimestamp(event.timestamp)} · ${event.model}`,
            vscode.TreeItemCollapsibleState.None,
            event,
          ),
      );
    }

    return [];
  }
}

function groupEventsByDay(events: UsageEvent[]): Map<string, UsageEvent[]> {
  const groups = new Map<string, UsageEvent[]>();
  const sorted = [...events].sort((a, b) => parseInt(b.timestamp, 10) - parseInt(a.timestamp, 10));

  for (const event of sorted) {
    const date = new Date(parseInt(event.timestamp, 10));
    const today = startOfLocalDay();
    const yesterday = today - 24 * 60 * 60 * 1000;
    const eventDay = startOfLocalDay(date);

    let label: string;
    if (eventDay === today) {
      label = 'Today';
    } else if (eventDay === yesterday) {
      label = 'Yesterday';
    } else {
      label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const list = groups.get(label) ?? [];
    list.push(event);
    groups.set(label, list);
  }

  return groups;
}

export async function pickPeriodFilter(provider: UsageHistoryTreeProvider): Promise<void> {
  const current = provider.getPeriodFilter();
  const picked = await vscode.window.showQuickPick(
    (Object.keys(PERIOD_LABELS) as HistoryPeriodFilter[]).map((key) => ({
      label: PERIOD_LABELS[key],
      description: key === current ? 'current' : undefined,
      value: key,
    })),
    { placeHolder: 'Filter usage history by period' },
  );
  if (picked) {
    provider.setPeriodFilter(picked.value);
  }
}

export async function pickModelFilter(provider: UsageHistoryTreeProvider): Promise<void> {
  const models = provider.getAvailableModels();
  const current = provider.getModelFilter();
  const items = [
    { label: 'All models', value: 'all', description: current === 'all' ? 'current' : undefined },
    ...models.map((m) => ({
      label: m,
      value: m,
      description: current === m ? 'current' : undefined,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Filter by model' });
  if (picked) {
    provider.setModelFilter(picked.value);
  }
}

export function clearHistoryFilters(provider: UsageHistoryTreeProvider): void {
  provider.setPeriodFilter('7d');
  provider.setModelFilter('all');
}

export async function handleOpenTranscript(event: UsageEvent): Promise<void> {
  await openTranscriptForEvent(event);
}
