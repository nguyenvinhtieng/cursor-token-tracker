import * as vscode from 'vscode';
import { UsageMetrics, computeSessionTotals } from '../metrics/aggregator';
import { resolveChatSessionDisplay } from '../metrics/chatSessionDisplay';
import { buildTooltipMarkdown } from '../metrics/tooltip';
import { ThreadUsage } from '../session/threadIndex';
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
    const remaining = Math.max(0, settings.monthlyBudget - monthlyUsed);
    const chatSession = resolveChatSessionDisplay(this.sessionTotals, metrics.lastEvent);
    const pctLabel = settings.showBudgetPercent ? ` (${usagePct.toFixed(0)}%)` : '';
    const chatSuffix = this.chatActive ? ` | $(sync~spin) ${formatDollarsCompact(chatSession.cost)}` : '';

    this.item.text =
      `$(graph) ${formatDollarsCompact(monthlyUsed)}/${formatDollarsCompact(settings.monthlyBudget)}${pctLabel}` +
      ` · ${formatDollarsCompact(remaining)} left` +
      ` | Today ${formatDollarsCompact(metrics.today.cost)}` +
      chatSuffix;

    this.item.tooltip = buildTooltipMarkdown(metrics, this.sessionTotals, settings, chatSession);
    this.item.backgroundColor = budgetBackgroundColor(usagePct);
    this.item.show();
  }

  getMetrics(): UsageMetrics | undefined {
    return this.metrics;
  }

  getSessionTotals(): PeriodTotals {
    return this.sessionTotals;
  }
}

