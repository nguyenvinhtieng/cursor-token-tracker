# Cursor Token Tracker — Developer Guide

Everything you need to set up, build, run, package, and publish the extension.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Everyday development](#everyday-development)
- [Debugging (F5)](#debugging-f5)
- [Packaging a .vsix](#packaging-a-vsix)
- [Versioning & publishing](#versioning--publishing)
- [npm scripts reference](#npm-scripts-reference)
- [Project structure](#project-structure)
- [Extension icon](#extension-icon)
- [Publisher & metadata](#publisher--metadata)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ | LTS recommended |
| npm | 9+ | Ships with Node |
| Cursor / VS Code | ^1.85.0 | For running & debugging |
| `@vscode/vsce` | 3.x | Installed as a dev dependency |

To publish to the Marketplace you also need a **publisher account** and a **Personal Access Token** — see [Versioning & publishing](#versioning--publishing).

## Getting started

```bash
# 1. Clone
git clone https://github.com/nguyenvinhtieng/cursor-token-tracker.git
cd cursor-token-tracker

# 2. Install dependencies
npm install

# 3. Build once
npm run compile
```

## Everyday development

```bash
# Rebuild automatically on every file change (esbuild watch)
npm run watch

# Type-check without emitting output
npm run typecheck

# Remove build artifacts (dist/ and *.vsix)
npm run clean
```

## Debugging (F5)

1. Open this folder in Cursor / VS Code.
2. Go to **Run and Debug** → select **Run Extension** → press **F5**.
3. A new **Extension Development Host** window opens with the extension loaded.
4. Make code changes, then **Reload** the host window (`Cmd+R`) to pick them up.
   Keep `npm run watch` running in a terminal so the bundle is always fresh.

## Packaging a `.vsix`

```bash
# Compile + create cursor-usage-tracker-<version>.vsix
npm run package
```

Install the packaged build into your local Cursor to test it:

```bash
# Installs the most recently built .vsix
npm run install:local
```

Or do a full clean → build → install in one step:

```bash
npm run buildinstall
```

You can also install manually: **Extensions → `⋯` → Install from VSIX…**

## Versioning & publishing

The scripts use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

### One-time publisher setup

```bash
# Log in with your Marketplace publisher ID (creates/stores a token)
npx vsce login <publisher>
```

You'll be prompted for an [Azure DevOps Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token).

### Bump the version only (no publish)

These update `package.json`, create a git commit and a `v<version>` tag:

```bash
npm run version:patch   # 0.1.0 → 0.1.1  (bug fixes)
npm run version:minor   # 0.1.0 → 0.2.0  (new features)
npm run version:major   # 0.1.0 → 1.0.0  (breaking changes)

# Then push the commit and the tag
git push --follow-tags
```

### Bump + package + publish in one step

`vsce publish <segment>` automatically bumps the version, packages, and publishes:

```bash
npm run publish:patch   # bump patch → publish
npm run publish:minor   # bump minor → publish
npm run publish:major   # bump major → publish
```

Publish the current version as-is (no bump):

```bash
npm run publish
```

Build and publish the current version without bumping:

```bash
npm run release
```

> **Tip:** run `npm run typecheck && npm run package` before publishing to catch problems early. Commit or stash your changes first — `vsce publish` refuses to run with a dirty tree unless you pass `--allow-dirty`.

## npm scripts reference

| Script | What it does |
|---|---|
| `npm run compile` | Bundle `src/` → `dist/extension.js` with esbuild |
| `npm run watch` | Same as compile, rebuilding on every change |
| `npm run typecheck` | `tsc --noEmit` — type-check only |
| `npm run clean` | Delete `dist/` and any `*.vsix` |
| `npm run package` | Compile + `vsce package` → `*.vsix` |
| `npm run install:local` | Install the newest local `*.vsix` into Cursor |
| `npm run buildinstall` | clean → package → install locally |
| `npm run version:patch\|minor\|major` | Bump version, commit, tag (no publish) |
| `npm run publish` | Publish the current version to the Marketplace |
| `npm run publish:patch\|minor\|major` | Bump version + package + publish |
| `npm run release` | Compile + publish current version |

## Project structure

```
src/
  api/          # Cursor usage API client
  auth/         # Token reader (state.vscdb / keychain)
  config/       # Budget settings
  guard/        # Guards / validation
  metrics/      # Usage aggregation and formatting
  session/      # Chat session tracker
  ui/           # Status bar + detail panel
  extension.ts  # Entry point (activate / deactivate)

esbuild.js      # Bundler config
tsconfig.json   # TypeScript config
.vscodeignore   # Files excluded from the packaged .vsix
```

## Extension icon

Place the icon at `images/icon.png` (already referenced in `package.json`).

- Format: **PNG**
- Recommended size: **128×128 px**

Rebuild after replacing it (`npm run package`).

## Publisher & metadata

Edit these fields in `package.json` before publishing:

| Field | Purpose |
|---|---|
| `publisher` | Marketplace publisher ID (must match your `vsce login`) |
| `author` | Author information |
| `repository` | Repository URL |
| `homepage` / `bugs` | Links shown on the Marketplace page |
| `icon` | Path to `images/icon.png` |
| `version` | Managed by the `version:*` / `publish:*` scripts |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `vsce: command not found` | Use `npx vsce …` or run via the npm scripts (vsce is a dev dependency) |
| Publish rejected: *dirty working tree* | Commit/stash changes, or add `--allow-dirty` |
| Publish rejected: *missing repository* | Ensure `repository.url` is set in `package.json` |
| `install:local` installs the wrong build | Run `npm run clean` first so only the newest `.vsix` remains |
| Changes not showing in the dev host | Keep `npm run watch` running and reload the host window (`Cmd+R`) |
