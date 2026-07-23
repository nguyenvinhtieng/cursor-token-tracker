import * as vscode from 'vscode';

export interface StatusBarDisplaySettings {
  showMonthlySpend: boolean;
  showBudgetRemaining: boolean;
  showTodaySpend: boolean;
  showChatSession: boolean;
}

export interface DisplaySettings extends StatusBarDisplaySettings {
  showTokens: boolean;
  showWorkspaceAggregate: boolean;
}

const DEFAULT_STATUS_BAR: StatusBarDisplaySettings = {
  showMonthlySpend: true,
  showBudgetRemaining: true,
  showTodaySpend: true,
  showChatSession: false,
};

export function getDisplaySettings(): DisplaySettings {
  const config = vscode.workspace.getConfiguration('cursorUsage');
  return {
    showTokens: config.get<boolean>('showTokens', true),
    showWorkspaceAggregate: config.get<boolean>('showWorkspaceAggregate', true),
    showMonthlySpend: config.get<boolean>('showMonthlySpend', DEFAULT_STATUS_BAR.showMonthlySpend),
    showBudgetRemaining: config.get<boolean>('showBudgetRemaining', DEFAULT_STATUS_BAR.showBudgetRemaining),
    showTodaySpend: config.get<boolean>('showTodaySpend', DEFAULT_STATUS_BAR.showTodaySpend),
    showChatSession: config.get<boolean>('showChatSession', DEFAULT_STATUS_BAR.showChatSession),
  };
}

export async function updateDisplaySettings(partial: Partial<DisplaySettings>): Promise<void> {
  const config = vscode.workspace.getConfiguration('cursorUsage');
  const target = vscode.ConfigurationTarget.Global;

  if (partial.showTokens !== undefined) {
    await config.update('showTokens', partial.showTokens, target);
  }
  if (partial.showWorkspaceAggregate !== undefined) {
    await config.update('showWorkspaceAggregate', partial.showWorkspaceAggregate, target);
  }
  if (partial.showMonthlySpend !== undefined) {
    await config.update('showMonthlySpend', partial.showMonthlySpend, target);
  }
  if (partial.showBudgetRemaining !== undefined) {
    await config.update('showBudgetRemaining', partial.showBudgetRemaining, target);
  }
  if (partial.showTodaySpend !== undefined) {
    await config.update('showTodaySpend', partial.showTodaySpend, target);
  }
  if (partial.showChatSession !== undefined) {
    await config.update('showChatSession', partial.showChatSession, target);
  }
}
