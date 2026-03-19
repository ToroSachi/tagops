# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [4.0.0] - 2026-03-17 — **TagOps**

### Changed
- **BREAKING:** Renamed package from `gtm-auto` to `tagops`. Binary is now `tagops` instead of `gtm-auto`.
- **sync.ts:** Refactored sync engine to use `gtm-cli.ts` library functions instead of direct API calls. Added deep Variable ID mapping inside Trigger filters.
- **gtm-cli.ts:** Added `updateTrigger` and `updateVariable` functions. Exported `getGtmClient` and `getWorkspacePath` for reuse.
- All CLI help text, error messages, CI templates, and documentation now reference `tagops`.

## [3.1.1] - 2026-03-17

### Fixed
- **restore**: Variable creation was silently broken — stub hardcoded `success = false` despite `createVariable` existing in `gtm-cli.ts`. Now correctly calls `createVariable` to restore deleted variables.
- **cli.ts / server.ts**: Version was hardcoded as `2.4.0` while `package.json` specified `3.0.0`. Both now read version dynamically from `package.json`.
- **cli.ts**: `require("node:fs")` used inside ESM module replaced with proper `existsSync` import.
- **cli.ts**: Removed eager top-level `PixelTagInput` type import; now uses inline `import()` type assertion.
- **audit.ts**: `AD_VENDORS` set used duplicate case entries (e.g. both "Meta" and "meta") with case-sensitive `startsWith`. Replaced with case-insensitive matching using a lowercase prefix array.

### Changed
- README: Added "Who Is This For?" section with target persona table
- README: Added "Limitations & Known Constraints" section for transparency
- README: Toned down emoji density in feature list for professional tone

## [3.1.0] - 2026-03-17

### Added
- `tagops health-score` — Composite container health grade (A-F, 0-100) covering consent, naming, hygiene, custom HTML risk, trigger coverage, duplicates, and container size
- `tagops enhanced-conversions` — Google Ads Enhanced Conversions validator (user-data tag pairing, consent, PII collection)
- `tagops sst-readiness` — Server-side tagging migration readiness assessment with per-tag effort estimates
- `tagops sync` — Multi-container sync engine with intelligent ID mapping (Variables → Triggers → Tags)
- `tagops test-datalayer` — Headless browser data layer E2E tester (Puppeteer + AJV JSON Schema)
- `tagops validate-capi` — Offline Meta Conversions API and TikTok Events API payload validator (SHA-256, deduplication, required fields)
- `crm-offline-conversions` template — GCLID/WBRAID/GBRAID capture for CRM offline imports
- MCP tools: `gtm_health_score`, `gtm_enhanced_conversions`, `gtm_sst_readiness`, `gtm_sync_containers`, `gtm_test_datalayer`, `gtm_validate_capi`

### Changed
- Zero `as any` casts in production code (eliminated 10 remaining in `sync.ts` via typed request body interfaces)
- Fixed typo in CAPI validator error message ("requried" → "required")
- Removed 5 dead code paths in `gtm-cli.ts` (unreachable returns after `handleApiError`)
- Replaced `process.exit(0)` in `sync.ts` library code with return value
- Fixed duplicate comment numbering in `auth.ts`
- Total: **190 tests** across 16 test files, **29 tool files**, **22 MCP tools**, **20 templates**

## [3.0.0] - 2026-03-17

### Added
- `tagops consent-audit` — Consent Mode v2 deep auditor with compliance scoring (0-100%), auto-fix, and CI gate support
- `tagops doctor` — Full diagnostic check (Node.js, config, auth, API, resources, compliance)
- `tagops compare` — Multi-container comparison across profiles (tags, triggers, variables)
- `tagops notify` — Slack/Teams webhook notifications for audit results, deploys, and drift
- `gtmrc.schema.json` — JSON Schema for IDE autocomplete and validation of `.gtmrc.json`
- MCP tools: `gtm_consent_audit`, `gtm_doctor`, `gtm_compare_containers`, `gtm_notify`

### Changed
- **Breaking:** Version bump to v3.0.0 reflecting scope of new features
- Fixed 2 audit type reuse bugs (`NO_TRIGGERS` was masking `DUPLICATE_NAME` and `DOC_WRITE_ENABLED`)
- GitHub Actions scaffolder now includes consent-audit CI gate and nightly drift detection

### Removed
- Deleted legacy `mcp-server/` directory (replaced by `src/server.ts`)
- Deleted legacy `scripts-legacy/` directory (all functionality ported to TypeScript)

## [2.4.0] - 2026-03-17

### Added
- `tagops lint` — Configurable compliance linter with consent, custom HTML, and naming convention rules
- `tagops graph` — Mermaid.js visual dependency graph generator
- `tagops init-ci` — GitHub Actions CI/CD scaffolding
- Production-readiness: sanitized all private data, added LICENSE, CONTRIBUTING.md

### Changed
- Account-specific values now loaded exclusively from `.gtmrc.json` (no hardcoded defaults)

## [2.3.0] - 2026-03-17

### Added
- `tagops changelog` — Human-readable diff between two snapshots
- `tagops validate-datalayer` — Schema-based data layer validation with browser capture script
- `tagops publish` — Create and publish GTM workspace versions with safety rails

## [2.2.0] - 2026-03-16

### Added
- `tagops cleanup` — Interactive wizard to delete unused variables, orphaned triggers, and paused tags
- `tagops docgen` — Auto-generates a full markdown data dictionary
- Multi-container profiles via `--profile` flag and `profiles` command

## [2.1.0] - 2026-03-14

### Added
- Infrastructure-as-code: `snapshot`, `diff`, `restore` commands
- 18 pre-built integration templates (GA4, Meta, TikTok, Reddit, Pinterest, Snapchat, etc.)
- Template commands: `list`, `preview`, `install`, `validate`
- Batch deploy from JSON manifest
- MCP server with 9+ AI-accessible tools

## [1.0.0] - 2026-03-12

### Added
- Initial TypeScript CLI toolkit
- Core commands: `init`, `status`, `audit`, `backup`
- Fix commands: `fix-consent`, `fix-triggers`, `create-pixel`, `create-artsai`
- Configuration management via `.gtmrc.json`
