import { UsageSummary } from './types';

function parseCents(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseFloat(value);
    if (!Number.isNaN(n)) {
      return n;
    }
  }
  return null;
}

export function extractMonthlyUsage(summary: UsageSummary): { used: number; limit: number | null } {
  const teamOnDemand = summary.teamUsage?.onDemand;
  const individualOnDemand = summary.individualUsage?.onDemand;
  const plan = summary.individualUsage?.plan;

  if (teamOnDemand?.enabled) {
    const usedCents = parseCents(teamOnDemand.used);
    const limitCents = parseCents(teamOnDemand.limit);
    if (usedCents !== null) {
      return {
        used: usedCents / 100,
        limit: limitCents !== null ? limitCents / 100 : null,
      };
    }
  }

  if (individualOnDemand?.enabled) {
    const usedCents = parseCents(individualOnDemand.used);
    const limitCents = parseCents(individualOnDemand.limit);
    if (usedCents !== null) {
      return {
        used: usedCents / 100,
        limit: limitCents !== null ? limitCents / 100 : null,
      };
    }
  }

  if (plan?.enabled) {
    return {
      used: plan.used ?? 0,
      limit: plan.limit ?? null,
    };
  }

  return { used: 0, limit: null };
}
