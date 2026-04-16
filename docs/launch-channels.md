# Launch channels — specific copy, specific places

_Research-backed. Don't improvise; fill these in and fire._

---

## Channel priority

| Rank | Channel                                                              | Why this fits                                             |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| 1    | [measure.chat](https://www.measure.chat/) Slack — `#gtm`, `#general` | 20k analytics engineers live here. Your audience.         |
| 2    | r/GoogleTagManager                                                   | ~35k subscribers. Pain-post voice plays well.             |
| 3    | LinkedIn — personal post + tag 3 GTM influencers                     | GTM practitioners are very active on LinkedIn.            |
| 4    | MeasureCamp newsletter / unconferences                               | The canonical meetup for this audience.                   |
| 5    | Simo Ahava's blog comments                                           | Simo responds to genuine technical questions; don't spam. |
| 6    | r/analytics, r/PPC, r/marketingops                                   | Adjacent pain; expect lower conversion.                   |
| 7    | awesome-mcp-servers PR                                               | Adds SEO for "GTM MCP."                                   |
| 8    | MCP directories (mcp.so, smithery.ai)                                | Cheap submissions, long-tail traffic.                     |

**Skip:** Show HN (GTM is off-topic, will be buried), Product Hunt (wrong audience, low-signal upvotes), Twitter/X cold posts without engagement base.

---

## Measure Slack post (paste in `#gtm`)

```
📎 Open-sourced a thing: TagOps — CLI for GTM.

Backstory: one of my accounts lost 90% of observed Google Ads conversions on July 21 2025 (CMv2 enforcement). The CMP banner looked fine. Turned out ad_user_data + ad_personalization weren't wired through at the GTM layer.

I got tired of catching these by eye, so TagOps runs a consent audit that names which tags are missing which signals, with a --fix flag that writes the corrections back. It also does the rest of what I've always wanted in the UI: snapshots, diffs, restore, per-environment promotion, a GitHub Actions gate, 24 vendor templates that actually include triggers + consent + data layer, and an MCP server for Claude.

MIT. Zero SaaS. Take it, break it, tell me what's wrong.

https://github.com/ToroSachi/tagops

Would especially love feedback from anyone running multi-client containers — the governance + promote story is mostly optimized for that shape.
```

_Etiquette:_ Post once. Don't cross-post to other Measure Slack channels. Respond to every reply. Don't DM members.

---

## r/GoogleTagManager post

**Title:**

> I built an open-source CLI that catches the Consent Mode v2 misconfigs that cost my client 90% of conversions last summer

**Body:**
Same voice as the Slack post but longer — include the 15-sec GIF link, one screenshot of the `consent-audit --report` output, and the `npm install -g tagops` line. End with: "Honest critique welcome. Especially if you've seen it get something wrong on a real container."

---

## LinkedIn post (personal)

```
Last July a client lost 90% of their observed Google Ads conversions overnight.

Not because the campaigns broke. Not because the site broke.
Because two specific Consent Mode v2 signals weren't wired through at the GTM layer — and Google quietly downgraded every EEA impression to non-consented.

No email. No banner. No diagnostic.

I built TagOps to catch this. It's open source, runs on any GTM container, and in 30 seconds tells you which tags are missing which consent signals. With a --fix flag.

Also includes:
— 24 vendor templates (Meta, GA4, TikTok, LinkedIn + 20 more) with consent + triggers + data layer done right
— Snapshot / diff / restore / environment promotion
— GitHub Actions gate so consent drops fail your PR
— MCP server for Claude / GPT / Gemini workflows

MIT license. No SaaS.

Repo: github.com/ToroSachi/tagops

Would love input from anyone running GTM at scale — especially on the promotion + multi-container side. That's the part that needs the most field testing.

@SimoAhava @julian_juuti @krista_seiden — curious if this matches what you'd want to see.
```

_Tag with real handles._ Don't tag influencers for visibility — tag them for critique. Ask a specific question. They respond to that.

---

## DM template — pixel-vendor product managers

_Send cold to PMs at Klaviyo, Impact.com, Taboola, Retention.com, AspireIQ._

```
Hi {name} — I run TagOps, an open-source CLI for Google Tag Manager that ships complete vendor integration templates (tags + triggers + consent + data layer). We have {product} in our built-in library and the Meta Pixel / GA4 / TikTok / LinkedIn templates have gotten the most traction.

Two things:

1. Would you be open to reviewing {product}'s template? Five-minute fact-check that it matches your latest-recommended config.

2. If you're willing, I'd love to credit {product} as "reviewed by {company} engineering" on the template page. It's a fair trade — you get the integration marketed to the analytics-engineer audience; we get a template your customers can trust.

Repo: github.com/ToroSachi/tagops/blob/main/src/templates/vendors/{product}.ts

No rush; happy to iterate.
— {your name}
```

---

## GitHub repo setup

**Description (short):** Infrastructure-as-code for Google Tag Manager. Install vendor pixels with one command, catch Consent Mode v2 misconfigs, treat your container like production.

**Topics (for SEO):** `google-tag-manager`, `gtm`, `consent-mode-v2`, `gdpr`, `infrastructure-as-code`, `model-context-protocol`, `mcp`, `mcp-server`, `analytics`, `tag-management`, `cli`, `devops`

**Pinned issues (from day 1):**

- "Add a vendor template" — link to the contribution guide
- "Real-world container audit reports" — ask users to paste their `consent-audit --score-only --json` output (consented, anonymous) so we can publish aggregate stats

**README must have (in order):**

1. The 90% drop story (1 paragraph, link to case)
2. The 15-second GIF
3. `npm install -g tagops` + `tagops init --import` + `tagops consent-audit --report` as a 3-line onboarding block
4. A comparison table (TagOps vs owntag/gtm-cli vs tag-check vs Stape MCP vs paolobtl MCP)
5. Everything else

---

## Post-launch cadence (weeks 1-4)

| Day    | Action                                                                     |
| ------ | -------------------------------------------------------------------------- |
| Mon    | Measure Slack post                                                         |
| Tue    | r/GoogleTagManager + r/analytics post                                      |
| Wed    | LinkedIn personal post                                                     |
| Thu    | MeasureCamp newsletter submission + awesome-mcp PR                         |
| Fri    | First vendor-template PR merged + thank-you tweet                          |
| Week 2 | First demo video (Claude installs Meta CAPI via MCP in 30 seconds)         |
| Week 3 | Publish aggregate "X% of submitted containers are CMv2-non-compliant" post |
| Week 4 | Offer free audit to 10 mid-sized agencies by email                         |

---

## The honest tripwire

If after 4 weeks of this cadence you have fewer than 100 GitHub stars, 10 non-you installs, and 3 inbound questions from people who actually work with GTM — the positioning is wrong, not the execution. Stop and pivot (SaaS? GitHub Action? pure Chrome extension?) before building more features.
