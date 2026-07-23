import * as vscode from 'vscode';
import { UsageMetrics } from '../metrics/aggregator';
import { ChatSessionDisplay, toChatSessionDisplay } from '../metrics/chatSessionDisplay';
import { buildTooltipMarkdown } from '../metrics/tooltip';
import {
  BudgetSettings,
  budgetBarPercent,
  getBudgetSettings,
  getUsagePercent,
  isChatSessionAlertExceeded,
  isLimitReached,
} from '../config/budgetConfig';
import { DisplaySettings, getDisplaySettings } from '../config/displayConfig';
import { buildWorkspaceBreakdown, buildThreadUsage, computeThreadTotalsForPath, findTranscriptPathForEvent } from '../session/threadIndex';
import { buildSettingsPreviewData, renderSettingsModal, SETTINGS_PANEL_STYLES } from './settingsPanelHtml';
import { buildStatusBarText } from './statusBarText';
import {
  PeriodTotals,
  formatDollars,
  formatEventKind,
  formatTimestamp,
  formatTokens,
  parseEventCostDollars,
  parseEventTokens,
} from '../metrics/format';

export class StatusBarController {
  private budgetItem: vscode.StatusBarItem;
  private metrics: UsageMetrics | undefined;
  private sessionTotals: PeriodTotals = { cost: 0, tokens: 0, eventCount: 0 };
  private chatSession: ChatSessionDisplay = { cost: 0, tokens: 0 };

  constructor(private readonly context: vscode.ExtensionContext) {
    this.budgetItem = vscode.window.createStatusBarItem('cursorUsage.budget', vscode.StatusBarAlignment.Right, 50);
    this.budgetItem.command = 'cursorUsage.showDetails';
    this.context.subscriptions.push(this.budgetItem);
  }

  showLoading(): void {
    this.budgetItem.text = '$(sync~spin) Cursor Usage';
    this.budgetItem.tooltip = 'Loading usage data…';
    this.budgetItem.backgroundColor = undefined;
    this.budgetItem.show();
  }

  showError(message: string): void {
    this.budgetItem.text = '$(warning) Cursor Usage';
    this.budgetItem.tooltip = message;
    this.budgetItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.budgetItem.show();
  }

  update(
    metrics: UsageMetrics,
    activeTranscriptPath: string | undefined,
    sinceMs: number,
    chatActive = false,
  ): void {
    this.metrics = metrics;
    this.sessionTotals = activeTranscriptPath
      ? computeThreadTotalsForPath(metrics.allEventsInWindow, activeTranscriptPath, sinceMs)
      : { cost: 0, tokens: 0, eventCount: 0 };

    const budgetSettings = getBudgetSettings();
    const displaySettings = getDisplaySettings();
    const monthlyUsed = metrics.monthlyUsed;
    const usagePct = getUsagePercent(monthlyUsed, budgetSettings.monthlyBudget);
    const chatSession = toChatSessionDisplay(this.sessionTotals);
    this.chatSession = chatSession;

    this.budgetItem.text = buildStatusBarText(
      metrics,
      budgetSettings,
      displaySettings,
      chatSession,
      usagePct,
      chatActive,
    );

    this.budgetItem.tooltip = buildTooltipMarkdown(
      metrics,
      this.sessionTotals,
      budgetSettings,
      chatSession,
      displaySettings,
    );
    this.budgetItem.backgroundColor = budgetBackgroundColor(usagePct);
    this.budgetItem.show();
  }

  getMetrics(): UsageMetrics | undefined {
    return this.metrics;
  }

  getSessionTotals(): PeriodTotals {
    return this.sessionTotals;
  }

  isChatAlertExceeded(): boolean {
    const settings = getBudgetSettings();
    return isChatSessionAlertExceeded(this.chatSession.cost, settings.chatSessionAlertThreshold);
  }

