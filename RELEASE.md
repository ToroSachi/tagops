# Release runbook — v0.1.0

Staged rollout. Copy commands; don't improvise. Each phase has a tripwire that either promotes to the next phase or rolls back.

Do NOT skip phases. Phase 0 is the only irreversible one; everything after is reversible within minutes.

---

## Go / no-go check

You should proceed with release if:

- [x] `npm run typecheck` passes
- [x] `npm run test` reports all tests green
- [x] `npm run build` produces `dist/cli.js` and `dist/server.js`
- [x] `npm pack --dry-run` shows the expected tarball (≈300KB, no source files, no `.gtmrc.json`, no `backups/`)
- [x] `node dist/cli.js --version` prints `0.1.0`
- [x] `node dist/cli.js init --import ...` works live against a real container
- [ ] **You have rotated the old OAuth client in your GCP console** — the old secret was in past git commits. Rotation takes ~30 seconds and invalidates the leaked value.
- [ ] You are willing to commit to 30 days of "merge every PR within 48h" for early contributor momentum

If either unchecked box is still unchecked, stop. Come back when they're done.

---

## Phase 0 — irreversible setup (~10 minutes)

### 0.1 Squash git history to a clean v0.1 commit

**Why:** Past commits contain the old OAuth secret and your real account/container IDs in `test-cycle.json`. Even though the secret will be rotated, clean history is better than explaining to random people on HN why your first commit has a Google secret in it.

```bash
# From the repo root, with all current changes committed or stashed
cd /Users/bobbarclay/GTMCLIAUTOMATION

git checkout --orphan v0.1-clean
git add -A
git status   # REVIEW this list carefully
```

Expected files at this point should include:

