import * as vscode from 'vscode';
import { TokenReader } from './auth/tokenReader';
import { CursorApiError, CursorUsageClient } from './api/client';
import { getBudgetSettings } from './config/budgetConfig';
import { fetchUsageMetrics, UsageMetrics } from './metrics/aggregator';
import { formatDollars } from './metrics/format';
import { exportEvents } from './export/exportUsage';
import { ChatSessionTracker } from './session/chatSessionTracker';
import { DetailPanel } from './ui/detailPanel';
import { StatusBarController } from './ui/statusBar';
import {
  UsageHistoryTreeProvider,
  clearHistoryFilters,
  handleOpenTranscript,
  pickModelFilter,
  pickPeriodFilter,
} from './ui/usageTreeView';
import { UsageEvent } from './api/types';

let refreshTimer: NodeJS.Timeout | undefined;
let activeChatTimer: NodeJS.Timeout | undefined;
let isRefreshing = false;
let lastActivityRefreshMs = 0;
let chatAlertNotifiedForSessionMs = 0;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Cursor Usage Tracker');
  const tokenReader = new TokenReader(context.secrets);
  const statusBar = new StatusBarController(context);
  const detailPanel = new DetailPanel();
  const sessionTracker = new ChatSessionTracker();
  const historyTree = new UsageHistoryTreeProvider();

  context.subscriptions.push(
    output,
    detailPanel,
    sessionTracker,
    vscode.window.registerTreeDataProvider('cursorUsageHistory', historyTree),
  );

  const pushStatusBar = (metrics: UsageMetrics): void => {
    statusBar.update(
      metrics,
      sessionTracker.getActiveTranscriptPath(),
      sessionTracker.getSessionStartMs(),
      sessionTracker.isChatActive(),
    );
  };

  const applyMetrics = (metrics: UsageMetrics): void => {
    const activeTranscript = sessionTracker.getActiveTranscriptPath();
    pushStatusBar(metrics);
    detailPanel.updateIfOpen(metrics, statusBar.getChatSession(), activeTranscript);
    historyTree.update(metrics);
    maybeNotifyChatAlert(sessionTracker.getSessionStartMs(), statusBar);
  };

  const maybeNotifyChatAlert = (sessionStartMs: number, bar: StatusBarController): void => {
    const settings = getBudgetSettings();
    if (settings.chatSessionAlertThreshold <= 0) {
      return;
    }
    if (!bar.isChatAlertExceeded()) {
      return;
    }
    if (chatAlertNotifiedForSessionMs === sessionStartMs) {
      return;
    }
    chatAlertNotifiedForSessionMs = sessionStartMs;
    const cost = bar.getChatSession().cost;
    void vscode.window.showWarningMessage(
      `Cursor Usage: current chat session reached ${formatDollars(cost)} (alert at ${formatDollars(settings.chatSessionAlertThreshold)}).`,
    );
  };

  const logDiagnose = async (): Promise<void> => {
    const d = await tokenReader.diagnose();
    output.clear();
    output.appendLine('=== Cursor Usage Auth Diagnostics ===');
    output.appendLine(`state.vscdb path: ${d.dbPath}`);
    output.appendLine(`DB exists: ${d.dbExists}`);
    output.appendLine(`sqlite3 CLI: ${d.sqlite3Available ? 'available' : 'NOT FOUND'}`);
    output.appendLine(`Raw token found: ${d.rawTokenFound} (source: ${d.rawTokenSource})`);
    output.appendLine(`Token format: ${d.tokenDescription}`);
    output.appendLine(`Session cookie built: ${d.sessionCookieBuilt}`);
    if (d.keychainTried) {
      output.appendLine('macOS keychain fallback: tried');
    }
    if (d.error) {
      output.appendLine(`Error: ${d.error}`);
    }
    output.appendLine('');
    output.appendLine('No browser cookie needed — token is read from Cursor local DB.');
    output.show(true);
  };

  const refresh = async (): Promise<void> => {
    if (isRefreshing) {
      return;
    }
    isRefreshing = true;
    if (!statusBar.getMetrics()) {
      statusBar.showLoading();
    }

    try {
      const token = await tokenReader.getToken();
      if (!token) {
        statusBar.showError(
          'Could not read session token. Run "Cursor Usage: Diagnose Auth".',
        );
        return;
      }

      const client = new CursorUsageClient(token);
      const metrics = await fetchUsageMetrics(client);
      applyMetrics(metrics);
      output.appendLine(
        `[${new Date().toISOString()}] Refreshed: today=$${metrics.today.cost.toFixed(2)} monthly=$${metrics.monthlyUsed.toFixed(2)} chat=$${statusBar.getChatSession().cost.toFixed(2)}`,
      );
    } catch (err) {
      const message = err instanceof CursorApiError && err.status === 401
        ? 'Session expired. Sign in to Cursor again, then run "Diagnose Auth".'
        : err instanceof Error
          ? err.message
          : String(err);
      statusBar.showError(message);
      output.appendLine(`[${new Date().toISOString()}] Error: ${message}`);
    } finally {
      isRefreshing = false;
    }
  };

  const refreshFromActivity = (): void => {
    const minGapMs = 8000;
    const now = Date.now();
    if (now - lastActivityRefreshMs < minGapMs) {
      return;
    }
    lastActivityRefreshMs = now;
    void refresh();
  };

  const scheduleRefresh = (): void => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    const seconds = vscode.workspace
      .getConfiguration('cursorUsage')
      .get<number>('refreshIntervalSeconds', 60);
    const intervalMs = Math.max(30, seconds) * 1000;
    refreshTimer = setInterval(() => {
      void refresh();
    }, intervalMs);
  };

  const scheduleActiveChatRefresh = (): void => {
    if (activeChatTimer) {
      clearInterval(activeChatTimer);
      activeChatTimer = undefined;
    }

    if (!sessionTracker.isChatActive()) {
      return;
    }

    const seconds = vscode.workspace
      .getConfiguration('cursorUsage')
      .get<number>('activeChatRefreshSeconds', 10);
    const intervalMs = Math.max(5, seconds) * 1000;
    activeChatTimer = setInterval(() => {
      if (sessionTracker.isChatActive()) {
        void refresh();
      } else if (activeChatTimer) {
        clearInterval(activeChatTimer);
        activeChatTimer = undefined;
      }
    }, intervalMs);
  };

  detailPanel.setOnSettingsSaved(() => {
    const metrics = statusBar.getMetrics();
    if (metrics) {
      applyMetrics(metrics);
    }
    void refresh();
  });

  sessionTracker.setOnSessionChange(() => {
    chatAlertNotifiedForSessionMs = 0;
    const metrics = statusBar.getMetrics();
    if (metrics) {
      applyMetrics(metrics);
    }
    scheduleActiveChatRefresh();
  });

  sessionTracker.setOnActivity(() => {
    refreshFromActivity();
    scheduleActiveChatRefresh();
    const metrics = statusBar.getMetrics();
    if (metrics) {
      pushStatusBar(metrics);
    }
  });

  sessionTracker.startWatching();

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorUsage.refresh', () => refresh()),
    vscode.commands.registerCommand('cursorUsage.diagnoseAuth', () => logDiagnose()),
    vscode.commands.registerCommand('cursorUsage.setToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Paste JWT from state.vscdb (cursorAuth/accessToken) or sub::jwt — no browser cookie needed',
        placeHolder: 'eyJhbGciOi... or user_xxx::eyJhbGciOi...',
        password: true,
        ignoreFocusOut: true,
      });
      if (token) {
        await tokenReader.setManualToken(token);
        vscode.window.showInformationMessage('Cursor Usage: token saved.');
        await refresh();
      }
    }),
    vscode.commands.registerCommand('cursorUsage.clearToken', async () => {
      await tokenReader.clearManualToken();
      vscode.window.showInformationMessage('Cursor Usage: manual token cleared.');
      await refresh();
    }),
    vscode.commands.registerCommand('cursorUsage.resetSession', () => {
      sessionTracker.reset();
      chatAlertNotifiedForSessionMs = 0;
      const metrics = statusBar.getMetrics();
      if (metrics) {
        applyMetrics(metrics);
      }
      vscode.window.showInformationMessage('Cursor Usage: chat session counter reset.');
    }),
    vscode.commands.registerCommand('cursorUsage.showDetails', () => {
      const metrics = statusBar.getMetrics();
      if (!metrics) {
        void refresh().then(() => {
          const updated = statusBar.getMetrics();
          if (updated) {
            detailPanel.show(
              context,
              updated,
              statusBar.getChatSession(),
              sessionTracker.getActiveTranscriptPath(),
            );
          }
        });
        return;
      }
      detailPanel.show(
        context,
        metrics,
        statusBar.getChatSession(),
        sessionTracker.getActiveTranscriptPath(),
      );
    }),
    vscode.commands.registerCommand('cursorUsage.openDashboard', () => {
      void vscode.commands.executeCommand('cursorUsage.showDetails');
    }),
    vscode.commands.registerCommand('cursorUsage.history.filterPeriod', () => pickPeriodFilter(historyTree)),
    vscode.commands.registerCommand('cursorUsage.history.filterModel', () => pickModelFilter(historyTree)),
    vscode.commands.registerCommand('cursorUsage.history.clearFilters', () => clearHistoryFilters(historyTree)),
    vscode.commands.registerCommand('cursorUsage.exportCsv', async () => {
      const metrics = statusBar.getMetrics() ?? detailPanel.getMetrics();
      if (!metrics) {
        await refresh();
      }
      const data = statusBar.getMetrics() ?? detailPanel.getMetrics();
      if (data) {
        await exportEvents(data.allEventsInWindow, 'csv');
      }
    }),
    vscode.commands.registerCommand('cursorUsage.exportJson', async () => {
      const metrics = statusBar.getMetrics() ?? detailPanel.getMetrics();
      if (!metrics) {
        await refresh();
      }
      const data = statusBar.getMetrics() ?? detailPanel.getMetrics();
      if (data) {
        await exportEvents(data.allEventsInWindow, 'json');
      }
    }),
    vscode.commands.registerCommand('cursorUsage.openTranscript', (event: UsageEvent) => handleOpenTranscript(event)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      sessionTracker.startWatching();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cursorUsage.refreshIntervalSeconds')) {
        scheduleRefresh();
      }
      if (e.affectsConfiguration('cursorUsage.activeChatRefreshSeconds')) {
        scheduleActiveChatRefresh();
      }
      if (e.affectsConfiguration('cursorUsage')) {
        const metrics = statusBar.getMetrics();
        if (metrics) {
          applyMetrics(metrics);
        }
      }
    }),
  );

  scheduleRefresh();
  void refresh();
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (activeChatTimer) {
    clearInterval(activeChatTimer);
    activeChatTimer = undefined;
  }
}
