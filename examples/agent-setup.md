# TagOps MCP — the governance layer for AI-agent tag management

There are already GTM MCP servers. [Stape](https://stape.io/blog/mcp-server-for-google-tag-manager) ships one. paolobtl ships one. Google ships a GA4 MCP. They are all **thin CRUD wrappers** — an agent can create/update/delete tags via the API.

TagOps's MCP server is different. It exposes the same CRUD surface plus the **governance layer**:

- Vendor templates with consent + triggers + data-layer wired in (Meta, GA4, TikTok, LinkedIn, +20 more)
- Consent Mode v2 audit that names which tags are missing which signals
- Pre-fix snapshot before any mutation
- Policy packs (`gdpr-strict`, `ccpa-baseline`, `agency-standard`) that block non-compliant writes
- Drift detection against template definitions

An agent calling TagOps can't accidentally publish a non-compliant tag. An agent calling a CRUD wrapper can, and will.

---

## What an agent can actually do

### 1. Install Meta CAPI on a Shopify store — one prompt

> User: _"Install Meta Pixel + server-side CAPI on my Shopify store. Make sure dedup works and consent signals are correct."_

Agent's tool calls (in order):

1. `gtm_snapshot` — saves `gtm-snapshot.json` as a restore point
2. `gtm_list_tags` — sanity-checks the current container
3. `gtm_install_template` with `meta-pixel` — creates PageView/ViewContent/AddToCart/InitiateCheckout/Purchase tags + triggers + data-layer variables + event-ID dedup, all with `ad_storage` consent signal
4. `gtm_consent_audit` — verifies the new tags pass
5. `gtm_policy_check` with `gdpr-strict` — confirms no policy violations
6. `gtm_publish` (dry-run first) — version the workspace

Total time: ~30 seconds. Auditable: every mutation was preceded by a snapshot. Reversible: `tagops restore gtm-snapshot.json`.

### 2. Audit an inherited container across an MCC

> User: _"Audit every GTM container under agency MCC 123 for CMv2 compliance. Flag anything below 90%. Don't change anything."_

Agent's tool calls:

1. For each configured profile: `gtm_consent_audit` (read-only)
2. `gtm_report --format html` — professional per-container reports suitable for client delivery
3. Summary table with compliance scores

Competing CRUD-only MCPs can't do step 2 at all.

### 3. Roll back a bad deploy

> User: _"The Meta Pixel stopped firing after last night's change. Roll back to yesterday's snapshot."_

Agent's tool calls:

1. `gtm_diff` — what changed
2. `gtm_plan` with yesterday's snapshot — classify restore risk (low/medium/high/critical)
3. If low/medium: `gtm_restore`
4. If high/critical: agent stops and asks for human confirmation — policy-enforced

---

## Setup

### 1. Install

```bash
npm install -g tagops
```

### 2. Auth with a service account

Create a GCP service account with GTM "Edit" permission on your container. Download the JSON key.

### 3. Configure your MCP client

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tagops": {
      "command": "tagops-mcp",
      "args": ["--read-only"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/sa.json"
      }
    }
  }
}
```

The `tagops-mcp` bin is installed alongside `tagops` when you run `npm install -g tagops`.

**Start read-only.** Once you trust the workflow, remove `--read-only` to grant write access.

### 4. Per-project config

Create `.gtmrc.json` at the repo root:

```json
{
  "accountId": "123456789",
  "containerId": "987654321",
  "workspaceId": "1"
}
```

Or use `tagops init --import --account-id ... --container-id ... --workspace-id ...` to auto-generate it plus an initial snapshot and consent audit.

---

## Tool reference (20+ tools)

| Category      | Tools                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Read**      | `gtm_list_tags`, `gtm_list_triggers`, `gtm_list_variables`, `gtm_doctor`, `gtm_health_score`                                           |
| **Audit**     | `gtm_consent_audit`, `gtm_policy_check`, `gtm_lint`, `gtm_audit`, `gtm_validate_capi`, `gtm_enhanced_conversions`, `gtm_sst_readiness` |
| **Install**   | `gtm_list_templates`, `gtm_install_template`, `gtm_preview_template`, `gtm_validate_template`                                          |
| **IaC**       | `gtm_snapshot`, `gtm_diff`, `gtm_plan`, `gtm_restore`, `gtm_publish`, `gtm_rollback`                                                   |
| **Multi-env** | `gtm_compare_containers`, `gtm_sync_containers`, `gtm_promote`                                                                         |

Every write tool creates a pre-fix backup automatically. Every policy-gated write is blocked if `--read-only` is set or if the policy check fails.

---

## Safety model

- **Read-only by default.** Flip the flag when you're ready.
- **Pre-fix snapshots on every mutation** — restorable via `tagops restore`.
- **Policy gates block non-compliant writes.** An agent running under `gdpr-strict` cannot publish a tag missing `ad_user_data`.
- **Production promotion enforces dev → staging → production.** Skipping stages is rejected.
- **No network access beyond the GTM API.** TagOps makes no outbound calls except to `googleapis.com`.

---

## Why this matters

Giving an AI agent production write access to a Google Tag Manager container is how you break tracking for a million-dollar campaign at 2am. Every other GTM MCP is one prompt away from that outcome. TagOps routes every mutation through a safety layer that says "no" before the agent does something it shouldn't.

That's the product. CRUD is table stakes.
