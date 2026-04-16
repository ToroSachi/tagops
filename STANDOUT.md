# Stand-out plan — evidence-based

Research-backed plan for TagOps v0.1 launch. Updated 2026-04-16. Built from four parallel research dives (GTM community, Consent Mode reality, niche devtool launch patterns, MCP analytics landscape).

---

## The evidence base (summarized)

### 1. Consent Mode v2 is actually breaking revenue, right now

- **July 21, 2025** — Google enforced Consent Mode v2 signal requirements for EEA/UK traffic. No grace period.
- **Documented 90% conversion drop** — Harvest Digital founder Mike Teasdale published a LinkedIn case of a client account losing 90% of measured conversions overnight because their CMP banner wasn't transmitting signals correctly ([ppc.land](https://ppc.land/consent-mode-v2-enforcement-is-silently-breaking-google-ads-conversions/)).
- **Only ~40% recoverable** — behavioral modeling recovers some, but the rest is permanent.
- **Matomo** reported 90–95% drops in EEA metrics across sites that hadn't implemented CMv2.
- **Caveat** — regulatory fines at the tag level (vs banner UX) are thin. The real pain is measurement degradation, not GDPR penalties. Don't frame it as a fine-risk story.

**Defensible pitch line:** _"Containers missing CMv2 signals forfeit remarketing eligibility and fall back to modeled conversions in EEA traffic. Documented cases show 90% observed-conversion drops, only ~40% recoverable."_

### 2. Inherited-container archaeology is agency gold

- Analytics agencies charge $120–200/hr and estimate 10–20 hours to audit an inherited container before touching it (Seresa, TagStack).
- 73% of GA4 implementations contain undetected misconfigurations (Seresa).
- Agencies build "governance documents" by hand. Selling one to a client: $500–$1,000.

### 3. Meta CAPI setup is the #1 broken integration

- Meta's own GTM template requires a GA4 property + web container + server container + Cloud Run tagging server. Advertisers misconfigure `event_id`, causing double-counting or conversion discards.
- Most common CAPI failure in 2025-2026 field reports (wetracked.io).

### 4. Server-side GTM is a debugging black box

- Simo Ahava's 2025-2026 archives are dominated by SST pain posts. 15–20 hours of setup, no DevTools equivalent.
- This is where paid hosting (Stape) won — but the debugging gap is open.

### 5. MCP analytics space: we are NOT first, we ARE deepest

- **Exists already:** Stape GTM MCP, paolobtl GTM MCP, Google's own GA4 MCP, Ryze AI (Ads+GA4+Meta), mcp-server-ga4 (harshfolio). 10k+ MCP servers across all categories by early 2026.
- **Gap:** Every existing GTM MCP is a thin CRUD wrapper. None ship vendor templates, Consent Mode v2 auditing, IaC snapshot/restore, policy packs, or drift detection. **We are the only governance-layer MCP in tag management.**
- **Implication:** Don't claim "first MCP for GTM." Claim "opinionated MCP for tag-management governance."

### 6. Launch-channel reality

