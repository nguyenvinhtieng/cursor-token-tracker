import { BudgetSettings } from '../config/budgetConfig';
import { DisplaySettings } from '../config/displayConfig';
import { UsageMetrics } from '../metrics/aggregator';
import { ChatSessionDisplay } from '../metrics/chatSessionDisplay';
import { formatDollarsCompact, formatTokens } from '../metrics/format';

export function buildStatusBarText(
  metrics: UsageMetrics,
  budget: BudgetSettings,
  display: DisplaySettings,
  chatSession: ChatSessionDisplay,
  usagePct: number,
  chatActive = false,
): string {
  const monthlyUsed = metrics.monthlyUsed;
  const remaining = Math.max(0, budget.monthlyBudget - monthlyUsed);
  const monthlyGroup: string[] = [];

  if (display.showMonthlySpend) {
    let spend = `${formatDollarsCompact(monthlyUsed)}/${formatDollarsCompact(budget.monthlyBudget)}`;
    if (budget.showBudgetPercent) {
      spend += ` (${usagePct.toFixed(0)}%)`;
    }
    monthlyGroup.push(spend);
  } else if (budget.showBudgetPercent) {
    monthlyGroup.push(`(${usagePct.toFixed(0)}%)`);
  }

  if (display.showBudgetRemaining) {
    monthlyGroup.push(`${formatDollarsCompact(remaining)} left`);
  }

  const segments: string[] = [];
  if (monthlyGroup.length > 0) {
    segments.push(monthlyGroup.join(' · '));
  }

  if (display.showTodaySpend) {
    let today = `Today ${formatDollarsCompact(metrics.today.cost)}`;
    if (display.showTokens) {
      today += ` · ${formatTokens(metrics.today.tokens)}`;
    }
    segments.push(today);
  }

  if (display.showChatSession) {
    const chatSpin = chatActive ? '$(sync~spin) ' : '';
    let chat = `${chatSpin}Chat ${formatDollarsCompact(chatSession.cost)}`;
    if (display.showTokens) {
      chat += ` · ${formatTokens(chatSession.tokens)}`;
    }
    segments.push(chat);
  }

  if (segments.length === 0) {
    return '$(graph) Cursor Usage';
  }

  return `$(graph) ${segments.join(' | ')}`;
}
