/**
 * Server-Side Tagging Readiness Score
 *
 * Assesses how ready a GTM container is for migration to server-side tagging.
 * Analyzes tag types, custom HTML complexity, data layer coverage, and consent.
 *
 * Usage:
 *   tagops sst-readiness
 */

import chalk from "chalk";
import type { GtmTag, GtmVariable } from "../types/gtm.js";

// Tags that have native sGTM client support
const SST_READY_TYPES = new Map([
  ["gaawc", "GA4 Configuration"],
  ["gaawe", "GA4 Event"],
  ["googtag", "Google Tag"],
  ["awct", "Google Ads Conversion"],
  ["sp", "Google Ads Remarketing"],
  ["flc", "Floodlight Counter"],
  ["fls", "Floodlight Sales"],
]);

// Tags that have community sGTM templates
const SST_COMMUNITY_TYPES = new Map([
  ["cvt_123456789_1", "Meta/Facebook (Community)"],
  ["img", "Custom Image — may need custom sGTM client"],
]);

// Tag type patterns that are difficult/impossible to migrate
const SST_BLOCKER_PATTERNS = new Set(["html", "awud"]);

export interface SSTTagAssessment {
  tagId: string;
  name: string;
  type: string;
  migrationStatus: "ready" | "community" | "custom_required" | "blocker";
  effort: "none" | "low" | "medium" | "high";
  notes: string;
}

export interface SSTReadinessReport {
  timestamp: string;
  totalTags: number;
  ready: number;
  community: number;
  customRequired: number;
  blockers: number;
  dataLayerCoverage: number; // Percentage of DLV variables vs total
  consentReady: boolean;
  score: number; // 0-100
  tags: SSTTagAssessment[];
  recommendations: string[];
  summary: string;
}

/**
 * Assess a single tag's server-side migration readiness.
 */
function assessTag(tag: GtmTag): SSTTagAssessment {
  // Check native support
  if (SST_READY_TYPES.has(tag.type)) {
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: "ready",
      effort: "none",
      notes: `${SST_READY_TYPES.get(tag.type)} — native sGTM support`,
    };
  }

  // Check community template support (by tag name heuristics)
  const lowerName = tag.name.toLowerCase();
  if (
    lowerName.includes("meta") ||
    lowerName.includes("facebook") ||
    lowerName.includes("fb pixel")
  ) {
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: "community",
      effort: "low",
      notes: "Meta/Facebook — use Meta Conversions API sGTM template",
    };
  }
  if (lowerName.includes("tiktok")) {
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: "community",
      effort: "low",
      notes: "TikTok — use TikTok Events API sGTM template",
    };
  }
  if (lowerName.includes("snapchat") || lowerName.includes("snap")) {
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: "community",
      effort: "medium",
      notes: "Snapchat — community sGTM template available",
    };
  }
  if (lowerName.includes("pinterest")) {
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: "community",
      effort: "medium",
      notes: "Pinterest — use Pinterest API for Conversions sGTM template",
    };
  }

  // Check blockers (custom HTML)
  if (SST_BLOCKER_PATTERNS.has(tag.type)) {
    // Check if the custom HTML is simple (just a script src) or complex
    const htmlParam = tag.parameter?.find((p) => p.key === "html");
    const htmlContent = htmlParam?.value ?? "";
    const isSimpleScript =
      /^<script[^>]*src=/.test(htmlContent.trim()) && htmlContent.split("\n").length < 5;

    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: isSimpleScript ? "custom_required" : "blocker",
      effort: isSimpleScript ? "medium" : "high",
      notes: isSimpleScript
        ? "Simple script tag — likely convertible to a server-side HTTP request"
        : "Complex custom HTML — requires manual rewrite as sGTM client/tag",
    };
  }

  // Everything else needs custom work
  return {
    tagId: tag.tagId,
    name: tag.name,
    type: tag.type,
    migrationStatus: "custom_required",
    effort: "medium",
    notes: `Tag type '${tag.type}' — check sGTM Community Template Gallery for support`,
  };
}

/**
 * Run server-side tagging readiness assessment.
 */