- **Skip Show HN.** GTM is off-topic; will be buried.
- **Go where analytics engineers actually live:** [measure.chat](https://www.measure.chat/) Slack (~20k members), MeasureCamp newsletters, Simo Ahava's blog comments, LinkedIn with GTM-influencer tags.
- **Winning content format:** 15-second terminal GIF (lazygit/fzf pattern). Then a confessional rant post — not a product pitch.

---

## The five stand-out moves (do these in order)

### Move 1 — Lead with the 90% drop story, not the feature list

**What:** Rewrite the README's first fold, the npm description, and the launch blog post around one real case.

**Specific hook:**

> _"Last July, a Google Ads account lost 90% of measured conversions overnight. The CMP banner looked fine. The tags fired. The technical signals were missing. Google gave no warning. TagOps detects this in 30 seconds."_

**Why it stands out:** Every competitor leads with "we wrap the GTM API" or "we audit your container." No one leads with a real revenue-loss incident. This is the [Carson Gross / Caddy playbook](https://htmx.org/essays/) — confessional framing, not product framing.

**Cost:** 2 hours of writing. Zero code.

### Move 2 — Auto-import existing containers: the "50-tag wow" moment

**What:** Ship `tagops init --import` that, given credentials + IDs, pulls the full container and generates:

- `.gtmrc.json`
- Initial snapshot JSON
- Markdown summary of what's in there (tags, triggers, consent coverage)
- A first `consent-audit --report`
- All in one command, under 60 seconds

**Why it stands out:** This is the `fly launch` pattern. The screenshotable moment. "It imported my 400-tag container AND told me 27% of them are missing consent signals." That's the GIF.

**Cost:** Medium — 1-2 days. The pieces exist (`snapshot`, `consent-audit --report`); just need to wire them together and write the narrative output.

### Move 3 — The GitHub PR bot (score-as-a-check)

**What:** A reference `.github/workflows/tagops-gate.yml` that runs on every PR to a repo containing a `gtm-snapshot.json` or `.tagops-policies.json`. Comments on the PR like Codecov:

```
TagOps compliance check
Consent Mode v2:   76% → 94% (+18%) ✅
Policy pack:       gdpr-strict (2 new violations) ⚠
Template drift:    meta-pixel v1.0.0 matched ✅
```

**Why it stands out:** GitHub PR comments screenshot well. Every time an agency sees this in a repo, they want it. Template lives in `.github/workflows/` (easy copy-paste), no separate SaaS needed.

**Cost:** Low — we already have `--score-only` flags. A workflow file + one README section. Ship as part of `tagops init --ci`.

### Move 4 — Reframe MCP positioning: "governance, not CRUD"

**What:** Update README and MCP docs to position against Stape/paolobtl/Ryze explicitly:

| Tool                            | What it does                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Stape GTM MCP, paolobtl GTM MCP | Create/update/delete tags via API                                                                                                  |
| Google GA4 MCP                  | Read GA4 reporting data                                                                                                            |
| Ryze AI                         | Multi-platform ad read+write                                                                                                       |
| **TagOps MCP**                  | **Install vendor templates + consent audit + IaC snapshot + policy-check. Agent won't publish without a passing compliance gate.** |

**Why it stands out:** Moat is not "first MCP for GTM." Moat is "the MCP with guardrails." A production-grade agent workflow requires this layer. Stape et al. don't.

**Cost:** Zero code. Just positioning + doc update + a demo video of "Claude installs Meta CAPI with auto-dedup via TagOps MCP."

### Move 5 — Aggressive PR merge + vendor outreach

**What:**

- First 90 days: merge every reasonable vendor-template PR within 48 hours.
- Proactively DM product managers at Klaviyo, Impact.com, Taboola, Retention.com, AspireIQ — offer to feature their template and credit them. Ask for a quote. "Supported by Klaviyo's engineering team" is a flywheel.
- Publicly thank each contributor on Twitter/LinkedIn.

**Why it stands out:** tldr-pages and Caddy both hit 40k+ stars on this. Analytics engineers rarely contribute to OSS. Being the person who welcomed them converts them to lifetime users. Vendors will share because it makes their product look integration-friendly.

**Cost:** Time only. ~2 hours a week during launch window.

---

## Runner-up moves (do if budget allows)

### `tagops inherit` — agency-branded audit command

Alias `tagops inherit` → `init --import` + `audit --report` + `consent-audit --report` → single 1-page Markdown handoff doc. Brand it explicitly as "the inherited-container audit." Agencies sell this output to clients.

### Hosted playground at tagops.dev/try

Upload a container export, see the IaC diff + consent audit rendered in-browser. No install. Wrangler / Turborepo pattern. Higher effort but if we land Vercel free tier + client-side-only execution, it's a mindshare multiplier.

### Public demo container

A real GTM container (small e-commerce site, ideally a side project) where anyone can point TagOps and see it work against live data. Transparency; and doubles as a continuous integration test in production.

### Savings-estimate calculation

`tagops consent-audit --savings-estimate --eea-traffic-share 0.30` → estimates the revenue impact of non-compliant tags based on configurable EEA traffic share and AOV. This turns the compliance report into a CFO-targeted sales doc.

---

## What NOT to do

| Tempting                        | Why skip                                                                   |
| ------------------------------- | -------------------------------------------------------------------------- |
| Show HN launch                  | GTM off-topic; will be buried. See evidence.                               |
| "We invented the MCP for GTM"   | False — Stape + paolobtl beat you to it. Claim governance-layer instead.   |
| Enterprise dashboard SaaS first | Adopters need the CLI + CI to trust the SaaS. Build CLI community first.   |
| Chasing GTM 360 feature parity  | Google has the advantage there. Win on Git-native workflows.               |
| A Chrome extension              | ConsentFlow-Debugger already exists and is good. Integrate; don't compete. |
| Renaming TagOps                 | Name is fine. Don't burn the months of work on a rebrand.                  |

---

## Sequenced 90-day plan

### Week 1 — Hygiene (you are here, mostly)

- [x] Remove OAuth secret from source
- [x] Trim CLI to 20 core commands
- [x] Rewrite README honestly
- [ ] Rotate the GCP OAuth client _(only you can do this in the console)_
- [ ] Create public `github.com/ToroSachi/tagops`
- [ ] Publish `tagops@0.1.0` to npm

### Week 2–3 — Build the demo

- [ ] Ship `tagops init --import` (Move 2)
- [ ] Record the 15-second GIF
- [ ] Write the "90% drop" blog post (Move 1)
- [ ] Ship `.github/workflows/tagops-gate.yml` example (Move 3)

### Week 4 — Launch window

- [ ] Measure Slack `#gtm` channel post — link to GIF + blog
- [ ] LinkedIn post tagging @SimoAhava, @julian_juuti, @krista_seiden
- [ ] Submit to MeasureCamp newsletter
- [ ] Post to r/GoogleTagManager, r/analytics
- [ ] Email 10 mid-sized analytics agencies offering a free audit

### Week 5–12 — Community flywheel

- [ ] Merge every vendor-template PR within 48h
- [ ] DM 5 pixel-vendor product managers per week
- [ ] Weekly demo clip on Twitter/LinkedIn
- [ ] Ship one new template every Friday
- [ ] Publish a monthly compliance-stats post (aggregate anonymous audit results if consented)

### 90-day success metric

**10 non-you installs** from distinct GitHub handles. If fewer than that, the premise needs a pivot — not more code.

---

## The one-sentence pitch

> **TagOps is infrastructure-as-code for Google Tag Manager: install vendor pixels with one command, catch the Consent Mode v2 misconfigurations that cost accounts 90% of their EEA conversions, and treat your container like a production system — snapshots, diffs, policy gates in CI, all open source.**

Use this on the repo's GitHub description, the npm description, the MCP registry entry, every LinkedIn post, and the first line of every conference intro.
