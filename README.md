# TagOps

**Opinionated Google Tag Manager operations toolkit.** Audit, diff, sync, validate, and publish GTM workspaces from the command line.

[![npm version](https://img.shields.io/npm/v/tagops?color=cb0000&label=npm)](https://www.npmjs.com/package/tagops)
[![CI](https://github.com/gtm-auto/gtm-auto/actions/workflows/ci.yml/badge.svg)](https://github.com/gtm-auto/gtm-auto/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-222%20passing-brightgreen)]()

---

## Table of Contents

- [Why?](#why)
- [Who Is This For?](#who-is-this-for)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Templates](#available-templates)
- [MCP Server](#mcp-server)
- [Comparison](#comparison)
- [Project Structure](#project-structure)
- [Contributing](#contributing)

---

## Why?

GTM already has version history, workspaces, and an API, but it is still hard to bring Git-native review, repeatable policy checks, and scripted rollout discipline to real teams.

**tagops** adds that operational layer. It treats your GTM container more like source code:

- **Snapshot** your container and store it in Git
- **Diff** changes between versions
- **Changelog** for stakeholders ("3 tags added, consent changed on Meta")
- **Lint** to enforce consent, naming conventions, and block dangerous custom HTML
- **Publish** workspace versions with safety rails
- **Validate** your dataLayer events before they hit production
- **Graph** the dependency tree of your entire container as a Mermaid diagram
- **CI/CD** scaffolding for GitHub Actions
- **Sync** a golden template across multiple client containers
- **Health Score** — single A-F grade for container quality
- **Consent Mode v2** deep auditor with auto-fix
- **Server-Side Readiness** — assess sGTM migration complexity
- **Data Layer E2E Testing** — headless browser + JSON schema validation
- **CAPI Validator** — offline Meta/TikTok server-side payload debugging

## Who Is This For?

| Persona                           | How tagops helps                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| **Agencies managing 10+ clients** | Multi-container sync, health scoring for client decks, consent compliance, template reuse |
| **Enterprise Marketing Ops**      | Version control, CI/CD gates, audit trails, compliance reporting                          |
| **eCommerce Analytics Teams**     | Data layer validation, pixel template rollout, Shopify Custom Pixel scaffolding           |
| **Solo GTM Consultants**          | Audit reports, documentation generation, snapshot backups                                 |

## Quick Start

```bash
# Install
npm install -g tagops

# Or run without installing
npx tagops --help

# Initialize for your container
tagops init --account-id <YOUR_ACCOUNT_ID> --container-id <YOUR_CONTAINER_ID>

# Check connectivity
tagops status

# Take your first snapshot
tagops snapshot
```

### Prerequisites

- **Node.js** v18+
- **Google Cloud Service Account** with access to your GTM Container, or a Google OAuth client that your Workspace allows.

Authenticate your CLI environment (one-time setup):

```bash
# Recommended: use a Service Account key
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"

# Or ask tagops to help wire the key path
tagops auth login --key-file /path/to/key.json

# Browser OAuth also works in some environments
tagops auth login
```

---

## Commands

### Core

```bash
tagops init [--account-id] [--container-id]    # Initialize .gtmrc.json
tagops auth login [--key-file]                 # Browser OAuth or service-account helper
tagops auth status                             # Check auth status
tagops doctor                                  # Run full diagnostics
tagops status                                  # Quick health check
tagops audit                                   # Audit for misconfigurations
tagops backup [--output-dir]                   # Backup workspace to JSON
tagops cleanup [--scan-only]                   # Find/delete unused resources
tagops docgen [--output file]                  # Generate data dictionary markdown
tagops graph [--output file]                   # Generate Mermaid.js dependency graph
tagops watch [--interval 5] [--webhook <url>]  # Monitor GTM for undocumented drift
```

### Infrastructure as Code

```bash
tagops snapshot [--output file]                # Save full workspace state
tagops diff [--snapshot file]                  # Compare current vs snapshot
tagops changelog [--from a.json] [--to b.json] # Human-readable changelog
tagops restore <file> [--dry-run] [--no-delete] # Restore from snapshot
tagops publish --name "v1.5" [--confirm]       # Create/publish a version
```

### Governance & Compliance

```bash
tagops consent-audit                           # Consent Mode v2 deep audit (compliance score)
tagops consent-audit --fix                     # Auto-fix non-compliant tags
tagops consent-audit --score-only              # Just the score (for CI gates)
tagops lint [--config gtm-lint.json]           # Run compliance rules
tagops health-score                            # Container health score (A-F grade, 0-100)
tagops enhanced-conversions                    # Validate Google Ads Enhanced Conversions setup
tagops sst-readiness                           # Server-side tagging migration readiness score
tagops validate-datalayer --capture-script     # Get browser capture script
tagops validate-datalayer --captured events.json # Validate captured events
```

### Multi-Container Management

```bash
tagops compare --source prod --target staging  # Diff two containers by profile
tagops sync --source prod --target staging     # Sync resources from source → target
tagops sync --source prod --target staging --dry-run  # Preview sync without changes
tagops notify --webhook <url> --event publish \
  --message "v1.5 deployed"                      # Slack/Teams notification
```

### Enterprise CI/CD

```bash
tagops test-datalayer --url https://example.com \
  --schema ./purchase.schema.json                # Headless data layer E2E test
tagops test-datalayer --url https://example.com \
  --event purchase --click ".buy-btn"            # Click + validate workflow
tagops validate-capi --platform meta \
  --payload ./event.json                         # Validate Meta CAPI payload offline
tagops validate-capi --platform tiktok \
  --payload ./event.json                         # Validate TikTok Events API payload
```

### Integration Templates (20 built-in definitions)

```bash
tagops templates list                          # Show all integrations
tagops templates preview <name> --pixel-id <id> # Preview HTML before install
tagops templates install <name> --pixel-id <id> # Install supported template resources
tagops templates validate <name> --pixel-id <id> # Check installed tags match
```

### Batch Deploy

```bash
tagops deploy --init                           # Create a starter manifest
tagops deploy manifest.json --dry-run          # Preview batch install
tagops deploy manifest.json                    # Install all from manifest
```

### CI/CD

```bash
tagops init-ci                                 # Scaffold GitHub Actions
```

### Multi-Container Profiles

```bash
tagops profiles                                # List available profiles
tagops --profile staging audit                 # Run audit on staging
tagops --profile production snapshot           # Snapshot production
```

### Global Options

```bash
tagops --json <command>           # JSON output (for scripting/piping)
tagops --profile <name> <command> # Target a specific container profile
tagops --version                  # Show version
```

---

## Configuration

### `.gtmrc.json`

```json
{
  "$schema": "./node_modules/tagops/gtmrc.schema.json",
  "accountId": "123456789",
  "containerId": "987654321",
  "workspaceId": "1",
  "ga4MeasurementId": "G-XXXXXXXXXX",
  "profiles": [
    {
      "name": "staging",
      "accountId": "123456789",
      "containerId": "111222333",
      "workspaceId": "2"
    }
  ]
}
```

Run `tagops init` to create one interactively.

### Lint Rules (`gtm-lint.json`)

```json
{
  "require-consent": true,
  "block-custom-html": false,
  "naming-conventions": {
    "tags": "^(GA4|Meta|TikTok|Reddit) ",
    "variables": "^(DLV|JS|CJS|CONST) - ",
    "triggers": "^(CE|PV|Click) - "
  }
}
```

---

## Available Templates

| Template                  | Vendor        | Events                                                              |
| ------------------------- | ------------- | ------------------------------------------------------------------- |
| `ga4-ecommerce`           | Google        | page_view, view_item, add_to_cart, begin_checkout, purchase         |
| `crm-offline-conversions` | Google        | GCLID/WBRAID/GBRAID capture for offline imports                     |
| `meta-pixel`              | Meta          | PageView, ViewContent, AddToCart, InitiateCheckout, Purchase        |
| `google-ads`              | Google        | Purchase conversion + remarketing                                   |
| `tiktok-pixel`            | TikTok        | PageView, ViewContent, AddToCart, InitiateCheckout, CompletePayment |
| `reddit-pixel`            | Reddit        | PageVisit, ViewContent, AddToCart, Purchase                         |
| `taboola-pixel`           | Taboola       | PRODUCT_VIEW, ADD_TO_CART, CHECKOUT, PURCHASE                       |
| `pinterest-tag`           | Pinterest     | PageVisit, ViewCategory, AddToCart, Checkout                        |
| `snapchat-pixel`          | Snapchat      | PAGE_VIEW, VIEW_CONTENT, ADD_CART, PURCHASE                         |
| `klaviyo`                 | Klaviyo       | Onsite tracking                                                     |
| `shopify-custom-pixel`    | Shopify       | All 8 checkout events                                               |
| `impact-com`              | Impact        | UTT + trackConversion                                               |
| `retention-com`           | Retention.com | geq.js page tracking                                                |
| `artsai-iheart`           | Artsai        | Page view + conversion                                              |
| `minty-addshoppers`       | AddShoppers   | Widget + conversion                                                 |
| `ascendia-prime`          | Ascendia      | Retargeting script                                                  |
| `checkmate`               | Checkmate     | Attribution tracking                                                |
| `vibe-pixel`              | Vibe          | Community template pixel                                            |
| `aspireiq`                | AspireIQ      | Click + conversion                                                  |
| `magellan-ai`             | Magellan AI   | View, AddToCart, Checkout, Purchase                                 |

---

## MCP Server

AI-powered GTM management via the [Model Context Protocol](https://modelcontextprotocol.io):

```bash
npx tagops server
```

Exposes **22 tools** for AI agents including auditing, consent analysis, container comparison, syncing, data layer testing, CAPI validation, health scoring, and more.

---

## Project Structure

```text
src/
├── commands/                  # CLI command registration
├── lib/                       # Auth, config, GTM client, shared helpers
├── templates/                 # Integration template registry
├── tools/                     # Audit, sync, restore, validation, reporting
├── types/                     # GTM resource and schema types
├── ui-app/                    # Local dashboard frontend
├── cli.ts                     # CLI entry point
└── server.ts                  # MCP server
```

---

## Comparison

| Feature                          | **tagops**  | owntag/gtm-cli | GTM Web UI        |
| -------------------------------- | ----------- | -------------- | ----------------- |
| Snapshot / Diff / Restore        | ✅          | ❌             | ❌                |
| Consent Mode v2 Audit + Auto-Fix | ✅          | ❌             | ❌                |
| Health Score (A-F grade)         | ✅          | ❌             | ❌                |
| Lint / Naming Conventions        | ✅          | ❌             | ❌                |
| Multi-Container Sync             | ✅          | ❌             | ❌                |
| 20 Integration Templates         | ✅          | ❌             | Community Gallery |
| Data Layer E2E Testing           | ✅          | ❌             | Tag Assistant     |
| CAPI Payload Validation          | ✅          | ❌             | ❌                |
| MCP Server (AI Agents)           | ✅ 22 tools | ❌             | ❌                |
| CI/CD Scaffolding                | ✅          | ❌             | ❌                |
| CRUD API Wrapper                 | ✅          | ✅             | ✅                |
| JSON Output                      | ✅          | ✅             | ❌                |

---

## Limitations & Known Constraints

- **Integration templates** are point-in-time snapshots of vendor pixel code. Vendors may update their SDKs without notice, and some native GTM tag types still require GTM-specific finishing steps. Run `templates validate <name>` periodically to detect drift.
- **Data Layer E2E testing** (`test-datalayer`) uses Puppeteer and may produce flaky results behind auth walls, cookie consent banners, or highly dynamic SPAs.
- **MCP Server** is functional but the market for AI-driven GTM management is early-stage. Consider it an experimental feature.
- **Browser OAuth** may be blocked by strict Google Workspace policies until you provide an allowed OAuth client. Service Accounts remain the most reliable setup for CI/CD and locked-down orgs.
- **Restore** is safest for same-container recovery flows. If your container has been heavily restructured since the snapshot, manual review of the `--dry-run` output is recommended.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
