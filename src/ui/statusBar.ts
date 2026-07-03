import * as vscode from 'vscode';
import { UsageMetrics, computeSessionTotals } from '../metrics/aggregator';
import { formatChatSessionStatus, resolveChatSessionDisplay } from '../metrics/chatSessionDisplay';
import { buildTooltipMarkdown } from '../metrics/tooltip';
import {
  BudgetSettings,
  budgetBarPercent,
  getBudgetSettings,
  getUsagePercent,
  isLimitReached,
} from '../config/budgetConfig';
import {
  PeriodTotals,
  formatDollars,
  formatDollarsCompact,
  formatEventKind,
  formatTimestamp,
  formatTokens,
  parseEventCostDollars,
  parseEventTokens,
} from '../metrics/format';

export class StatusBarController {
  private item: vscode.StatusBarItem;
  private metrics: UsageMetrics | undefined;
  private sessionTotals: PeriodTotals = { cost: 0, tokens: 0, eventCount: 0 };
  private chatActive = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.item.command = 'cursorUsage.showDetails';
    this.context.subscriptions.push(this.item);
  }

  showLoading(): void {
    this.item.text = '$(sync~spin) Cursor Usage';
    this.item.tooltip = 'Loading usage data…';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  showError(message: string): void {
    this.item.text = '$(warning) Cursor Usage';
    this.item.tooltip = message;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.show();
  }

  setChatActive(active: boolean): void {
    this.chatActive = active;
  }

  update(metrics: UsageMetrics, sessionStartMs: number): void {
    this.metrics = metrics;
    this.sessionTotals = computeSessionTotals(metrics.allEventsInWindow, sessionStartMs);

    const settings = getBudgetSettings();
    const monthlyUsed = metrics.monthlyUsed;
    const usagePct = getUsagePercent(monthlyUsed, settings.monthlyBudget);
    const pctLabel = settings.showBudgetPercent ? ` (${usagePct.toFixed(0)}%)` : '';
    const chatSession = resolveChatSessionDisplay(this.sessionTotals, metrics.lastEvent);
    const sessionPrefix = this.chatActive ? '$(sync~spin) ' : '';

    this.item.text =
      `Monthly total: ${formatDollarsCompact(monthlyUsed)}/${formatDollarsCompact(settings.monthlyBudget)}${pctLabel}` +
      ` | Today: ${formatDollarsCompact(metrics.today.cost)}` +
      ` | ${sessionPrefix}Chat: ${formatChatSessionStatus(chatSession)}`;

    this.item.tooltip = buildTooltipMarkdown(metrics, this.sessionTotals, settings, chatSession);
    this.item.backgroundColor = budgetBackgroundColor(usagePct, settings.limitPercent);
    this.item.show();
  }

  getMetrics(): UsageMetrics | undefined {
    return this.metrics;
  }

  getSessionTotals(): PeriodTotals {
    return this.sessionTotals;
  }
}

