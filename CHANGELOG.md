# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

First public release.

### Added
- **`tagops init --import`** — one-command onboarding. Pulls the live container, writes `.gtmrc.json`, snapshots every tag/trigger/variable/folder, runs a Consent Mode v2 audit, and emits a shareable Markdown report. Verified end-to-end on a real 71-tag container.
- 24 vendor templates (Meta Pixel, GA4, Google Ads, TikTok, LinkedIn, Pinterest, Snapchat, Reddit, X, Bing UET, Taboola, Klaviyo, Impact.com, Shopify Custom Pixel, +10 more)
- `templates` subcommand: list, preview, install, validate, export, import, bundle create, bundle install
- `consent-audit` with `--report`, `--fix`, `--score-only`
- IaC flow: `snapshot`, `diff`, `plan`, `restore`, `publish`
- Preset policy packs: `gdpr-strict`, `ccpa-baseline`, `agency-standard`
- `lint`, `policy-check`, `report`, `audit`, `doctor`, `status`
- `promote` with environment enforcement (dev → staging → production)
- `drift` detection against snapshots
- `init-ci` — scaffold GitHub Actions compliance gate
- MCP server with ~20 agent tools (Claude, GPT, Gemini integration)

### Security
- OAuth client credentials removed from source tree. Browser auth now requires `TAGOPS_CLIENT_ID` / `TAGOPS_CLIENT_SECRET` or a service account.
- Error-message redaction via `src/lib/redaction.ts`.

### Notes
- Previous internal drafts used the `gtm-auto` name and bumped to 4.x. The public release starts at `tagops@0.1.0`. Prior version history is kept in git only.
