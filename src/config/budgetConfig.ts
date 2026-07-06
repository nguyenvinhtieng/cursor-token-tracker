import * as vscode from 'vscode';

export type ChatAlertBackground = 'prominent' | 'warning' | 'error';

export interface BudgetSettings {
  monthlyBudget: number;
  showBudgetPercent: boolean;
  activeChatRefreshSeconds: number;
  chatSessionAlertThreshold: number;
  chatAlertBackground: ChatAlertBackground;
}

export function getBudgetSettings(): BudgetSettings {
  const config = vscode.workspace.getConfiguration('cursorUsage');
  return {
    monthlyBudget: config.get<number>('monthlyBudget', 100),
    showBudgetPercent: config.get<boolean>('showBudgetPercent', true),
    activeChatRefreshSeconds: config.get<number>('activeChatRefreshSeconds', 10),
    chatSessionAlertThreshold: config.get<number>('chatSessionAlertThreshold', 2),
    chatAlertBackground: config.get<ChatAlertBackground>('chatAlertBackground', 'error'),
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

export function isChatSessionAlertExceeded(sessionCost: number, threshold: number): boolean {
  return threshold > 0 && sessionCost >= threshold;
}

export function getChatSessionUsagePercent(sessionCost: number, threshold: number): number {
  if (threshold <= 0) {
    return 0;
  }
  return (sessionCost / threshold) * 100;
}

export function chatAlertThemeColor(style: ChatAlertBackground): vscode.ThemeColor {
  switch (style) {
    case 'warning':
      return new vscode.ThemeColor('statusBarItem.warningBackground');
    case 'error':
      return new vscode.ThemeColor('statusBarItem.errorBackground');
    case 'prominent':
    default:
      return new vscode.ThemeColor('statusBarItem.prominentBackground');
  }
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
  if (partial.chatSessionAlertThreshold !== undefined) {
    await config.update('chatSessionAlertThreshold', partial.chatSessionAlertThreshold, target);
  }
  if (partial.chatAlertBackground !== undefined) {
    await config.update('chatAlertBackground', partial.chatAlertBackground, target);
  }
}
