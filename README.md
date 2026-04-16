# TagOps

[![CI](https://github.com/ToroSachi/tagops/actions/workflows/ci.yml/badge.svg)](https://github.com/ToroSachi/tagops/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Infrastructure-as-code for Google Tag Manager. Install vendor pixels with one command, catch the Consent Mode v2 misconfigs that silently cost accounts conversion data, and treat your container like production.

---

## Why this exists

On July 21, 2025, Google enforced Consent Mode v2 signal requirements for EEA/UK traffic. No banner, no email, no grace period.

Accounts that hadn't wired `ad_user_data` and `ad_personalization` through their GTM layer saw observed Google Ads conversions drop up to 90% overnight. [Matomo reported](https://ppc.land/consent-mode-v2-enforcement-is-silently-breaking-google-ads-conversions/) 90–95% metric drops across affected EEA sites. Only ~40% of the lost data was recoverable through behavioral modeling. The rest is gone permanently.

None of this is visible in the GTM UI.

TagOps is a CLI that finds these misconfigurations, fixes them, and keeps them from coming back. Plus everything else you wish GTM had: vendor-pixel templates with consent + triggers + data layer included, snapshot/diff/restore, promotion between environments, a GitHub Actions compliance gate, and an MCP server for AI agents.

---

## The 30-second demo

```bash
npm install -g tagops
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
tagops init --import \
  --account-id 123 --container-id 456 --workspace-id 1 \
  --monthly-conversions 1000 --avg-value 85
```

Output (real run against a live 71-tag container):

```
  ✔ Container imported

  Config:      .gtmrc.json
  Snapshot:    gtm-snapshot.json
  Report:      consent-report-2026-04-16.md

  What's inside
    71 tags · 32 triggers · 69 variables · 0 folders

  Consent Mode v2 compliance
    76% (71 tags audited)
    ✖ 0 non-compliant · ⚠ 11 unconfigured

  EU data-loss exposure estimate
    Inputs: 1000 conversions/mo · 30% EEA share · $85 avg value
    Non-compliant tag share: 18%
    Affected conversions/mo:   ~54
    Gross monthly exposure:    ~$4,598
    Permanent loss/mo (est.):  ~$2,759
    Yearly permanent loss:     ~$33,108

  Next
    tagops consent-audit --fix --dry-run   # preview the fix
    tagops diff                              # after editing
    tagops templates list                    # install vendor pixels
    tagops init --ci                         # add a GitHub Actions gate
```

One command. In under a minute you have: a tracked `.gtmrc.json`, a full snapshot suitable for Git, a shareable Markdown compliance report, and a CFO-grade dollar exposure estimate.

> The estimate assumes Google's ~40% modeling recovery rate (field data from [Harvest Digital](https://ppc.land/consent-mode-v2-enforcement-is-silently-breaking-google-ads-conversions/)). Your numbers may vary by traffic mix and CMP behavior. Drop `--monthly-conversions` and `--avg-value` to skip the dollar estimate.

---

## The three core capabilities

### 1. Vendor pixel templates — not tag shells, full implementations

```bash
tagops templates install meta-pixel --pixel-id 123456789
```

Installs tags + triggers + consent settings + data layer variables + input validation. One command. Not Google's Community Gallery, where you get an empty tag shell and a 12-step vendor doc.

### 2. Consent Mode v2 audit

```bash
tagops consent-audit              # interactive
tagops consent-audit --report     # shareable Markdown with data-loss estimates
tagops consent-audit --fix        # write the missing signals back
tagops consent-audit --score-only # CI gate — exits non-zero below threshold
```

Catches the specific misconfigurations behind documented 90% conversion drops. See a [sample report](docs/sample-consent-report.md).

### 3. IaC — snapshot, diff, restore, promote

```bash
tagops snapshot --git-commit           # versioned, committed to your repo
tagops diff                            # what changed since yesterday?
tagops plan snapshots/before.json      # risk: low / medium / high / critical
tagops restore snapshots/before.json
tagops promote --source staging --target production --dry-run
```

Promotion enforces `dev → staging → production`. Stage-skipping is rejected.

---

## 32 vendor templates

| Category                | Vendors                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Analytics               | GA4 Ecommerce, Microsoft Clarity, Hotjar, Mixpanel, PostHog, Yandex Metrica                                                      |
| Advertising             | Meta Pixel, Meta Pixel Advanced, Google Ads, TikTok, LinkedIn Insight, Pinterest, Snapchat, Reddit, X/Twitter, Bing UET, Taboola |
| Marketing / CRM         | Klaviyo, HubSpot, Intercom, Retention.com, AddShoppers                                                                           |
| Affiliate / Attribution | Impact.com, Amazon Attribution, CRM Offline Conversions                                                                          |
| Publisher / Platform    | Shopify Custom Pixel, Magellan AI, AspireIQ, Artsai/iHeart, Ascendia, Checkmate, Vibe                                            |

Run `tagops templates list` for the current set. The `meta-pixel-advanced` template ships 15 standard events with Advanced Matching, Consent Mode v2 wiring, and CAPI dedup — use it when Event Match Quality is a priority. Templates export as portable JSON so agencies can bundle a client-specific integration stack:

```bash
tagops templates bundle create --name standard-ecom \
  --template meta-pixel:pixelId=123456789 \
  --template ga4-ecommerce:measurementId=G-ABCDEF1234 \
  --template tiktok-pixel:pixelId=CXXXXXXXXXXXXXXXXX
tagops templates bundle install standard-ecom.bundle.json
```

---

## Status

**Early.** v0.1 — being prepared for first public release. See [ROADMAP.md](ROADMAP.md).

- 32 vendor templates · 332 tests · MCP server · MIT license
- Browser OAuth login requires `TAGOPS_CLIENT_ID` / `TAGOPS_CLIENT_SECRET` (bring your own OAuth client) — service-account auth works out of the box
- Two templates (GA4 event tags, Google Ads Enhanced Conversions) are preview-only pending native tag-creation support; both are priority for v0.2
- Aggressive PR-merge policy during launch: reasonable vendor-template PRs merged within 48 hours

---

## AI agent integration (MCP)

TagOps ships a [Model Context Protocol server](src/server.ts) so Claude, ChatGPT, and other MCP-aware agents can inspect containers and install tracking on your behalf.

```json
{
  "mcpServers": {
    "tagops": {
      "command": "tagops-mcp",
      "args": ["--read-only"],
      "env": { "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/sa.json" }
    }
  }
}
```

`tagops-mcp` installs alongside `tagops` when you `npm install -g tagops`. Start read-only; grant write access once you trust the workflow.

---

## Governance

Preset policy packs — one flag, full compliance config:

| Pack              | Enforces                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| `gdpr-strict`     | Consent Mode v2, `ad_user_data` for Meta/Ads, no `document.write`, Meta event-ID dedup |
| `ccpa-baseline`   | US State Privacy minimum: `ad_storage` on ads, `analytics_storage` on analytics        |
| `agency-standard` | Naming conventions, orphan cleanup, SPA safety, vendor-consent matrix                  |

```bash
tagops init --policies gdpr-strict   # writes .tagops-policies.json
tagops policy-check                  # enforce
tagops init --ci                     # scaffold a GitHub Actions gate
```

---

## Configuration — `.gtmrc.json`

```json
{
  "accountId": "123456789",
  "containerId": "111111111",
  "workspaceId": "1",
  "promotionFlow": ["development", "staging", "production"],
  "profiles": [
    {
      "name": "development",
      "accountId": "123456789",
      "containerId": "111111111",
      "workspaceId": "2"
    },
    { "name": "staging", "accountId": "123456789", "containerId": "222222222", "workspaceId": "3" },
    {
      "name": "production",
      "accountId": "123456789",
      "containerId": "333333333",
      "workspaceId": "4"
    }
  ]
}
```

`.gtmrc.json` is `.gitignore`d because it contains real container IDs. Commit it only if your repo is private.

---

## Compared to what's out there

| Tool                                                                      | Type          | What it does                                             | What it misses                               |
| ------------------------------------------------------------------------- | ------------- | -------------------------------------------------------- | -------------------------------------------- |
| [owntag/gtm-cli](https://github.com/owntag/gtm-cli)                       | CLI           | Low-level wrapper over the GTM API                       | Templates, consent audit, IaC, policies      |
| [Stape GTM MCP](https://stape.io/blog/mcp-server-for-google-tag-manager)  | MCP           | GTM CRUD via Claude                                      | Templates, consent audit, IaC, policies, CLI |
| paolobtl GTM MCP                                                          | MCP           | Community GTM CRUD MCP                                   | Same — thin wrapper, no governance           |
| [Google GA4 MCP](https://developers.google.com/analytics/devguides/MCP)   | MCP           | Read GA4 reporting data                                  | Not a write path; doesn't touch GTM          |
| [WodenWang820118/tag-check](https://github.com/WodenWang820118/tag-check) | GUI           | Electron QA tool for tag firing                          | No install / no governance                   |
| Google Community Template Gallery                                         | GTM UI        | Empty tag shells for template authors                    | Triggers, consent, data layer mapping        |
| GTM 360 (paid)                                                            | GTM UI        | Approval workflows, zones                                | Only for Google Marketing Platform customers |
| **TagOps**                                                                | **CLI + MCP** | **Templates + Consent Audit + IaC + Policies + CI gate** | **Early-stage, small team**                  |

The moat is the governance layer, not the GTM API. Existing CLIs and MCPs are CRUD wrappers. TagOps is an opinionated control plane.

---

## Contributing

```bash
npm install
npm run dev -- --help
npm test              # 318 tests
npm run build
```

**Highest-impact contribution: add a vendor template.** Create a file in `src/templates/vendors/`, export it from `vendors/index.ts`, add a test. Template PRs are targeted for merge within 48 hours during the v0.1 launch window. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
