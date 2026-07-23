import { UsageMetrics } from '../metrics/aggregator';
import { ChatSessionDisplay } from '../metrics/chatSessionDisplay';
import { BudgetSettings, getUsagePercent } from '../config/budgetConfig';
import { DisplaySettings } from '../config/displayConfig';
import { WorkspaceUsageBreakdown } from '../session/threadIndex';
import { formatDollars } from '../metrics/format';

export interface SettingsPreviewData {
  monthlyUsed: number;
  monthlyBudget: number;
  todayCost: number;
  todayTokens: number;
  chatCost: number;
  chatTokens: number;
  remaining: number;
  usagePct: number;
  workspaces: WorkspaceUsageBreakdown[];
}

export function buildSettingsPreviewData(
  metrics: UsageMetrics,
  settings: BudgetSettings,
  chatSession: ChatSessionDisplay,
): SettingsPreviewData {
  const monthlyUsed = metrics.monthlyUsed;
  return {
    monthlyUsed,
    monthlyBudget: settings.monthlyBudget,
    todayCost: metrics.today.cost,
    todayTokens: metrics.today.tokens,
    chatCost: chatSession.cost,
    chatTokens: chatSession.tokens,
    remaining: Math.max(0, settings.monthlyBudget - monthlyUsed),
    usagePct: getUsagePercent(monthlyUsed, settings.monthlyBudget),
    workspaces: [],
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toggleCard(
  id: string,
  title: string,
  checked: boolean,
  sub?: string,
  disabled = false,
): string {
  return `
    <div class="toggle-card${disabled ? ' disabled' : ''}">
      <label class="toggle-head">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <span class="toggle-title">${escapeHtml(title)}</span>
        ${sub ? `<span class="toggle-sub">${escapeHtml(sub)}</span>` : ''}
      </label>
      <div class="toggle-preview" id="preview-${id}"></div>
    </div>`;
}

export function renderSettingsModal(
  settings: BudgetSettings,
  display: DisplaySettings,
  preview: SettingsPreviewData,
  workspaceRows: WorkspaceUsageBreakdown[],
): string {
  preview.workspaces = workspaceRows;
  const previewJson = JSON.stringify(preview).replace(/</g, '\\u003c');

  return `
    <div class="settings-modal" id="settingsModal" hidden>
      <div class="settings-modal-backdrop" id="settingsModalBackdrop"></div>
      <div class="settings-modal-panel" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
        <div class="settings-modal-header">
          <h2 id="settingsModalTitle" class="settings-modal-title">Settings</h2>
          <button type="button" id="closeSettingsModal" class="icon-btn" title="Close" aria-label="Close settings">×</button>
        </div>
        <div class="settings-body">
        <section class="settings-section">
          <h3 class="settings-section-title">Alerts</h3>
          <p class="settings-section-desc">Notify when spend crosses a limit.</p>
          <div class="settings-grid alerts-grid">
            <label class="settings-field">
              <span>Monthly limit (USD)</span>
              <div class="input-wrap">
                <span class="input-prefix">$</span>
                <input type="number" id="monthlyBudget" min="1" step="1" value="${settings.monthlyBudget}" />
              </div>
            </label>
            <label class="settings-field">
              <span>Chat session alert (USD)</span>
              <div class="input-wrap">
                <span class="input-prefix">$</span>
                <input type="number" id="chatSessionAlertThreshold" min="0" step="0.5" value="${settings.chatSessionAlertThreshold}" />
              </div>
              <span class="field-hint">Set to 0 to disable</span>
            </label>
            <label class="settings-field">
              <span>Chat alert color</span>
              <select id="chatAlertBackground">
                <option value="prominent" ${settings.chatAlertBackground === 'prominent' ? 'selected' : ''}>Prominent (purple)</option>
                <option value="warning" ${settings.chatAlertBackground === 'warning' ? 'selected' : ''}>Warning (amber)</option>
                <option value="error" ${settings.chatAlertBackground === 'error' ? 'selected' : ''}>Error (red)</option>
              </select>
            </label>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-section-title">Status bar</h3>
          <p class="settings-section-desc">Toggle each part of the status bar. All on by default.</p>

          ${toggleCard('showMonthlySpend', 'Monthly spend', display.showMonthlySpend, '$used / $budget')}
          ${toggleCard('showBudgetPercent', 'Budget percentage', settings.showBudgetPercent, '(40%) next to monthly spend')}
          ${toggleCard('showBudgetRemaining', 'Remaining budget', display.showBudgetRemaining, '$59.79 left')}
          ${toggleCard('showTodaySpend', "Today's spend", display.showTodaySpend, 'Today $1.30')}
          ${toggleCard('showChatSession', 'Chat session', display.showChatSession, 'Current chat spend')}
          ${toggleCard('showTokens', 'Token counts', display.showTokens, 'Shown on today and chat segments')}

          <div class="status-bar-mock">
            <span class="mock-label">Status bar preview</span>
            <code class="mock-bar" id="previewStatusBar"></code>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-section-title">Tooltip</h3>
          <p class="settings-section-desc">Extra detail when hovering the status bar.</p>
          ${toggleCard(
            'showWorkspaceAggregate',
            'Workspace breakdown',
            display.showWorkspaceAggregate,
            workspaceRows.length > 1 ? 'Per-folder spend in tooltip' : 'Open multiple folders to enable',
            workspaceRows.length <= 1,
          )}
          <div class="toggle-preview ws-only-preview" id="preview-showWorkspaceAggregate-extra"></div>
        </section>

        <div class="settings-actions">
          <button type="button" id="saveSettings" class="primary-btn">Save settings</button>
          <span id="saveStatus" class="save-status" hidden>Saved</span>
        </div>
      </div>
      </div>
    </div>
    <script>
      const PREVIEW_DATA = ${previewJson};

      function fmtMoney(n) { return '$' + Number(n).toFixed(2); }
      function fmtTok(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
      }

      function readBarState() {
        return {
          showMonthlySpend: document.getElementById('showMonthlySpend').checked,
          showBudgetPercent: document.getElementById('showBudgetPercent').checked,
          showBudgetRemaining: document.getElementById('showBudgetRemaining').checked,
          showTodaySpend: document.getElementById('showTodaySpend').checked,
          showChatSession: document.getElementById('showChatSession').checked,
          showTokens: document.getElementById('showTokens').checked,
          showWorkspace: document.getElementById('showWorkspaceAggregate').checked,
        };
      }

      function buildStatusBarPreview(state) {
        const d = PREVIEW_DATA;
        const monthlyGroup = [];

        if (state.showMonthlySpend) {
          let spend = fmtMoney(d.monthlyUsed) + '/' + fmtMoney(d.monthlyBudget);
          if (state.showBudgetPercent) spend += ' (' + d.usagePct.toFixed(0) + '%)';
          monthlyGroup.push(spend);
        } else if (state.showBudgetPercent) {
          monthlyGroup.push('(' + d.usagePct.toFixed(0) + '%)');
        }

        if (state.showBudgetRemaining) {
          monthlyGroup.push(fmtMoney(d.remaining) + ' left');
        }

        const segments = [];
        if (monthlyGroup.length) segments.push(monthlyGroup.join(' · '));

        if (state.showTodaySpend) {
          let today = 'Today ' + fmtMoney(d.todayCost);
          if (state.showTokens) today += ' · ' + fmtTok(d.todayTokens);
          segments.push(today);
        }

        if (state.showChatSession) {
          let chat = 'Chat ' + fmtMoney(d.chatCost);
          if (state.showTokens) chat += ' · ' + fmtTok(d.chatTokens);
          segments.push(chat);
        }

        return segments.length ? segments.join(' | ') : 'Cursor Usage';
      }

      function partPreview(on, sample) {
        return on
          ? '<span class="on">On</span> · <code>' + sample + '</code>'
          : '<span class="off">Off</span> · hidden';
      }

      function renderPreviews() {
        const state = readBarState();
        const d = PREVIEW_DATA;
        const bar = buildStatusBarPreview(state);

        document.getElementById('preview-showMonthlySpend').innerHTML = partPreview(
          state.showMonthlySpend,
          fmtMoney(d.monthlyUsed) + '/' + fmtMoney(d.monthlyBudget),
        );
        document.getElementById('preview-showBudgetPercent').innerHTML = partPreview(
          state.showBudgetPercent,
          fmtMoney(d.monthlyUsed) + '/' + fmtMoney(d.monthlyBudget) + ' (' + d.usagePct.toFixed(0) + '%)',
        );
        document.getElementById('preview-showBudgetRemaining').innerHTML = partPreview(
          state.showBudgetRemaining,
          fmtMoney(d.remaining) + ' left',
        );
        document.getElementById('preview-showTodaySpend').innerHTML = partPreview(
          state.showTodaySpend,
          'Today ' + fmtMoney(d.todayCost),
        );
        document.getElementById('preview-showChatSession').innerHTML = partPreview(
          state.showChatSession,
          'Chat ' + fmtMoney(d.chatCost),
        );
        document.getElementById('preview-showTokens').innerHTML = partPreview(
          state.showTokens,
          'Today ' + fmtMoney(d.todayCost) + ' · ' + fmtTok(d.todayTokens),
        );

        document.getElementById('previewStatusBar').textContent = bar;

        const ws = d.workspaces || [];
        const wsExtra = document.getElementById('preview-showWorkspaceAggregate-extra');
        if (ws.length > 1) {
          const lines = ws.map(w => '<div>' + w.name + ' · ' + fmtMoney(w.cost) + ' · ' + fmtTok(w.tokens) + '</div>').join('');
          document.getElementById('preview-showWorkspaceAggregate').innerHTML = state.showWorkspace
            ? '<span class="on">On</span><div class="ws-preview">' + lines + '</div>'
            : '<span class="off">Off</span> · hidden in tooltip';
          wsExtra.innerHTML = '';
        } else {
          document.getElementById('preview-showWorkspaceAggregate').innerHTML = '<span class="muted">No multi-workspace data</span>';
          wsExtra.innerHTML = '';
        }

      }

      [
        'showMonthlySpend', 'showBudgetPercent', 'showBudgetRemaining', 'showTodaySpend',
        'showChatSession', 'showTokens', 'showWorkspaceAggregate',
        'monthlyBudget', 'chatSessionAlertThreshold',
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', renderPreviews);
        el.addEventListener('input', renderPreviews);
      });
      renderPreviews();
    </script>
  `;
}

export const SETTINGS_PANEL_STYLES = `
    .settings-btn { display: inline-flex; align-items: center; justify-content: center; }
    .settings-btn svg { width: 16px; height: 16px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--vscode-foreground); font-size: 1.2rem; line-height: 1; cursor: pointer; }
    .icon-btn:hover { background: var(--surface-2); }
    .settings-modal { position: fixed; inset: 0; z-index: 100; display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px; pointer-events: none; }
    .settings-modal[hidden] { display: none; }
    .settings-modal-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); pointer-events: auto; }
    .settings-modal-panel { position: relative; width: min(560px, 100%); max-height: calc(100vh - 80px); overflow: auto; border: 1px solid var(--border); border-radius: 14px; background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent); backdrop-filter: blur(12px); box-shadow: 0 8px 32px color-mix(in srgb, #000 18%, transparent); pointer-events: auto; }
    .settings-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent); backdrop-filter: blur(12px); z-index: 1; }
    .settings-modal-title { margin: 0; font-size: 1rem; font-weight: 650; letter-spacing: -0.01em; }
    .settings-section { margin-bottom: 22px; }
    .settings-section:last-of-type { margin-bottom: 8px; }
    .settings-section-title { margin: 0 0 4px; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; font-weight: 650; }
    .settings-section-desc { margin: 0 0 14px; font-size: 0.78rem; opacity: 0.55; }
    .settings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
    .field-hint { font-size: 0.68rem; opacity: 0.5; margin-top: 2px; }
    .toggle-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; background: var(--surface); }
    .toggle-card.disabled { opacity: 0.55; }
    .toggle-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; cursor: pointer; user-select: none; }
    .toggle-head input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--vscode-focusBorder); }
    .toggle-title { font-size: 0.84rem; font-weight: 550; }
    .toggle-sub { flex-basis: 100%; margin-left: 25px; font-size: 0.72rem; opacity: 0.55; }
    .toggle-preview { margin-top: 10px; margin-left: 25px; font-size: 0.78rem; line-height: 1.55; opacity: 0.85; }
    .toggle-preview code { font-size: 0.74rem; padding: 2px 6px; border-radius: 6px; background: var(--surface-2); }
    .toggle-preview .on { color: var(--ok); font-weight: 600; }
    .toggle-preview .off { opacity: 0.55; font-weight: 600; }
    .toggle-preview .muted { opacity: 0.5; font-style: italic; }
    .ws-preview { margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); font-size: 0.74rem; }
    .status-bar-mock { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--border); }
    .mock-label { display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.55; margin-bottom: 6px; }
    .mock-bar { display: block; padding: 8px 12px; border-radius: 8px; background: var(--vscode-statusBar-background, var(--surface-2)); color: var(--vscode-statusBar-foreground, inherit); font-size: 0.78rem; font-family: ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .settings-body { padding: 16px; display: block; }
    .settings-actions { margin-top: 6px; padding-top: 14px; border-top: 1px solid var(--border); }
`;
