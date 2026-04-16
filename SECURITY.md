# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Open a private [GitHub Security Advisory](https://github.com/ToroSachi/tagops/security/advisories/new) with:

- A description of the vulnerability
- Steps to reproduce
- Impact / scope

Triage target: within 7 days for valid reports.

## Scope

In scope:

- Credential handling in `src/lib/auth.ts` and `src/lib/redaction.ts`
- GTM API request construction in `src/lib/gtm-cli.ts`
- Template-rendered HTML in `src/templates/`
- MCP server endpoints in `src/server.ts`
- Policy / audit logic in `src/tools/consent-audit.ts` and `src/lib/policies.ts`

Out of scope:

- Google Tag Manager API itself
- Third-party vendor pixel JavaScript
- Issues that require a user to already have write access to the target container

## Credential handling

TagOps does **not** bundle OAuth client credentials in the source tree. Browser login requires either a service account (`GOOGLE_APPLICATION_CREDENTIALS`) or a user-provided OAuth Desktop client via `TAGOPS_CLIENT_ID` / `TAGOPS_CLIENT_SECRET`. Errors are scrubbed via `src/lib/redaction.ts` before being surfaced, so tokens, keys, and secrets do not leak into logs.
