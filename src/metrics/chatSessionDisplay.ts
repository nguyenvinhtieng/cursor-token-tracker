import { UsageEvent } from '../api/types';
import { PeriodTotals, formatDollarsCompact, formatTokens, parseEventCostDollars, parseEventTokens } from './format';

export interface ChatSessionDisplay {
  tokens: number;
  cost: number;
  fromLastEvent: boolean;
}

export function resolveChatSessionDisplay(
  sessionTotals: PeriodTotals,
  lastEvent: UsageEvent | null,
): ChatSessionDisplay {
  if (sessionTotals.cost > 0 || sessionTotals.tokens > 0) {
    return { tokens: sessionTotals.tokens, cost: sessionTotals.cost, fromLastEvent: false };
  }
  if (lastEvent) {
    return {
      tokens: parseEventTokens(lastEvent),
      cost: parseEventCostDollars(lastEvent),
      fromLastEvent: true,
    };
  }
  return { tokens: 0, cost: 0, fromLastEvent: false };
}

export function formatChatSessionStatus(display: ChatSessionDisplay): string {
  return `${formatTokens(display.tokens)}/${formatDollarsCompact(display.cost)}`;
}
