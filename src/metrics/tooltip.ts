import * as vscode from 'vscode';
import { UsageMetrics } from './aggregator';
import { ChatSessionDisplay, formatChatSessionStatus } from './chatSessionDisplay';
import { BudgetSettings, getUsagePercent, isChatSessionAlertExceeded, isLimitReached } from '../config/budgetConfig';
import { DisplaySettings } from '../config/displayConfig';
import { buildWorkspaceBreakdown } from '../session/threadIndex';
import { PeriodTotals, formatDollars, formatTokens, parseEventCostDollars, parseEventTokens } from './format';

export function buildTooltipMarkdown(
  metrics: UsageMetrics,
  sessionTotals: PeriodTotals,
  settings: BudgetSettings,
  chatSession: ChatSessionDisplay,
  display?: DisplaySettings,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.supportHtml = false;

  const { summary } = metrics;
  const cycleStart = new Date(summary.billingCycleStart).toLocaleDateString();
  const cycleEnd = new Date(summary.billingCycleEnd).toLocaleDateString();
  const pct = getUsagePercent(metrics.monthlyUsed, settings.monthlyBudget);
  const remaining = Math.max(0, settings.monthlyBudget - metrics.monthlyUsed);
  const limitReached = isLimitReached(metrics.monthlyUsed, settings);

  md.appendMarkdown(`### Cursor Usage\n\n`);
  if (limitReached) {
    md.appendMarkdown(`**Budget limit reached**\n\n`);
  }
  md.appendMarkdown(`**Monthly budget** · ${formatDollars(metrics.monthlyUsed)} / ${formatDollars(settings.monthlyBudget)} (${pct.toFixed(1)}%)\n\n`);
  md.appendMarkdown(`${renderProgressBar(pct)}\n\n`);
  md.appendMarkdown(`_${formatDollars(remaining)} remaining this month_\n\n`);
  const chatAlertExceeded = isChatSessionAlertExceeded(chatSession.cost, settings.chatSessionAlertThreshold);
  if (chatAlertExceeded) {
    md.appendMarkdown(`**Chat session alert** · over ${formatDollars(settings.chatSessionAlertThreshold)} limit\n\n`);
  }
  md.appendMarkdown(`**Current chat** · ${formatChatSessionStatus(chatSession)}`);
  if (settings.chatSessionAlertThreshold > 0 && !chatAlertExceeded) {
    md.appendMarkdown(` _(alert at ${formatDollars(settings.chatSessionAlertThreshold)})_`);
  }
  md.appendMarkdown(`\n\n---\n\n`);

  md.appendMarkdown(`| Period | Spend | Tokens |\n`);
  md.appendMarkdown(`|:--|--:|--:|\n`);
  md.appendMarkdown(`| Today | ${formatDollars(metrics.today.cost)} | ${formatTokens(metrics.today.tokens)} |\n`);
  md.appendMarkdown(`| Last 7 days | ${formatDollars(metrics.last7d.cost)} | ${formatTokens(metrics.last7d.tokens)} |\n`);
  md.appendMarkdown(`| Last 30 days | ${formatDollars(metrics.last30d.cost)} | ${formatTokens(metrics.last30d.tokens)} |\n\n`);

  if (display?.showWorkspaceAggregate) {
    const workspaces = buildWorkspaceBreakdown(metrics.allEventsInWindow);
    if (workspaces.length > 1) {
      md.appendMarkdown(`**Workspaces (30d)**\n\n`);
      for (const ws of workspaces) {
        md.appendMarkdown(`- **${ws.name}** · ${formatDollars(ws.cost)} · ${formatTokens(ws.tokens)}\n`);
      }
      md.appendMarkdown(`\n`);
    }
  }

  md.appendMarkdown(`Billing cycle: ${cycleStart} → ${cycleEnd}\n\n`);
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`**Recent requests**\n\n`);

  for (const event of metrics.recentEvents.slice(0, 8)) {
    const ts = new Date(parseInt(event.timestamp, 10)).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const kind = event.kind.includes('INCLUDED') ? 'Included' : 'On-demand';
    const tokens = formatTokens(parseEventTokens(event));
    const cost = formatDollars(parseEventCostDollars(event));
    md.appendMarkdown(`- \`${ts}\` · ${kind} · **${event.model}** · ${tokens} · ${cost}\n`);
  }

  md.appendMarkdown(`\n_Click status bar for full details._`);
  return md;
}

function renderProgressBar(percent: number, width = 24): string {
  const filled = Math.round((Math.min(100, percent) / 100) * width);
  const empty = width - filled;
  const icon = percent >= 95 ? '🔴' : percent >= 80 ? '🟡' : '🟢';
  return `${icon} \`${'█'.repeat(filled)}${'░'.repeat(empty)}\` ${percent.toFixed(0)}%`;
}