- source tree (`src/`, `dist/` will be rebuilt), docs (`README.md`, `CHANGELOG.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`)
- `STANDOUT.md`, `DISTRIBUTION.md`, `CUTS.md`, `RELEASE.md` (delete `CUTS.md` before committing if you want — it's historical now)
- `.github/`, `.changeset/`, `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest.config.ts`, `.eslintrc.cjs`, `.gitignore`, `.husky/`
- `scripts/`, `examples/`, `gtmrc.schema.json`
- **NOT** `.gtmrc.json`, **NOT** `backups/`, **NOT** `consent-report-*.md`, **NOT** `gtm-snapshot.json`, **NOT** `.tagops-credentials.json`

```bash
git commit -m "feat: initial v0.1.0 release"
git branch -D master   # delete old history
git branch -m master
```

### 0.2 Rotate the GCP OAuth client

In the [GCP Console](https://console.cloud.google.com/apis/credentials) for the project TagOps used:

1. Find the Desktop OAuth client that was referenced in earlier commits.
2. Click "Reset secret." Confirm.
3. Either write down the new values (if you want to use them yourself) or delete the client entirely if you have no browser-login users.

The old secret is now invalidated. Any code that still has it hardcoded (old forks, cached tarballs) will fail with `invalid_client`. That's the goal.

### 0.3 Create the public repo

On GitHub, create `ToroSachi/tagops` as a **public** repository. No template. No initial commit — you're pushing one in the next step.

Then:

```bash
git remote -v             # confirm origin points at ToroSachi/tagops
git push -u origin master
```

---

## Phase 1 — silent alpha (day 1–2)

**Goal:** Make sure the world can install this without anyone having seen it yet.

### 1.1 Smoke test from a clean machine / container

```bash
docker run --rm -it -v "$HOME/service-account.json:/sa.json:ro" node:20 bash
# inside container:
npm install -g https://github.com/ToroSachi/tagops.git
export GOOGLE_APPLICATION_CREDENTIALS=/sa.json
tagops --version
tagops doctor
tagops init --import --account-id X --container-id Y --workspace-id Z
```

If any step fails, fix it and push a patch. Don't publish to npm until the container run is clean.

### 1.2 Publish to npm

```bash
# One-time: log in to npm
npm login

# Sanity check what will ship
npm pack --dry-run

# Publish
npm publish --access public
```

NPM will reject the name if it's been registered by someone else since you last checked — verify with `npm view tagops` first.

### 1.3 Verify the published package works

```bash
cd /tmp
npm install -g tagops
tagops --version            # should print 0.1.0
tagops --help
which tagops tagops-mcp     # both should resolve
```

### 1.4 Tag the release

```bash
cd /Users/bobbarclay/GTMCLIAUTOMATION
git tag v0.1.0
git push origin v0.1.0
```

Create a GitHub release from the tag. Paste the `CHANGELOG.md` 0.1.0 entry as the body.

### 1.5 Pin two issues

- **"Add a vendor template"** — link to `CONTRIBUTING.md#adding-a-vendor-template`
- **"Real-world audit reports wanted"** — ask users to paste anonymized `consent-audit --score-only --json` output so you can publish aggregate stats later

**Phase 1 tripwire:** 48 hours pass with no inbound issues / stars / installs from non-you sources. That's fine — phase 1 is silent on purpose. Move to phase 2 when both `npm pack` smoke tests and the docker install both pass.

---

## Phase 2 — friend-of-friend release (day 3–7)

**Goal:** Get 3–5 real GTM people to run TagOps on a real container. Collect every sharp edge and fix it before broad launch.

### 2.1 Pick your five people

Look at your LinkedIn / email / Slack for 5 people who match at least two of:

- Manage GTM professionally (analytics engineer, agency lead, marketing ops)
- You've talked to in the last 18 months
- Will give you honest critique, not polite noise
- Run a container you know has real consent / drift issues (i.e. will actually _see_ output, not a demo container)

DM them something like:

> Shipped an open-source CLI for GTM I've been quietly building. Would love 10 minutes of honest critique before I post it publicly. The run that produces results takes one command; what I really want is your reaction to the output. github.com/ToroSachi/tagops

### 2.2 What to watch for in their feedback

- **"I installed it and it errored at step X"** → fix immediately, point them at a patch release
- **"It worked but I don't understand what this number means"** → rewrite the output / README copy
- **"I ran `consent-audit --fix` and it broke production"** → drop everything, investigate, possibly re-release with `--fix` requiring `--confirm`
- **"Yeah this is fine I guess"** → the positioning doesn't land; think about the hook
- **"Oh I need to send this to my PM"** → you have product-market fit signal

### 2.3 Patch-release any critical issues

```bash
# For each fix:
git checkout -b fix/short-description
# ... fix ...
git commit -m "fix: ..."
# Bump version
npm version patch   # 0.1.0 → 0.1.1
git push && git push --tags
npm publish
```

**Phase 2 tripwire:** After one week with 5 people, if NOT ONE of them had an "oh interesting" moment, the positioning is wrong. Stop here. Re-read [STANDOUT.md](STANDOUT.md). Do not proceed to broad launch on a product no one reacts to.

---

## Phase 3 — soft launch (day 7–14)

**Goal:** First 50–100 GitHub stars from real users. Iterate.

Use [docs/launch-channels.md](docs/launch-channels.md) for the specific copy.

### Day 7 (Monday)

Post in Measure Slack `#gtm`. This is the friendliest audience. Use the copy in `docs/launch-channels.md`. Respond to every reply within 4 hours.

### Day 8 (Tuesday)

Post to r/GoogleTagManager. Include the GIF from `docs/demo-script.md`.

### Day 9 (Wednesday)

Personal LinkedIn post. Tag 3 GTM influencers by name, ask for specific critique (not for promotion).

### Day 10 (Thursday)

Submit to MeasureCamp newsletter. Submit to awesome-mcp-servers PR. Submit to mcp.so and smithery.ai directories.

### Day 11–14 (Friday–Monday)

- First vendor-template PR should arrive. **Merge within 48 hours.** Publicly thank the contributor.
- Watch for patterns in issues. Fix the top-2 most-reported.
- Publish the first "aggregate stats" post if you have ≥3 users who consented to sharing anonymized results.

**Phase 3 tripwire:** After 7 days of soft launch with the channel posts and DMs, if you have fewer than:

- 25 GitHub stars
- 3 installs from non-you sources (npm download stats)
- 1 external PR or issue

…stop. The thesis needs a pivot (SaaS? GitHub Action only? pure Chrome extension?) before you build more features.

---

## Phase 4 — broad launch (week 3+)

**Only attempt phase 4 if phase 3 hit its tripwire numbers.**

- Send the "free audit" cold emails to 10 mid-size analytics agencies (see `docs/launch-channels.md`).
- Start outreach to pixel vendors (Klaviyo, Impact, Taboola product managers) — see the DM template.
- Record a second demo: "Claude installs Meta CAPI via TagOps MCP in 30 seconds." Post to Twitter + LinkedIn.
- Submit to a Show HN with positioning as _"IaC for marketing tag management"_ — not _"GTM CLI"_ — to target the DevOps audience who would actually upvote it.
- Write the monthly aggregate compliance-stats post (e.g. "We audited 25 containers this month. Average consent score: 68%. Most common gap: missing `ad_user_data`.").

---

## Rollback plan

**If npm publish goes wrong and a bad version ships:**

```bash
npm unpublish tagops@0.1.0 --force
# Must be within 72 hours of publish, else deprecate:
npm deprecate tagops@0.1.0 "Pulled — critical bug; upgrade to 0.1.1"
npm publish   # republish with the patch
```

**If a user reports `consent-audit --fix` broke their container:**

1. Do not remove it. The snapshot-before-fix safety net is built in.
2. Reply on the issue within 2 hours. Point them at `tagops restore /path/to/pre-fix-backup.json`.
3. Add an explicit `--confirm` flag in the next patch release.

**If the repo gets negative attention (e.g. HN commenters find something embarrassing):**

1. Don't argue. Fix what's fair. Acknowledge what's wrong.
2. If the negative attention is security-related, patch-release same-day and pin a notice to the README.

**If the old OAuth secret is used to abuse the quota of the old GCP project:**

- The rotation in Phase 0 already invalidated it. If somehow it's still live: delete the client entirely in GCP console. No functional impact since the public release doesn't depend on it.

---

## First-48-hours monitoring

Check daily:

- npm weekly downloads: `curl -s https://api.npmjs.org/downloads/point/last-week/tagops`
- GitHub stars / forks / issues
- `npm install -g tagops` still works from a clean machine
- Measure Slack / Reddit / LinkedIn replies — respond within 4 hours during the first week

**The single most important metric the first 30 days:** non-you installs. Check at day 7, day 14, day 30. If it's not climbing into double digits, stop building features.

---

## What not to do in phase 1–2

- **Don't promote on Twitter/X yet.** The audience is wrong; you'll burn the first-impression opportunity on people who won't convert.
- **Don't submit to Product Hunt.** Wrong audience, and PH upvotes don't translate to installs for niche devtools.
- **Don't build new features.** Every new feature before product-market fit is a hidden bug surface. Fix what real users hit; defer the rest.
- **Don't respond defensively.** "That's a great point, I'll fix it" beats 500 words explaining why you're right.
- **Don't ship to a paid plan before 100 free installs.** See [DISTRIBUTION.md](DISTRIBUTION.md) for the monetization path; it's phase 4+ at the earliest.

---

## Final word

Everything on this page is reversible within a day except Phase 0.1 (the squash) and Phase 0.2 (the OAuth rotation). Those two steps exist precisely to make the rest reversible — clean history + rotated secret = no permanent exposure if something goes wrong later.

Follow the phases. Trip the tripwires honestly. If the numbers don't come, pivot — the thesis is falsifiable and that's a feature, not a bug.
