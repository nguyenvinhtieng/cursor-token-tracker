import * as vscode from 'vscode';
import { TokenReader } from './auth/tokenReader';
import { CursorApiError, CursorUsageClient } from './api/client';
import { fetchUsageMetrics, UsageMetrics } from './metrics/aggregator';
import { ChatSessionTracker } from './session/chatSessionTracker';
import { DetailPanel } from './ui/detailPanel';
import { StatusBarController } from './ui/statusBar';

let refreshTimer: NodeJS.Timeout | undefined;
let activeChatTimer: NodeJS.Timeout | undefined;
let isRefreshing = false;
let lastActivityRefreshMs = 0;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Cursor Usage Tracker');
  const tokenReader = new TokenReader(context.secrets);
  const statusBar = new StatusBarController(context);
  const detailPanel = new DetailPanel();
  const sessionTracker = new ChatSessionTracker();

  context.subscriptions.push(output, detailPanel, sessionTracker);

  const applyMetrics = (metrics: UsageMetrics): void => {
    statusBar.setChatActive(sessionTracker.isChatActive());
    statusBar.update(metrics, sessionTracker.getSessionStartMs());
    detailPanel.updateIfOpen(metrics, statusBar.getSessionTotals());
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
    // Only blank the bar to a spinner on the very first load. Background polls
    // keep the current numbers visible to avoid flicker; the "thinking" spinner
    // while a chat is active is handled separately in StatusBarController.update.
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
        `[${new Date().toISOString()}] Refreshed: today=$${metrics.today.cost.toFixed(2)} monthly=$${metrics.monthlyUsed.toFixed(2)} chat=$${statusBar.getSessionTotals().cost.toFixed(2)}`,
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
      statusBar.setChatActive(true);
      statusBar.update(metrics, sessionTracker.getSessionStartMs());
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
            detailPanel.show(context, updated, statusBar.getSessionTotals());
          }
        });
        return;
      }
      detailPanel.show(context, metrics, statusBar.getSessionTotals());
    }),
    vscode.commands.registerCommand('cursorUsage.openDashboard', () => {
      void vscode.commands.executeCommand('cursorUsage.showDetails');
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
