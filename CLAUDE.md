# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

Readest is an open-source cross-platform ebook reader. A single TypeScript/React + Rust codebase compiles to desktop (macOS/Windows/Linux), mobile (Android/iOS), and web (Cloudflare Workers). The web app lives at [web.readest.com](https://web.readest.com).

## Monorepo Structure

This is a **pnpm workspace** monorepo. The main application code is in `apps/readest-app/`; supporting packages are git submodules under `packages/`.

| Path | What it is |
|------|-----------|
| `apps/readest-app/` | **Primary app** — Next.js 16 + React 19 frontend, Tauri v2 Rust backend. See [`apps/readest-app/CLAUDE.md`](apps/readest-app/CLAUDE.md) for full app-level guidance. |
| `apps/readest.koplugin/` | KOReader plugin for syncing reading progress/annotations with Readest |
| `packages/foliate-js/` | Forked Foliate JS engine (EPUB/MOBI/FB2/CBZ/TXT/PDF parsing & rendering) — git submodule |
| `packages/tauri/` | Forked Tauri v2 framework — git submodule |
| `packages/tauri-plugins/` | Forked Tauri plugins workspace — git submodule |
| `packages/simplecc-wasm/` | Traditional/simplified Chinese conversion WASM module — git submodule |
| `packages/qcms/` | Color management (from Mozilla pdf.js) — git submodule |
| `packages/js-mdict/` | MDict dictionary format parser — git submodule |

**Cargo workspace** members: `apps/readest-app/src-tauri`, `packages/tauri/crates/tauri`, `packages/tauri-plugins/plugins/fs`.

## Commands (run from repo root)

```bash
# Setup (first time or after pulling new commits)
git submodule update --init --recursive
pnpm install
pnpm --filter @readest/readest-app setup-vendors   # copies pdfjs, simplecc, jieba to public/

# Development
pnpm tauri dev          # Desktop dev (compiles Rust + Next.js)
pnpm dev-web            # Web-only dev server (no Rust needed)

# Building
pnpm tauri build        # Production desktop build
pnpm build-web          # Web build (run from apps/readest-app: pnpm build-web)

# Testing (all delegate to @readest/readest-app)
pnpm test               # Unit tests (vitest + jsdom)
pnpm test:lua           # Lua tests for the KOReader plugin
pnpm lint                # Biome lint + tsgo type check

# Formatting (Biome, runs from root)
pnpm format             # Format all JS/TS/CSS/JSON
pnpm format:check       # Check formatting without writing
```

### Running a single test

Tests live under `apps/readest-app/src/__tests__/`. Run from repo root:

```bash
pnpm test -- src/__tests__/utils/misc.test.ts
```

## Architecture Overview

### Dual-router Next.js

The app uses **both** Next.js routers simultaneously:
- **App Router** (`src/app/`) — newer pages (library, reader, auth, OPDS, send, user) and new API endpoints (`src/app/api/`)
- **Pages Router** (`src/pages/`) — legacy reader entrypoint (`/reader/[ids]`), `_document.tsx` (COOP/COEP headers), and established API endpoints (`src/pages/api/`)

For Tauri targets, Next.js builds in **static export** mode (`output: 'export'`). For web, it runs as a Cloudflare Worker via OpenNext.

### Platform abstraction (AppService)

The central abstraction. `src/services/appService.ts` defines the interface; three implementations handle platform differences:

- `nativeAppService.ts` — Tauri desktop + mobile (calls Rust via `@tauri-apps/api invoke()`)
- `webAppService.ts` — Browser/web build (browser APIs + `fetch()` to `/api/*`)
- `nodeAppService.ts` — Node.js (tests, CLI tooling)

`src/services/environment.ts` picks the right one at runtime based on `NEXT_PUBLIC_APP_PLATFORM`. Most code accesses it via `useEnv().appService` and never knows which platform it's on.

The same pattern applies to the database layer: `webDatabaseService` (Turso WASM), `nativeDatabaseService` (Tauri plugin), `nodeDatabaseService` (Node).

### Book engine

EPUB/MOBI/KF8/FB2/CBZ/TXT/PDF rendering is handled by `packages/foliate-js` (a forked submodule). The reader UI in `app/reader/` wraps this engine. PDF rendering additionally uses `pdfjs-dist` vendored into `public/vendor/pdfjs/`.

### State management

Zustand stores in `src/store/`, each scoped to a single concern (`readerStore`, `libraryStore`, `bookDataStore`, `settingsStore`, etc.). No Redux, no single global store.

### Rust backend (`src-tauri/`)

Small and focused: command registration in `lib.rs`, plus `dir_scanner`, `transfer_file`, `clip_url`, `discord_rpc`, and platform-specific glue in `src/{macos,windows,android,ios}/`. Heavy lifting is in custom Tauri plugins (`src-tauri/plugins/`): `native-bridge`, `native-tts`, `turso`, `webview-upgrade`.

### Key cross-cutting subsystems

- **Sync**: Legacy KOReader sync + modern encrypted replica sync (`src/services/sync/`)
- **Cloud library**: Book file upload/download via S3 (`src/pages/api/storage/*`)
- **AI/RAG**: Provider-agnostic chat + embeddings (`src/services/ai/`, `src/app/api/ai/`)
- **Translation**: DeepL, Google, Azure, Yandex providers (`src/services/translators/`)
- **TTS**: Web Speech, native Tauri, Edge TTS backends (`src/services/tts/`)
- **Dictionaries**: StarDict/SLOB parsing + online sources (`src/services/dictionaries/`)
- **OPDS/Calibre**: Feed parsing, catalog browsing (`src/services/opds/`)
- **Send to Readest**: Browser extension + email → EPUB conversion → inbox (`src/services/send/`)

## Code Style

- **Formatter**: Biome — 2-space indent, single quotes, trailing commas, 100-char line width
- **Linter**: Biome with many rules relaxed (see `biome.json`). Notable: `noUnusedImports` is an error, `noExplicitAny` is an error
- **Type checking**: `tsgo` (TypeScript native preview) — run via `pnpm lint`
- **Rust**: `cargo fmt` and `cargo clippy` — run via `pnpm fmt:check` / `pnpm clippy:check`
- **Pre-commit**: Husky + lint-staged runs Biome format on staged JS/TS/CSS/JSON files

## Important Patterns

- **Path aliases**: `@/*` → `./src/*`, `@/components/ui/*` → `./src/components/primitives/*` (in `apps/readest-app`)
- **Git submodules**: Several `packages/` entries are submodules. Always run `git submodule update --init --recursive` after cloning or pulling.
- **Git worktrees**: Use `pnpm worktree:new <branch|pr>` from `apps/readest-app/` — never raw `git worktree add`. The script handles submodule init, deps, env, and vendor assets.
- **Env files**: `.env.tauri` for Tauri builds, `.env.web` for web builds. Platform-specific overrides use `.env.*.local` (gitignored).
- **i18n**: Key-as-content approach with `i18next`. Extract strings with `pnpm i18n:extract`. See `apps/readest-app/docs/i18n.md`.
- **E-ink mode**: All UI must work under `[data-eink='true']`. Use `eink-bordered` class and existing globals.css patterns. See `apps/readest-app/DESIGN.md` for the full design system.

## App-Level Documentation

Detailed app-specific guidance lives in `apps/readest-app/CLAUDE.md` (symlinked from `AGENTS.md`). Additional docs:

- `apps/readest-app/docs/architecture.md` — system-level architecture with Mermaid diagrams
- `apps/readest-app/docs/code-layout.md` — directory classification (server/client/mixed)
- `apps/readest-app/docs/testing.md` — three-tier test strategy (unit/browser/tauri/e2e)
- `apps/readest-app/DESIGN.md` — UI design system, primitives, e-ink rules, anti-patterns
