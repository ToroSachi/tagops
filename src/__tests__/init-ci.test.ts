/**
 * Tests for the CI/CD Tool.
 */

import { describe, it, expect } from "vitest";
import { initCi } from "../tools/init-ci.js";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("CI/CD Scaffolding Tool", () => {
  const prFile = resolve(".github/workflows/gtm-pr-checks.yml");
  const deployFile = resolve(".github/workflows/gtm-deploy.yml");
  const driftFile = resolve(".github/workflows/gtm-drift-detection.yml");

  it("creates GitHub Action workflow files", () => {
    // Clean up any pre-existing
    if (existsSync(prFile)) unlinkSync(prFile);
    if (existsSync(deployFile)) unlinkSync(deployFile);
    if (existsSync(driftFile)) unlinkSync(driftFile);

    const report = initCi();

    expect(report.filesCreated).toHaveLength(3);
    expect(report.filesSkipped).toHaveLength(0);

    expect(existsSync(prFile)).toBe(true);
    expect(existsSync(deployFile)).toBe(true);
    expect(existsSync(driftFile)).toBe(true);

    const prContent = readFileSync(prFile, "utf-8");
    expect(prContent).toContain("name: GTM PR Checks");
    expect(prContent).toContain("tagops lint");
    expect(prContent).toContain("consent-audit --score-only");
    expect(prContent).toContain("GOOGLE_APPLICATION_CREDENTIALS");

    const deployContent = readFileSync(deployFile, "utf-8");
    expect(deployContent).toContain("name: GTM Deploy to Production");
    expect(deployContent).toContain("tagops restore");
    expect(deployContent).toContain("GTM_CREDENTIALS");

    const driftContent = readFileSync(driftFile, "utf-8");
    expect(driftContent).toContain("name: GTM Drift Detection");
    expect(driftContent).toContain("cron");
  });

  it("skips existing files", () => {
    const report = initCi();

    expect(report.filesCreated).toHaveLength(0);
    expect(report.filesSkipped).toHaveLength(3);

    // Cleanup
    if (existsSync(prFile)) unlinkSync(prFile);
    if (existsSync(deployFile)) unlinkSync(deployFile);
    if (existsSync(driftFile)) unlinkSync(driftFile);
  });
});
