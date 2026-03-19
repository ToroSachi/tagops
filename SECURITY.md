# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 4.x     | ✅ Active |
| < 4.0   | ❌ EOL    |

## Reporting a Vulnerability

If you discover a security vulnerability in TagOps, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email **security@tagops.dev** (or open a [GitHub Security Advisory](https://github.com/gtm-auto/gtm-auto/security/advisories/new)).
3. Include:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

TagOps interacts with the Google Tag Manager API using your credentials. The following are in-scope:

- Credential handling and storage in `src/lib/auth.ts`
- API request construction in `src/lib/gtm-cli.ts`
- Custom HTML template injection in `src/templates/registry.ts`
- MCP server endpoints in `src/server.ts`

## Out of Scope

- Vulnerabilities in Google's Tag Manager API itself
- Issues with third-party vendor pixel code (Meta, TikTok, etc.)
