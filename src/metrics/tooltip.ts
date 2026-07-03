import * as vscode from 'vscode';
import { UsageMetrics } from './aggregator';
import { ChatSessionDisplay, formatChatSessionStatus } from './chatSessionDisplay';
import { BudgetSettings, getUsagePercent, isLimitReached } from '../config/budgetConfig';
import { PeriodTotals, formatDollars, formatTokens, parseEventCostDollars, parseEventTokens } from './format';

export function buildTooltipMarkdown(
  metrics: UsageMetrics,
  sessionTotals: PeriodTotals,
  settings: BudgetSettings,
  chatSession: ChatSessionDisplay,
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
  if (settings.limitPercent < 100) {
    md.appendMarkdown(`_Limit cap: ${settings.limitPercent}% ($${(settings.monthlyBudget * settings.limitPercent / 100).toFixed(2)})_\n\n`);
  }
  md.appendMarkdown(`${renderProgressBar(pct)}\n\n`);
  md.appendMarkdown(`_${formatDollars(remaining)} remaining this month_\n\n`);
  md.appendMarkdown(`**Current chat** · ${formatChatSessionStatus(chatSession)}`);
  if (chatSession.fromLastEvent) {
    md.appendMarkdown(` _(latest API call — session counter still warming up)_`);
  }
  md.appendMarkdown(`\n\n---\n\n`);

  md.appendMarkdown(`| Period | Spend | Tokens |\n`);
  md.appendMarkdown(`|:--|--:|--:|\n`);
  md.appendMarkdown(`| Today | ${formatDollars(metrics.today.cost)} | ${formatTokens(metrics.today.tokens)} |\n`);
  md.appendMarkdown(`| Last 7 days | ${formatDollars(metrics.last7d.cost)} | ${formatTokens(metrics.last7d.tokens)} |\n`);
  md.appendMarkdown(`| Last 30 days | ${formatDollars(metrics.last30d.cost)} | ${formatTokens(metrics.last30d.tokens)} |\n\n`);

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
