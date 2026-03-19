/**
 * CI/CD Scaffolding Tool
 *
 * Scaffolds GitHub Actions workflows for continuous integration
 * and continuous deployment of the GTM container.
 *
 * Generates three workflows:
 *   1. PR Checks — lint + consent audit on every pull request
 *   2. Deploy — restore & publish on merge to main
 *   3. Drift Detection — nightly snapshot comparison
 *
 * Usage:
 *   npx tsx src/cli.ts init-ci
 */

import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface InitCiReport {
  filesCreated: string[];
  filesSkipped: string[];
}

const PR_WORKFLOW = `name: GTM PR Checks

on:
  pull_request:
    paths:
      - 'gtm-snapshot.json'
      - '.gtmrc.json'
      - 'gtm-lint.json'

jobs:
  gtm-checks:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install tagops
        run: npm install -g tagops

      - name: Run GTM Linter
        env:
          GOOGLE_APPLICATION_CREDENTIALS: \${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }} // eslint-disable-line no-useless-escape
          GTM_CREDENTIALS: \${{ secrets.GTM_CREDENTIALS }} // eslint-disable-line no-useless-escape
        run: tagops lint --snapshot gtm-snapshot.json

      - name: Consent Mode v2 Audit
        env:
          GOOGLE_APPLICATION_CREDENTIALS: \${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }} // eslint-disable-line no-useless-escape
          GTM_CREDENTIALS: \${{ secrets.GTM_CREDENTIALS }} // eslint-disable-line no-useless-escape
        run: tagops consent-audit --score-only
        
      - name: Generate Changelog
        run: |
          tagops changelog --from gtm-snapshot.json --to gtm-snapshot.json --output CHANGELOG.md
          cat CHANGELOG.md > $GITHUB_STEP_SUMMARY
`;

const DEPLOY_WORKFLOW = `name: GTM Deploy to Production

on:
  push:
    branches:
      - main
    paths:
      - 'gtm-snapshot.json'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install tagops
        run: npm install -g tagops

      - name: Restore Snapshot to Workspace
        env:
          GOOGLE_APPLICATION_CREDENTIALS: \${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }} // eslint-disable-line no-useless-escape
          GTM_CREDENTIALS: \${{ secrets.GTM_CREDENTIALS }} // eslint-disable-line no-useless-escape
        run: tagops restore gtm-snapshot.json --dry-run # Remove --dry-run when ready

      - name: Publish Workspace
        env:
          GOOGLE_APPLICATION_CREDENTIALS: \${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }} // eslint-disable-line no-useless-escape
          GTM_CREDENTIALS: \${{ secrets.GTM_CREDENTIALS }} // eslint-disable-line no-useless-escape
        run: |
          COMMIT_MSG=$(git log -1 --pretty=%B)
          tagops publish --name "Deploy: \${GITHUB_SHA::7}" --description "$COMMIT_MSG" // eslint-disable-line no-useless-escape
`;

const DRIFT_WORKFLOW = `name: GTM Drift Detection

on:
  schedule:
    - cron: '0 6 * * *'  # Every day at 6am UTC
  workflow_dispatch:        # Allow manual trigger

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install tagops
        run: npm install -g tagops

      - name: Check for Drift
        env:
          GOOGLE_APPLICATION_CREDENTIALS: \${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }} // eslint-disable-line no-useless-escape
          GTM_CREDENTIALS: \${{ secrets.GTM_CREDENTIALS }} // eslint-disable-line no-useless-escape
        run: |
          tagops diff --snapshot gtm-snapshot.json --json > drift-report.json
          CHANGES=$(cat drift-report.json | grep -c '"action":')
          if [ "$CHANGES" -gt 0 ]; then
            echo "::warning::GTM drift detected! $CHANGES change(s) found since last snapshot."
            cat drift-report.json > $GITHUB_STEP_SUMMARY
          else
            echo "No drift detected."
          fi

      - name: Consent Mode v2 Check
        env:
          GOOGLE_APPLICATION_CREDENTIALS: \${{ secrets.GOOGLE_APPLICATION_CREDENTIALS }} // eslint-disable-line no-useless-escape
          GTM_CREDENTIALS: \${{ secrets.GTM_CREDENTIALS }} // eslint-disable-line no-useless-escape
        run: |
          SCORE=$(tagops consent-audit --score-only 2>/dev/null || echo "0")
          echo "Consent Mode v2 Compliance Score: $SCORE%"
          if [ "$SCORE" -lt 100 ]; then
            echo "::warning::Consent Mode v2 compliance is at $SCORE%. Run tagops consent-audit for details."
          fi
`;

export function initCi(): InitCiReport {
  const report: InitCiReport = {
    filesCreated: [],
    filesSkipped: [],
  };

  const githubDir = resolve(".github/workflows");
  if (!existsSync(githubDir)) {
    mkdirSync(githubDir, { recursive: true });
  }

  const files = [
    { name: "gtm-pr-checks.yml", content: PR_WORKFLOW },
    { name: "gtm-deploy.yml", content: DEPLOY_WORKFLOW },
    { name: "gtm-drift-detection.yml", content: DRIFT_WORKFLOW },
  ];

  for (const file of files) {
    const filePath = resolve(githubDir, file.name);
    if (existsSync(filePath)) {
      report.filesSkipped.push(`.github/workflows/\${file.name}`); // eslint-disable-line no-useless-escape
    } else {
      writeFileSync(filePath, file.content);
      report.filesCreated.push(`.github/workflows/\${file.name}`); // eslint-disable-line no-useless-escape
    }
  }

  return report;
}

export function printInitCiReport(report: InitCiReport): void {
  console.log(chalk.bold("\n  GTM CI/CD Initialization\n"));

  if (report.filesCreated.length > 0) {
    console.log(chalk.green("  ✔ Created GitHub Actions workflows:"));
    for (const file of report.filesCreated) {
      console.log(`    + \${file}`); // eslint-disable-line no-useless-escape
    }
    console.log();
  }

  if (report.filesSkipped.length > 0) {
    console.log(chalk.yellow("  ⚠ Skipped existing files:"));
    for (const file of report.filesSkipped) {
      console.log(`    - \${file}`); // eslint-disable-line no-useless-escape
    }
    console.log();
  }

  console.log(chalk.bold("  Next Steps:"));
  console.log("  1. Add your Service Account JSON as a GitHub Secret:");
  console.log(chalk.cyan("       GTM_CREDENTIALS  (paste the full JSON content)"));
  console.log("     Or set the path to the key file:");
  console.log(chalk.cyan("       GOOGLE_APPLICATION_CREDENTIALS"));
  console.log("  2. Run `tagops snapshot` to create your baseline.");
  console.log("  3. Commit the snapshot and workflows, then push to GitHub.\n");
}
