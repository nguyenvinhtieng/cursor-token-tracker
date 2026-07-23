import * as vscode from 'vscode';
import { UsageMetrics } from '../metrics/aggregator';
import { ChatSessionDisplay } from '../metrics/chatSessionDisplay';
import { getBudgetSettings, updateBudgetSettings, ChatAlertBackground } from '../config/budgetConfig';
import { getDisplaySettings, updateDisplaySettings } from '../config/displayConfig';
import { exportEvents, openTranscriptPath } from '../export/exportUsage';
import { renderDetailHtml } from './statusBar';

export class DetailPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private onSettingsSaved: (() => void) | undefined;
  private metrics: UsageMetrics | undefined;

  setOnSettingsSaved(callback: () => void): void {
    this.onSettingsSaved = callback;
  }

  show(
    _context: vscode.ExtensionContext,
    metrics: UsageMetrics,
    chatSession?: ChatSessionDisplay,
    activeTranscriptPath?: string,
  ): void {
    this.metrics = metrics;
    const settings = getBudgetSettings();
    const display = getDisplaySettings();
    const html = renderDetailHtml(metrics, settings, display, chatSession, activeTranscriptPath);

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.panel.webview.html = html;
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'cursorUsageDetails',
      'Cursor Usage',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.webview.html = html;
    this.panel.webview.onDidReceiveMessage((msg) => {
      void this.handleMessage(msg);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  updateIfOpen(
    metrics: UsageMetrics,
    chatSession?: ChatSessionDisplay,
    activeTranscriptPath?: string,
  ): void {
    this.metrics = metrics;
    if (!this.panel) {
      return;
    }
    const settings = getBudgetSettings();
    const display = getDisplaySettings();
    this.panel.webview.html = renderDetailHtml(metrics, settings, display, chatSession, activeTranscriptPath);
  }

  getMetrics(): UsageMetrics | undefined {
    return this.metrics;
  }

  private async handleMessage(msg: {
    type: string;
    monthlyBudget?: number;
    chatSessionAlertThreshold?: number;
    chatAlertBackground?: ChatAlertBackground;
    showBudgetPercent?: boolean;
    showMonthlySpend?: boolean;
    showBudgetRemaining?: boolean;
    showTodaySpend?: boolean;
    showChatSession?: boolean;
    showTokens?: boolean;
    showWorkspaceAggregate?: boolean;
    format?: 'csv' | 'json';
    transcriptPath?: string;
  }): Promise<void> {
    if (msg.type === 'saveSettings') {
      const monthlyBudget = Math.max(1, Number(msg.monthlyBudget) || 100);
      const chatSessionAlertThreshold = Math.max(0, Number(msg.chatSessionAlertThreshold) || 0);
      const chatAlertBackground = msg.chatAlertBackground ?? 'error';
      const display = getDisplaySettings();
      const budget = getBudgetSettings();

      await updateBudgetSettings({
        monthlyBudget,
        chatSessionAlertThreshold,
        chatAlertBackground,
        showBudgetPercent: msg.showBudgetPercent ?? budget.showBudgetPercent,
      });
      await updateDisplaySettings({
        showMonthlySpend: msg.showMonthlySpend ?? display.showMonthlySpend,
        showBudgetRemaining: msg.showBudgetRemaining ?? display.showBudgetRemaining,
        showTodaySpend: msg.showTodaySpend ?? display.showTodaySpend,
        showChatSession: msg.showChatSession ?? display.showChatSession,
        showTokens: msg.showTokens ?? display.showTokens,
        showWorkspaceAggregate: msg.showWorkspaceAggregate ?? display.showWorkspaceAggregate,
      });

      vscode.window.showInformationMessage('Cursor Usage: settings saved.');
      this.onSettingsSaved?.();
      return;
    }

    if (msg.type === 'export' && msg.format && this.metrics) {
      await exportEvents(this.metrics.allEventsInWindow, msg.format);
      return;
    }

    if (msg.type === 'openTranscript' && msg.transcriptPath) {
      await openTranscriptPath(msg.transcriptPath);
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}
