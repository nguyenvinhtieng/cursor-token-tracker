import * as vscode from 'vscode';

export interface BudgetSettings {
  monthlyBudget: number;
  showBudgetPercent: boolean;
  activeChatRefreshSeconds: number;
}

export function getBudgetSettings(): BudgetSettings {
  const config = vscode.workspace.getConfiguration('cursorUsage');
  return {
    monthlyBudget: config.get<number>('monthlyBudget', 100),
    showBudgetPercent: config.get<boolean>('showBudgetPercent', true),
    activeChatRefreshSeconds: config.get<number>('activeChatRefreshSeconds', 10),
  };
}

export function getUsagePercent(monthlyUsed: number, monthlyBudget: number): number {
  if (monthlyBudget <= 0) {
    return 0;
  }
  return (monthlyUsed / monthlyBudget) * 100;
}

export function isLimitReached(monthlyUsed: number, settings: BudgetSettings): boolean {
  return getUsagePercent(monthlyUsed, settings.monthlyBudget) >= 100;
}

export function budgetBarPercent(monthlyUsed: number, settings: BudgetSettings): number {
  return Math.min(100, getUsagePercent(monthlyUsed, settings.monthlyBudget));
}

export async function updateBudgetSettings(partial: Partial<BudgetSettings>): Promise<void> {
  const config = vscode.workspace.getConfiguration('cursorUsage');
  const target = vscode.ConfigurationTarget.Global;

  if (partial.monthlyBudget !== undefined) {
    await config.update('monthlyBudget', partial.monthlyBudget, target);
  }
  if (partial.showBudgetPercent !== undefined) {
    await config.update('showBudgetPercent', partial.showBudgetPercent, target);
  }
  if (partial.activeChatRefreshSeconds !== undefined) {
    await config.update('activeChatRefreshSeconds', partial.activeChatRefreshSeconds, target);
  }
}