function budgetBackgroundColor(usagePercent: number): vscode.ThemeColor | undefined {
  if (usagePercent >= 95) {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  if (usagePercent >= 80) {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  return undefined;
}

export interface DashboardSettings {
  monthlyBudget: number;
}

export function renderDetailHtml(
  metrics: UsageMetrics,
  sessionTotals: PeriodTotals,
  settings: BudgetSettings,
  chatSessionCost: number,
  threads: ThreadUsage[] = [],
): string {
  const cycleStart = new Date(metrics.summary.billingCycleStart).toLocaleDateString();
  const cycleEnd = new Date(metrics.summary.billingCycleEnd).toLocaleDateString();
  const usagePct = getUsagePercent(metrics.monthlyUsed, settings.monthlyBudget);
  const barPct = budgetBarPercent(metrics.monthlyUsed, settings);
  const limitReached = isLimitReached(metrics.monthlyUsed, settings);
  const remaining = Math.max(0, settings.monthlyBudget - metrics.monthlyUsed);
  const statusLevel = usagePct >= 95 ? 'danger' : usagePct >= 80 ? 'warn' : 'ok';
  const statusText = limitReached ? 'Limit reached' : statusLevel === 'warn' ? 'Approaching limit' : 'On track';

  const summaryCards = `
    <section class="budget-card status-${statusLevel} ${limitReached ? 'limit-reached' : ''}">
      <div class="budget-top">
        <div>
          <div class="budget-label">Monthly spend</div>
          <div class="budget-value">${formatDollars(metrics.monthlyUsed)}<span class="budget-of"> / ${formatDollars(settings.monthlyBudget)}</span></div>
        </div>
        <div class="budget-badge">
          <span class="badge-dot"></span>${escapeHtml(statusText)}
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${barPct.toFixed(1)}%"></div>
      </div>
      <div class="budget-meta">
        <span><strong>${usagePct.toFixed(1)}%</strong> used</span>
        <span><strong>${formatDollars(remaining)}</strong> remaining</span>
      </div>
    </section>

    <div class="cards">
      <div class="card highlight"><div class="label">Today</div><div class="value">${formatDollars(metrics.today.cost)}</div><div class="sub">${formatTokens(metrics.today.tokens)} tokens</div></div>
      <div class="card"><div class="label">Last 7 days</div><div class="value">${formatDollars(metrics.last7d.cost)}</div><div class="sub">${formatTokens(metrics.last7d.tokens)} tokens</div></div>
      <div class="card"><div class="label">Last 30 days</div><div class="value">${formatDollars(metrics.last30d.cost)}</div><div class="sub">${formatTokens(metrics.last30d.tokens)} tokens</div></div>
    </div>

    <details class="settings-fold" id="settingsFold">
      <summary class="settings-summary">
        <span class="settings-title">⚙ Budget settings</span>
        <span class="settings-preview">Limit ${escapeHtml(formatDollars(settings.monthlyBudget))}</span>
      </summary>
      <div class="settings-body">
        <label class="settings-field">
          <span>Monthly limit (USD)</span>
          <div class="input-wrap">
            <span class="input-prefix">$</span>
            <input type="number" id="monthlyBudget" min="1" step="1" value="${settings.monthlyBudget}" />
          </div>
        </label>
        <div class="settings-actions">
          <button id="saveSettings" class="primary-btn">Save</button>
          <span id="saveStatus" class="save-status" hidden>✓ Saved</span>
        </div>
      </div>
    </details>

    <p class="cycle">Billing cycle ${cycleStart} → ${cycleEnd}</p>
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

  const tableBody = rows || '<tr><td colspan="5" class="empty">No usage events found.</td></tr>';

  const threadRows = threads
    .map((thread) => {
      const title = escapeHtml(thread.title);
      const when = escapeHtml(formatTimestamp(thread.lastActivityMs));
      const model = escapeHtml(thread.models[0] ?? '—');
      const extra = thread.models.length > 1 ? ` <span class="pill">+${thread.models.length - 1}</span>` : '';
      const tokens = formatTokens(thread.tokens);
      const cost = formatDollars(thread.cost);
      return `<tr><td class="thread-title" title="${title}">${title}</td><td>${when}</td><td>${model}${extra}</td><td class="num">${tokens}</td><td class="num">${cost}</td></tr>`;
    })
    .join('');

  const threadsSection = threads.length
    ? `<div class="section-title">Chat threads <span class="section-note">approximate · matched by time</span></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Thread</th><th>Last active</th><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
        <tbody>${threadRows}</tbody>
      </table>
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    :root {
      --ok: #22c55e; --warn: #f59e0b; --danger: #ef4444;
      --radius: 14px;
      --border: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      --surface: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
      --surface-2: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 28px 24px 40px; color: var(--vscode-foreground); background: var(--vscode-editor-background); max-width: 920px; margin: 0 auto; line-height: 1.5; }
    .page-head { display: flex; align-items: center; gap: 10px; margin: 0 0 22px; }
    .page-head h1 { font-size: 1.3rem; font-weight: 650; margin: 0; letter-spacing: -0.02em; }
    .page-head .glyph { font-size: 1.15rem; }
    .section-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; font-weight: 600; margin: 26px 0 12px; }
    .section-note { text-transform: none; letter-spacing: 0; font-weight: 400; opacity: 0.7; }
    .thread-title { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill { font-size: 0.66rem; padding: 1px 6px; border-radius: 999px; background: var(--surface-2); opacity: 0.8; margin-left: 4px; }

    /* Budget hero */
    .budget-card { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 22px; margin-bottom: 18px; }
    .budget-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--ok); }
    .budget-card.status-warn::before { background: var(--warn); }
    .budget-card.status-danger::before { background: var(--danger); }
    .budget-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
    .budget-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; opacity: 0.6; margin-bottom: 4px; }
    .budget-value { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .budget-of { font-size: 1.05rem; font-weight: 500; opacity: 0.5; }
    .budget-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 0.74rem; font-weight: 600; padding: 5px 11px; border-radius: 999px; white-space: nowrap; background: color-mix(in srgb, var(--ok) 15%, transparent); color: var(--ok); }
    .status-warn .budget-badge { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
    .status-danger .budget-badge { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
    .badge-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .progress-track { height: 9px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 999px; background: var(--ok); transition: width 0.4s ease; }
    .status-warn .progress-fill { background: var(--warn); }
    .status-danger .progress-fill { background: var(--danger); }
    .budget-meta { display: flex; gap: 22px; margin-top: 12px; font-size: 0.82rem; opacity: 0.8; }
    .budget-meta strong { font-weight: 650; opacity: 1; }

    /* Stat cards */
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 4px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; transition: border-color 0.15s; }
    .card:hover { border-color: color-mix(in srgb, var(--vscode-foreground) 22%, transparent); }
    .card.highlight { border-color: var(--vscode-focusBorder); background: color-mix(in srgb, var(--vscode-focusBorder) 8%, var(--surface)); }
    .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; margin-bottom: 8px; }
    .value { font-size: 1.25rem; font-weight: 680; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
    .sub { font-size: 0.72rem; opacity: 0.6; margin-top: 3px; }

    /* Settings */
    .settings-fold { margin-top: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
    .settings-fold summary { cursor: pointer; padding: 11px 15px; list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 10px; user-select: none; }
    .settings-fold summary::-webkit-details-marker { display: none; }
    .settings-fold summary::before { content: '▸'; display: inline-block; margin-right: 4px; font-size: 0.7rem; opacity: 0.55; transition: transform 0.15s; }
    .settings-fold[open] summary::before { transform: rotate(90deg); }
    .settings-fold[open] summary { border-bottom: 1px solid var(--border); }
    .settings-title { font-size: 0.82rem; font-weight: 550; }
    .settings-preview { font-size: 0.75rem; opacity: 0.55; margin-left: auto; }
    .settings-body { padding: 15px; display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
    .settings-field { display: flex; flex-direction: column; gap: 6px; }
    .settings-field span { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; }
    .input-wrap { display: flex; align-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--vscode-input-background); overflow: hidden; }
    .input-wrap:focus-within { border-color: var(--vscode-focusBorder); }
    .input-prefix { padding: 0 4px 0 11px; opacity: 0.55; font-size: 0.9rem; }
    .input-wrap input { width: 120px; padding: 7px 11px 7px 2px; border: none; background: transparent; color: var(--vscode-input-foreground); font-size: 0.9rem; outline: none; }
    .settings-actions { display: flex; align-items: center; gap: 12px; }
    .primary-btn { padding: 7px 18px; border-radius: 8px; border: none; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 0.82rem; font-weight: 550; cursor: pointer; }
    .primary-btn:hover { background: var(--vscode-button-hoverBackground); }
    .save-status { font-size: 0.78rem; color: var(--ok); font-weight: 550; }

    .cycle { font-size: 0.78rem; opacity: 0.5; margin: 16px 0 0; }

    /* Table */
    .table-wrap { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-top: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th, td { text-align: left; padding: 10px 14px; }
    thead th { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.55; font-weight: 600; background: var(--surface); border-bottom: 1px solid var(--border); }
    tbody tr { border-bottom: 1px solid var(--border); }
    tbody tr:last-child { border-bottom: none; }
    td.num { font-variant-numeric: tabular-nums; text-align: right; }
    th.num { text-align: right; }
    tbody tr:hover td { background: var(--vscode-list-hoverBackground); }
    .empty { text-align: center; opacity: 0.55; padding: 26px; }
  </style>
</head>
<body>
  <div class="page-head">
    <span class="glyph">📊</span>
    <h1>Cursor Usage</h1>
  </div>
  ${summaryCards}
  ${threadsSection}
  <div class="section-title">Recent activity</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
      <tbody>${tableBody}</tbody>
    </table>
  </div>
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
      vscode.postMessage({ type: 'saveSettings', monthlyBudget });
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