export function assessSSTReadiness(tags: GtmTag[], variables: GtmVariable[]): SSTReadinessReport {
  const activeTags = tags.filter((t) => !t.paused);
  const assessments = activeTags.map(assessTag);

  const ready = assessments.filter((a) => a.migrationStatus === "ready").length;
  const community = assessments.filter((a) => a.migrationStatus === "community").length;
  const customRequired = assessments.filter((a) => a.migrationStatus === "custom_required").length;
  const blockers = assessments.filter((a) => a.migrationStatus === "blocker").length;

  // Data layer coverage: what percentage of variables are Data Layer Variables?
  const dlvCount = variables.filter((v) => v.type === "v").length; // type "v" = Data Layer Variable
  const dataLayerCoverage =
    variables.length > 0 ? Math.round((dlvCount / variables.length) * 100) : 0;

  // Consent readiness: are most tags consent-aware?
  const consentConfigured = activeTags.filter(
    (t) => t.consentSettings && t.consentSettings.consentStatus === "needed",
  ).length;
  const consentReady = activeTags.length > 0 && consentConfigured / activeTags.length >= 0.8;

  // Score calculation
  const totalActive = Math.max(activeTags.length, 1);
  const tagScore = ((ready + community * 0.8 + customRequired * 0.3) / totalActive) * 60;
  const dlScore = Math.min(dataLayerCoverage, 100) * 0.2;
  const consentScore = consentReady ? 20 : 5;
  const score = Math.round(Math.min(100, tagScore + dlScore + consentScore));

  // Recommendations
  const recommendations: string[] = [];
  if (blockers > 0) {
    recommendations.push(
      `${blockers} custom HTML tag(s) need manual rewriting — these are migration blockers.`,
    );
  }
  if (dataLayerCoverage < 50) {
    recommendations.push(
      `Data layer coverage is ${dataLayerCoverage}% — sGTM works best with a well-structured data layer. Aim for 70%+.`,
    );
  }
  if (!consentReady) {
    recommendations.push(
      "Consent coverage is below 80% — configure consent on all tags before migrating to sGTM.",
    );
  }
  if (community > 0) {
    recommendations.push(
      `${community} tag(s) can use community sGTM templates — install from the Template Gallery.`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Container is well-positioned for server-side migration. Consider starting with GA4 + Google Ads tags.",
    );
  }

  const effort =
    blockers > 3 ? "complex" : blockers > 0 || customRequired > 3 ? "moderate" : "simple";
  const summary = `${ready} ready, ${community} community, ${customRequired} custom, ${blockers} blocker(s) — migration effort: ${effort}`;

  return {
    timestamp: new Date().toISOString(),
    totalTags: activeTags.length,
    ready,
    community,
    customRequired,
    blockers,
    dataLayerCoverage,
    consentReady,
    score,
    tags: assessments,
    recommendations,
    summary,
  };
}

/**
 * Print a formatted SST readiness report.
 */
export function printSSTReadinessReport(report: SSTReadinessReport): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(chalk.bold("  Server-Side Tagging Readiness Assessment"));
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  const scoreColor =
    report.score >= 70 ? chalk.green : report.score >= 40 ? chalk.yellow : chalk.red;
  console.log(`  Readiness Score: ${scoreColor(`${report.score}%`)}`);
  console.log(`  Data Layer:      ${report.dataLayerCoverage}% coverage`);
  console.log(
    `  Consent:         ${report.consentReady ? chalk.green("✔ Ready") : chalk.yellow("⚠ Needs work")}\n`,
  );

  const statusIcons: Record<string, string> = {
    ready: chalk.green("✔"),
    community: chalk.cyan("◉"),
    custom_required: chalk.yellow("⚠"),
    blocker: chalk.red("✖"),
  };

  const groups = [
    { label: "Ready for sGTM", status: "ready" as const },
    { label: "Community Template", status: "community" as const },
    { label: "Custom Work Needed", status: "custom_required" as const },
    { label: "Migration Blockers", status: "blocker" as const },
  ];

  for (const group of groups) {
    const tags = report.tags.filter((t) => t.migrationStatus === group.status);
    if (tags.length === 0) continue;

    console.log(`  ${statusIcons[group.status]} ${chalk.underline(group.label)} (${tags.length})`);
    for (const tag of tags) {
      console.log(`    ${tag.name} ${chalk.dim(`— ${tag.notes}`)}`);
    }
    console.log();
  }

  if (report.recommendations.length > 0) {
    console.log(chalk.bold("  Recommendations:"));
    for (const rec of report.recommendations) {
      console.log(`    → ${rec}`);
    }
    console.log();
  }

  console.log(chalk.bold("──────────────────────────────────────────────────"));
  console.log(`  ${report.summary}\n`);
}