function budgetBackgroundColor(usagePercent: number, limitPercent: number): vscode.ThemeColor | undefined {
  const ratio = limitPercent > 0 ? usagePercent / limitPercent : 0;
  if (ratio >= 0.95) {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  if (ratio >= 0.8) {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  return undefined;
}

export interface DashboardSettings {
  monthlyBudget: number;
  limitPercent: number;
}

export function renderDetailHtml(
  metrics: UsageMetrics,
  sessionTotals: PeriodTotals,
  settings: BudgetSettings,
  chatSessionCost: number,
): string {
  const cycleStart = new Date(metrics.summary.billingCycleStart).toLocaleDateString();
  const cycleEnd = new Date(metrics.summary.billingCycleEnd).toLocaleDateString();
  const usagePct = getUsagePercent(metrics.monthlyUsed, settings.monthlyBudget);
  const barPct = budgetBarPercent(metrics.monthlyUsed, settings);
  const limitReached = isLimitReached(metrics.monthlyUsed, settings);
  const barColor = barPct >= 95 ? '#ef4444' : barPct >= 80 ? '#f59e0b' : '#22c55e';
  const limitLabel = settings.limitPercent < 100
    ? `${settings.limitPercent}% cap`
    : '100% budget';

  const settingsPreview = `$${settings.monthlyBudget} · limit ${settings.limitPercent}%`;

  const summaryCards = `
    <details class="settings-fold" id="settingsFold">
      <summary class="settings-summary">
        <span class="settings-title">⚙ Budget settings</span>
        <span class="settings-preview">${escapeHtml(settingsPreview)}</span>
      </summary>
      <div class="settings-body">
        <div class="settings-grid">
          <label>
            <span>Budget (USD)</span>
            <input type="number" id="monthlyBudget" min="1" step="1" value="${settings.monthlyBudget}" />
          </label>
          <label>
            <span>Limit (%)</span>
            <input type="number" id="limitPercent" min="1" max="100" step="1" value="${settings.limitPercent}" />
          </label>
        </div>
        <div class="settings-actions">
          <button id="saveSettings" class="primary-btn">Save</button>
          <span id="saveStatus" class="save-status" hidden>Saved</span>
        </div>
      </div>
    </details>
    <div class="budget-card ${limitReached ? 'limit-reached' : ''}">
      <div class="budget-header">
        <span class="budget-label">Monthly budget · ${escapeHtml(limitLabel)}</span>
        <span class="budget-value">${formatDollars(metrics.monthlyUsed)} / ${formatDollars(settings.monthlyBudget)}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${barPct.toFixed(1)}%; background:${barColor}"></div>
      </div>
      <div class="budget-meta">${usagePct.toFixed(1)}% used · ${formatDollars(Math.max(0, settings.monthlyBudget - metrics.monthlyUsed))} remaining${limitReached ? ' · <strong>Limit reached</strong>' : ''}</div>
    </div>
    <div class="cards">
      <div class="card highlight"><div class="label">Current chat</div><div class="value">${formatDollars(chatSessionCost)} <span class="sub">${formatTokens(sessionTotals.tokens)} tok</span></div></div>
      <div class="card"><div class="label">Today</div><div class="value">${formatDollars(metrics.today.cost)} <span class="sub">${formatTokens(metrics.today.tokens)} tok</span></div></div>
      <div class="card"><div class="label">Last 7 days</div><div class="value">${formatDollars(metrics.last7d.cost)} <span class="sub">${formatTokens(metrics.last7d.tokens)} tok</span></div></div>
      <div class="card"><div class="label">Last 30 days</div><div class="value">${formatDollars(metrics.last30d.cost)} <span class="sub">${formatTokens(metrics.last30d.tokens)} tok</span></div></div>
    </div>
    <p class="cycle">Billing cycle: ${cycleStart} → ${cycleEnd}</p>
  `;

  const rows = metrics.recentEvents
    .map((event) => {
      const ts = formatTimestamp(event.timestamp);
      const kind = formatEventKind(event.kind);
      const tokens = formatTokens(parseEventTokens(event));
      const cost = formatDollars(parseEventCostDollars(event));
      return `<tr><td>${escapeHtml(ts)}</td><td>${escapeHtml(kind)}</td><td>${escapeHtml(event.model)}</td><td class="num">${tokens}</td><td class="num">${cost}</td></tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); max-width: 960px; margin: 0 auto; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 16px; letter-spacing: -0.02em; }
    h2 { font-size: 0.95rem; font-weight: 600; margin: 0 0 12px; }
    .settings-fold { margin-bottom: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-inactiveSelectionBackground); font-size: 0.8rem; }
    .settings-fold summary { cursor: pointer; padding: 7px 12px; list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 10px; user-select: none; }
    .settings-fold summary::-webkit-details-marker { display: none; }
    .settings-fold summary::before { content: '▸'; display: inline-block; margin-right: 6px; font-size: 0.7rem; opacity: 0.6; transition: transform 0.15s; }
    .settings-fold[open] summary::before { transform: rotate(90deg); }
    .settings-fold[open] summary { border-bottom: 1px solid var(--vscode-panel-border); }
    .settings-title { font-size: 0.78rem; font-weight: 500; opacity: 0.85; white-space: nowrap; }
    .settings-preview { font-size: 0.72rem; opacity: 0.55; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .settings-body { padding: 10px 12px 11px; }
    .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
    .settings-body label span { display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.65; margin-bottom: 4px; }
    .settings-body input[type="number"] { width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 0.82rem; }
    .checkbox-row { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 0.78rem; }
    .settings-actions { display: flex; align-items: center; gap: 10px; }
    .primary-btn { padding: 5px 12px; border-radius: 6px; border: none; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 0.78rem; cursor: pointer; }
    .primary-btn:hover { background: var(--vscode-button-hoverBackground); }
    .save-status { font-size: 0.72rem; color: #22c55e; }
    .budget-card { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; border: 1px solid var(--vscode-panel-border); }
    .budget-card.limit-reached { border-color: #ef4444; }
    .budget-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
    .budget-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.75; }
    .budget-value { font-size: 1.35rem; font-weight: 700; }
    .progress-track { height: 10px; border-radius: 999px; background: var(--vscode-panel-border); overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 999px; transition: width 0.3s ease; }
    .budget-meta { margin-top: 8px; font-size: 0.8rem; opacity: 0.8; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .card { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 10px; padding: 12px 14px; border: 1px solid var(--vscode-panel-border); }
    .card.highlight { border-color: var(--vscode-focusBorder); }
    .label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; margin-bottom: 6px; }
    .value { font-size: 1.05rem; font-weight: 600; }
    .sub { font-size: 0.72rem; font-weight: 400; opacity: 0.75; }
    .cycle { font-size: 0.82rem; opacity: 0.75; margin: 0 0 8px; }
    .hint { font-size: 0.78rem; opacity: 0.7; line-height: 1.45; margin: 0 0 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.65; font-weight: 600; }
    td.num { font-variant-numeric: tabular-nums; }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
  </style>
</head>
<body>
  <h1>Cursor Usage</h1>
  ${summaryCards}
  <table>
    <thead><tr><th>Date</th><th>Type</th><th>Model</th><th>Tokens</th><th>Cost</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No usage events found.</td></tr>'}</tbody>
  </table>
  <script>
    const vscode = acquireVsCodeApi();
    const fold = document.getElementById('settingsFold');
    const saved = vscode.getState();
    if (saved && saved.settingsOpen) {
      fold.open = true;
    }
    fold.addEventListener('toggle', () => {
      vscode.setState({ ...vscode.getState(), settingsOpen: fold.open });
    });
    document.getElementById('saveSettings').addEventListener('click', () => {
      const monthlyBudget = Number(document.getElementById('monthlyBudget').value);
      const limitPercent = Number(document.getElementById('limitPercent').value);
      vscode.postMessage({ type: 'saveSettings', monthlyBudget, limitPercent });
      const status = document.getElementById('saveStatus');
      status.hidden = false;
      setTimeout(() => { status.hidden = true; }, 2000);
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
