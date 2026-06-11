.PHONY: setup dev dev-web build build-web test test-single lint format format-check \
       fmt-check clippy-check test-lua test-browser test-tauri test-e2e test-all \
       setup-vendors tauri-info clean

PNPM := corepack pnpm

## Setup (first time or after pulling new commits)

setup: ## Install dependencies and vendor assets
	git submodule update --init --recursive
	$(PNPM) install
	$(PNPM) --filter @readest/readest-app setup-vendors

setup-vendors: ## Copy pdfjs, simplecc, jieba to public/
	$(PNPM) --filter @readest/readest-app setup-vendors

tauri-info: ## Verify Tauri dependencies
	$(PNPM) tauri info

## Development

dev: ## Desktop dev (Tauri + Next.js)
	$(PNPM) tauri dev

dev-web: ## Web-only dev server (no Rust needed)
	$(PNPM) dev-web

## Building

build: ## Production desktop build
	$(PNPM) tauri build

build-web: ## Web build
	$(PNPM) build-web

## Testing

test: ## Unit tests (vitest + jsdom)
	$(PNPM) test

test-single: ## Run a single test file. Usage: make test-single FILE=src/__tests__/utils/misc.test.ts
	$(PNPM) test -- $(FILE)

test-lua: ## Lua tests for the KOReader plugin
	$(PNPM) test:lua

test-browser: ## Browser tests (Chromium via Playwright)
	$(PNPM) --filter @readest/readest-app test:browser

test-tauri: ## Tauri integration tests (requires running app with webdriver)
	$(PNPM) --filter @readest/readest-app test:tauri

test-e2e: ## E2E tests (Playwright, web)
	$(PNPM) --filter @readest/readest-app test:e2e:web

test-all: ## All tests: unit + browser + tauri
	$(PNPM) test -- --run && $(PNPM) test:browser && $(PNPM) test:tauri

## Linting & Formatting

lint: ## Biome lint + tsgo type check
	$(PNPM) lint

format: ## Format all JS/TS/CSS/JSON (Biome)
	$(PNPM) format

format-check: ## Check formatting without writing (Biome)
	$(PNPM) format:check

## Rust (src-tauri)

fmt-check: ## Check Rust formatting
	$(PNPM) fmt:check

clippy-check: ## Lint Rust code
	$(PNPM) clippy:check

## Cleanup

clean: ## Remove build artifacts
	rm -rf apps/readest-app/.next apps/readest-app/.open-next apps/readest-app/out
	rm -rf apps/readest-app/src-tauri/target

## Help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
