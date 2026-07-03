# Cursor Usage Tracker

A **Cursor / VS Code** extension that shows AI spend and token usage on the **status bar** (bottom-right) — no need to open the web dashboard every time.

## Features

- **Monthly total** — spend in the current billing cycle (e.g. `$6.10 / $500`)
- **Today** — total spend for today
- **Chat** — tracked chat/agent session spend (heuristic)
- **Tooltip** — 1d / 7d / 30d totals + recent requests
- **Detail panel** — click the status bar to view the events table and budget settings
- **Budget warnings** — status bar color changes when approaching or exceeding the limit (%)

## Installation

### From a `.vsix` file

1. Download `cursor-usage-tracker-*.vsix` (from a release or a local build)
2. Open Cursor → **Extensions** → `...` menu → **Install from VSIX**
3. Select the `.vsix` file and reload if prompted

### Requirements

- Signed in to Cursor IDE
- macOS: `sqlite3` CLI available on PATH (usually pre-installed)

## Usage

After installation, the extension runs automatically when you open Cursor. The status bar looks like:

```
Monthly total: $6.10/$500 (1%) | Today: $2.89 | Chat: $1.42
```

- **Hover** the status bar → detailed tooltip
- **Click** the status bar → panel with events table and budget settings
- **$(sync~spin)** icon before `Chat` when a session is active

### Authentication (token)

**No browser cookie needed.** The extension reads the JWT from Cursor's local database automatically.

Token sources (in order):

1. `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` — key `cursorAuth/accessToken`
2. macOS Keychain: `cursor-access-token` (if `cursor-agent` CLI is installed)
3. Manual token via **Set Session Token** command

If auto-detect fails:

1. Run **Cursor Usage: Diagnose Auth** (Cmd+Shift+P) → check the Output panel
2. Make sure you are signed in to Cursor IDE
3. If needed, copy the JWT from the DB:

```bash
sqlite3 "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" \
  "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken';"
```

Paste it into **Cursor Usage: Set Session Token**.

## Commands

| Command | Description |
|---------|-------------|
| `Cursor Usage: Refresh` | Refresh data immediately |
| `Cursor Usage: Show Details` | Open the detail panel |
| `Cursor Usage: Open Dashboard` | Open the detail panel |
| `Cursor Usage: Reset Chat Session` | Reset the chat session counter |
| `Cursor Usage: Diagnose Auth` | Check token auto-detect |
| `Cursor Usage: Set Session Token` | Enter token manually |
| `Cursor Usage: Clear Saved Token` | Clear manually saved token |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorUsage.monthlyBudget` | `100` | Monthly budget (USD) shown on the status bar |
| `cursorUsage.limitPercent` | `100` | Warning threshold (% of budget) — changes status bar color |
| `cursorUsage.showBudgetPercent` | `true` | Show budget % on the status bar |
| `cursorUsage.refreshIntervalSeconds` | `60` | Refresh interval (minimum 30s) |
| `cursorUsage.activeChatRefreshSeconds` | `10` | Refresh while chat is active (minimum 5s) |
| `cursorUsage.autoDetectToken` | `true` | Auto-read token from state.vscdb |
| `cursorUsage.showTokens` | `true` | Show tokens in the tooltip |
| `cursorUsage.stateDbPath` | `""` | Custom path to state.vscdb |

Budget and limit can also be adjusted directly in the detail panel (click the status bar).

## Notes

- Uses an **unofficial API** reverse-engineered from the Cursor dashboard — it may change at any time.
- **Chat session** cost is heuristic (tracks agent transcripts) and may not match internal Composer threads exactly.
- **Monthly usage** follows Cursor's billing cycle, not the calendar month (1st–30th).

## Development

See [README.dev.md](./README.dev.md) for build and packaging instructions.

## License

[MIT](./LICENSE) — Copyright (c) 2026 nguyenvinhtieng.vn
