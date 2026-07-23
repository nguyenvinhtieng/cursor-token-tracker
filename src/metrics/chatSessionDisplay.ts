import { PeriodTotals, formatDollarsCompact, formatTokens } from './format';

export interface ChatSessionDisplay {
  tokens: number;
  cost: number;
}

export function toChatSessionDisplay(totals: PeriodTotals): ChatSessionDisplay {
  return { tokens: totals.tokens, cost: totals.cost };
}

export function formatChatSessionStatus(display: ChatSessionDisplay): string {
  return `${formatTokens(display.tokens)} · ${formatDollarsCompact(display.cost)}`;
}
