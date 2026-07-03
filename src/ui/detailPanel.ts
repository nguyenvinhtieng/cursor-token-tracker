import * as vscode from 'vscode';
import { UsageMetrics } from '../metrics/aggregator';
import { getBudgetSettings, updateBudgetSettings } from '../config/budgetConfig';
import { PeriodTotals } from '../metrics/format';
import { renderDetailHtml } from './statusBar';

export class DetailPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private onSettingsSaved: (() => void) | undefined;

  setOnSettingsSaved(callback: () => void): void {
    this.onSettingsSaved = callback;
  }

  show(
    _context: vscode.ExtensionContext,
    metrics: UsageMetrics,
    sessionTotals: PeriodTotals,
  ): void {
    const settings = getBudgetSettings();
    const html = renderDetailHtml(metrics, sessionTotals, settings, sessionTotals.cost);

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

  updateIfOpen(metrics: UsageMetrics, sessionTotals: PeriodTotals): void {
    if (!this.panel) {
      return;
    }
    const settings = getBudgetSettings();
    this.panel.webview.html = renderDetailHtml(metrics, sessionTotals, settings, sessionTotals.cost);
  }

  private async handleMessage(msg: {
    type: string;
    monthlyBudget?: number;
    limitPercent?: number;
  }): Promise<void> {
    if (msg.type !== 'saveSettings') {
      return;
    }

    const monthlyBudget = Math.max(1, Number(msg.monthlyBudget) || 100);
    const limitPercent = Math.min(100, Math.max(1, Number(msg.limitPercent) || 100));

    await updateBudgetSettings({
      monthlyBudget,
      limitPercent,
    });

    vscode.window.showInformationMessage('Cursor Usage: budget settings saved.');
    this.onSettingsSaved?.();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}
