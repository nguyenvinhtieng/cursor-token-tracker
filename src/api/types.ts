export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  totalCents?: number;
}

export interface UsageEvent {
  timestamp: string;
  model: string;
  kind: string;
  requestsCosts?: number;
  usageBasedCosts?: string;
  isTokenBasedCall?: boolean;
  tokenUsage?: TokenUsage;
  owningUser?: string;
  owningTeam?: string;
  cursorTokenFee?: number;
  isChargeable?: boolean;
  isHeadless?: boolean;
  chargedCents?: number;
}

export interface UsageEventsResponse {
  totalUsageEventsCount: number;
  usageEventsDisplay: UsageEvent[];
}

export interface PlanUsage {
  enabled?: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
  breakdown?: {
    included?: number;
    bonus?: number;
    total?: number;
  };
}

export interface OnDemandUsage {
  enabled?: boolean;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
}

export interface UsageSummary {
  billingCycleStart: string;
  billingCycleEnd: string;
  membershipType?: string;
  limitType?: string;
  isUnlimited?: boolean;
  individualUsage?: {
    plan?: PlanUsage;
    onDemand?: OnDemandUsage;
  };
  teamUsage?: {
    onDemand?: OnDemandUsage;
  };
}

export interface FetchEventsOptions {
  startDate?: number;
  endDate?: number;
  pageSize?: number;
  maxPages?: number;
  pageDelayMs?: number;
}
