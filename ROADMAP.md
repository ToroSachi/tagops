# Roadmap

Written against reality. Dated 2026-04-16.

---

## Thesis

One command per vendor replaces pages of implementation docs. That's the wedge. Consent Mode v2 auditing, snapshot/diff/restore, and MCP are support for that wedge — not separate products.

```bash
tagops templates install meta-pixel --pixel-id 123456789
tagops consent-audit --report
tagops snapshot && tagops diff
```

Everything on this roadmap traces back to one question: _does this make it easier to install, audit, or manage a vendor tracking implementation in GTM?_

---

## Current state — v0.1 (unreleased)

|              |                                                                                   |
| ------------ | --------------------------------------------------------------------------------- |
| Templates    | 24 vendor integrations                                                            |
| CLI commands | 19 top-level (down from 55 in previous drafts)                                    |
| MCP tools    | ~20 (kept; free differentiator)                                                   |
| Tests        | 318 across 29 files                                                               |
| Distribution | Not on npm, repo not public yet                                                   |
| OAuth        | Browser flow requires user-provided client; service account is the supported path |

---

## v0.1 — Ship it (next)

**Goal: 10 strangers install this in 30 days.**

| Item                                                                      | Why                                      |
| ------------------------------------------------------------------------- | ---------------------------------------- |
| Create public `github.com/ToroSachi/tagops`                               | Repo is 404 today                        |
| Publish `tagops@0.1.0` to npm                                             | Package name is available                |
| Record a 45-second demo GIF of `consent-audit --report`                   | The consent report is the hook           |
| Post to r/GoogleTagManager, Measure Slack `#gtm`, Show HN                 | Three channels. Measure response.        |
| Write one blog post: "we lost X% of EU conversion data before catching Y" | Shareable narrative, not a feature list  |
| Rotate the old GCP OAuth client                                           | Hygiene (separate action in GCP console) |

If no response in 30 days: stop building. The premise needs a pivot, not more code.

---

## v0.2 — Template completeness

Only after v0.1 gets signal. The remaining templates with `installMode: "unsupported"`:

- [ ] `ga4-ecommerce` — full `gaawe` tag creation
- [ ] `google-ads` — `googtag`, `gclidw`, `awct`, Enhanced Conversions

Both exist as preview-only today. Converting them to full install is the gating bug for "one command → complete Meta + GA4 + Ads stack."

---

## v0.3 — Template ecosystem (conditional)

Only if v0.1 demonstrates external users want this. Don't build it first.

- [ ] Documented template JSON format so non-TypeScript users can author templates
- [ ] `templates.tagops.dev` — SEO-focused registry site
- [ ] Aggressively accept vendor-template PRs

---

## v0.4 — Drift + governance (conditional)

Only if paying users or agencies ask:

- [ ] Scheduled drift alerting (`watch` + webhook)
- [ ] `promote --require-approval`
- [ ] Scheduled consent audits → Slack

---

## v1.0+ — Commercial (very conditional)

Bootstrap path. Not VC scale. See [DISTRIBUTION.md](DISTRIBUTION.md) for the honest numbers.

- Hosted scheduled audits (cron + alerts) as the most shippable paid product
- Agency-tier bundle sharing
- Enterprise SSO + audit logs

---

## Not on the roadmap

| Rejected                           | Why                                                     |
| ---------------------------------- | ------------------------------------------------------- |
| Web UI / dashboard                 | GTM has a UI. CLI-first is the differentiator.          |
| Browser DevTools / extensions      | ConsentFlow-Debugger exists; don't compete.             |
| Our own CMP / cookie banner        | OneTrust + CookieBot own this. We audit their output.   |
| Real-time tag debugging            | GTM Preview handles this.                               |
| Multi-TMS support (Tealium, Adobe) | Only after GTM coverage is comprehensive and monetized. |
| Feature catching-up to GTM 360     | Chasing a paid Google product is not the play.          |

---

## Contributing

Best contribution: a new vendor template. File in `src/templates/vendors/`, exported from `index.ts`, plus a test. See an existing template (e.g. `meta-pixel.ts`) as reference.

Runner-up: a real-world container report via GitHub issue — what did TagOps miss on your setup? That's the highest-signal data we can get at this stage.
