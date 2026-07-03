# Cursor Usage Tracker — Development

Guide for setting up the environment, building, and packaging the extension.

## Requirements

- Node.js 18+
- npm
- Cursor or VS Code

## Setup

```bash
git clone <repository-url>
cd cursor-usage-tracker
npm install
```

## Build

```bash
npm run compile
```

Watch mode (rebuilds on file changes):

```bash
npm run watch
```

## Run the extension (F5)

1. Open this folder in Cursor
2. **Run and Debug** → **Run Extension** (F5)
3. An Extension Development Host window opens — the extension runs there

## Package `.vsix`

```bash
npm run package
```

Output file: `cursor-usage-tracker-<version>.vsix`

Install locally for testing:

```bash
cursor  --install-extension cursor-usage-tracker-0.1.0.vsix
```

**Extensions** → `...` menu → **Install from VSIX**

## Extension icon

Add the icon file at:

```
images/icon.png
```

Recommended size: **128×128 px** (PNG). `package.json` already points to this path — add the file and rebuild.

## Project structure

```
src/
  api/          # Cursor usage API client
  auth/         # Token reader (state.vscdb / keychain)
  config/       # Budget settings
  metrics/      # Usage aggregation and formatting
  session/      # Chat session tracker
  ui/           # Status bar + detail panel
  extension.ts  # Entry point
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Build `dist/extension.js` (esbuild) |
| `npm run watch` | Build + watch |
| `npm run package` | Compile + `vsce package` |

## Publisher / metadata

Edit in `package.json`:

- `publisher` — marketplace publisher ID
- `author` — author information
- `repository` — repo URL (update before publishing)
- `icon` — `images/icon.png`