  getChatSession(): ChatSessionDisplay {
    return this.chatSession;
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
  settings: BudgetSettings,
  display?: DisplaySettings,
  chatSession?: ChatSessionDisplay,
  activeTranscriptPath?: string,
): string {
  const displaySettings = display ?? getDisplaySettings();
  const chat = chatSession ?? { cost: 0, tokens: 0 };
  const cycleStart = new Date(metrics.summary.billingCycleStart).toLocaleDateString();
  const cycleEnd = new Date(metrics.summary.billingCycleEnd).toLocaleDateString();
  const usagePct = getUsagePercent(metrics.monthlyUsed, settings.monthlyBudget);
  const barPct = budgetBarPercent(metrics.monthlyUsed, settings);
  const limitReached = isLimitReached(metrics.monthlyUsed, settings);
  const remaining = Math.max(0, settings.monthlyBudget - metrics.monthlyUsed);
  const statusLevel = usagePct >= 95 ? 'danger' : usagePct >= 80 ? 'warn' : 'ok';
  const statusText = limitReached ? 'Limit reached' : statusLevel === 'warn' ? 'Approaching limit' : 'On track';

  const workspaceRows = buildWorkspaceBreakdown(metrics.allEventsInWindow);
  const threads = buildThreadUsage(metrics.allEventsInWindow, 12);
  const showWorkspaceNames = workspaceRows.length > 1;
  const settingsModal = renderSettingsModal(
    settings,
    displaySettings,
    buildSettingsPreviewData(metrics, settings, chat),
    workspaceRows,
  );

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

    <p class="cycle">Billing cycle ${cycleStart} → ${cycleEnd}</p>
  `;

  const workspaceSection =
    workspaceRows.length > 1
      ? `
    <div class="section-title">Workspaces (30d)</div>
    <div class="workspace-list">
      ${workspaceRows
        .map(
          (ws) =>
            `<div class="workspace-row"><span class="ws-name">${escapeHtml(ws.name)}</span><span>${formatDollars(ws.cost)} · ${formatTokens(ws.tokens)} · ${ws.eventCount} events</span></div>`,
        )
        .join('')}
    </div>`
      : '';

  const threadSection =
    threads.length > 0
      ? `
    <div class="section-title">Chat threads (30d)</div>
    <div class="thread-list">
      ${threads
        .map((thread) => {
          const isActive = activeTranscriptPath === thread.filePath;
          const wsPrefix =
            showWorkspaceNames && thread.workspaceName
              ? `<span class="thread-ws">${escapeHtml(thread.workspaceName)} · </span>`
              : '';
          const models =
            thread.models.length > 0 ? ` · ${escapeHtml(thread.models.slice(0, 2).join(', '))}` : '';
          return `<div class="thread-row ${isActive ? 'thread-active' : ''} clickable" data-transcript="${escapeHtml(thread.filePath)}">
        <div class="thread-main">
          <span class="thread-title">${wsPrefix}${escapeHtml(thread.title)}</span>
          ${isActive ? '<span class="thread-badge">Active</span>' : ''}
        </div>
        <span class="thread-meta">${formatDollars(thread.cost)} · ${formatTokens(thread.tokens)} · ${thread.eventCount} events${models}</span>
      </div>`;
        })
        .join('')}
    </div>
    <p class="table-hint">Costs are attributed to threads by timestamp — may not match Composer exactly.</p>`
      : '';

  const rows = metrics.recentEvents
    .map((event) => {
      const ts = formatTimestamp(event.timestamp);
      const kind = formatEventKind(event.kind);
      const tokens = formatTokens(parseEventTokens(event));
      const cost = formatDollars(parseEventCostDollars(event));
      const transcript = findTranscriptPathForEvent(event);
      const linkCell = transcript
        ? `<td class="link-cell" title="Open transcript">↗</td>`
        : `<td class="link-cell muted">—</td>`;
      const rowClass = transcript ? 'event-row clickable' : 'event-row';
      const dataAttrs = `data-ts="${escapeHtml(event.timestamp)}" data-transcript="${transcript ? escapeHtml(transcript) : ''}"`;
      return `<tr class="${rowClass}" ${dataAttrs}><td>${escapeHtml(ts)}</td><td>${escapeHtml(kind)}</td><td>${escapeHtml(event.model)}</td><td class="num">${tokens}</td><td class="num">${cost}</td>${linkCell}</tr>`;
    })
    .join('');

  const tableBody = rows || '<tr><td colspan="6" class="empty">No usage events found.</td></tr>';

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
    .page-head { display: flex; align-items: center; gap: 10px; margin: 0 0 22px; flex-wrap: wrap; }
    .page-head h1 { font-size: 1.3rem; font-weight: 650; margin: 0; letter-spacing: -0.02em; }
    .page-head .glyph { font-size: 1.15rem; }
    .section-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; font-weight: 600; margin: 26px 0 12px; }
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

    /* Settings modal */
    .input-wrap { display: flex; align-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--vscode-input-background); overflow: hidden; }
    .input-wrap:focus-within { border-color: var(--vscode-focusBorder); }
    .input-prefix { padding: 0 4px 0 11px; opacity: 0.55; font-size: 0.9rem; }
    .input-wrap input { width: 120px; padding: 7px 11px 7px 2px; border: none; background: transparent; color: var(--vscode-input-foreground); font-size: 0.9rem; outline: none; }
    .settings-field span { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; }
    .settings-field select { padding: 7px 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 0.82rem; outline: none; }
    .settings-field select:focus { border-color: var(--vscode-focusBorder); }
    .settings-actions { display: flex; align-items: center; gap: 12px; }
    .primary-btn { padding: 7px 18px; border-radius: 8px; border: none; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 0.82rem; font-weight: 550; cursor: pointer; }
    .primary-btn:hover { background: var(--vscode-button-hoverBackground); }
    .save-status { font-size: 0.78rem; color: var(--ok); font-weight: 550; }
    .settings-field { display: flex; flex-direction: column; gap: 6px; }
    ${SETTINGS_PANEL_STYLES}

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
    .page-actions { display: flex; gap: 8px; margin-left: auto; }
    .secondary-btn { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--vscode-foreground); font-size: 0.78rem; cursor: pointer; }
    .secondary-btn:hover { background: var(--surface-2); }
    .workspace-list { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 8px; }
    .workspace-row { display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.82rem; }
    .workspace-row:last-child { border-bottom: none; }
    .ws-name { font-weight: 600; }
    .thread-list { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 8px; }
    .thread-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.82rem; }
    .thread-row:last-child { border-bottom: none; }
    .thread-row.clickable { cursor: pointer; }
    .thread-row.clickable:hover { background: var(--vscode-list-hoverBackground); }
    .thread-row.thread-active { background: color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent); }
    .thread-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
    .thread-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .thread-ws { font-weight: 500; opacity: 0.65; }
    .thread-badge { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 650; padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-focusBorder) 20%, transparent); color: var(--vscode-focusBorder); white-space: nowrap; }
    .thread-meta { font-variant-numeric: tabular-nums; opacity: 0.8; white-space: nowrap; text-align: right; }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover td { background: var(--vscode-list-hoverBackground); }
    .link-cell { text-align: center; width: 36px; opacity: 0.7; }
    .link-cell.muted { opacity: 0.35; }
    .table-hint { font-size: 0.75rem; opacity: 0.55; margin: 8px 0 0; }
  </style>
</head>
<body>
  <div class="page-head">
    <span class="glyph">📊</span>
    <h1>Cursor Usage</h1>
    <div class="page-actions">
      <button type="button" id="openSettings" class="icon-btn settings-btn" title="Settings" aria-label="Settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      </button>
      <button id="exportCsv" class="secondary-btn">Export CSV</button>
      <button id="exportJson" class="secondary-btn">Export JSON</button>
    </div>
  </div>
  ${summaryCards}
  ${workspaceSection}
  ${threadSection}
  <div class="section-title">Recent activity</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th><th></th></tr></thead>
      <tbody>${tableBody}</tbody>
    </table>
  </div>
  <p class="table-hint">Click a row to open the matching chat transcript. Full history is in the Usage History sidebar.</p>
  ${settingsModal}
  <script>
    const vscode = acquireVsCodeApi();
    const settingsModal = document.getElementById('settingsModal');
    const openSettingsBtn = document.getElementById('openSettings');
    const closeSettingsBtn = document.getElementById('closeSettingsModal');
    const settingsBackdrop = document.getElementById('settingsModalBackdrop');

    function openSettingsModal() {
      settingsModal.hidden = false;
    }

    function closeSettingsModal() {
      settingsModal.hidden = true;
    }

    openSettingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
    settingsBackdrop.addEventListener('click', closeSettingsModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !settingsModal.hidden) {
        closeSettingsModal();
      }
    });

    document.getElementById('saveSettings').addEventListener('click', () => {
      const monthlyBudget = Number(document.getElementById('monthlyBudget').value);
      const chatSessionAlertThreshold = Number(document.getElementById('chatSessionAlertThreshold').value);
      const chatAlertBackground = document.getElementById('chatAlertBackground').value;
      const showBudgetPercent = document.getElementById('showBudgetPercent').checked;
      const showMonthlySpend = document.getElementById('showMonthlySpend').checked;
      const showBudgetRemaining = document.getElementById('showBudgetRemaining').checked;
      const showTodaySpend = document.getElementById('showTodaySpend').checked;
      const showChatSession = document.getElementById('showChatSession').checked;
      const showTokens = document.getElementById('showTokens').checked;
      const showWorkspaceAggregate = document.getElementById('showWorkspaceAggregate').checked;
      vscode.postMessage({
        type: 'saveSettings',
        monthlyBudget,
        chatSessionAlertThreshold,
        chatAlertBackground,
        showBudgetPercent,
        showMonthlySpend,
        showBudgetRemaining,
        showTodaySpend,
        showChatSession,
        showTokens,
        showWorkspaceAggregate,
      });
      closeSettingsModal();
    });
    document.getElementById('exportCsv').addEventListener('click', () => {
      vscode.postMessage({ type: 'export', format: 'csv' });
    });
    document.getElementById('exportJson').addEventListener('click', () => {
      vscode.postMessage({ type: 'export', format: 'json' });
    });
    document.querySelectorAll('tr.event-row.clickable').forEach((row) => {
      row.addEventListener('click', () => {
        const transcriptPath = row.getAttribute('data-transcript');
        const timestamp = row.getAttribute('data-ts');
        if (transcriptPath) {
          vscode.postMessage({ type: 'openTranscript', transcriptPath, timestamp });
        }
      });
    });
    document.querySelectorAll('.thread-row.clickable').forEach((row) => {
      row.addEventListener('click', () => {
        const transcriptPath = row.getAttribute('data-transcript');
        if (transcriptPath) {
          vscode.postMessage({ type: 'openTranscript', transcriptPath });
        }
      });
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
