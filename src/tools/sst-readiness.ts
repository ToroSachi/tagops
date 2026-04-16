/**
 * Server-Side Tagging Readiness Score
 *
 * Assesses how ready a GTM container is for migration to server-side tagging.
 * When the current container is already a server container, the assessment
 * shifts to auditing its operational server-side resources.
 *
 * Usage:
 *   tagops sst-readiness
 */

import chalk from "chalk";
import type {
  GtmClient,
  GtmParameter,
  GtmTag,
  GtmTransformation,
  GtmVariable,
} from "../types/gtm.js";

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
const BROWSER_ROUTING_TAG_TYPES = new Set(["gaawc", "gaawe", "googtag"]);
const SERVER_CLIENT_PATTERN = /(ga4|google analytics 4|measurement|http|data client)/i;
const GA4_CLIENT_PATTERN = /(ga4|google analytics 4)/i;
const CRITICAL_CONVERSION_PATTERN =
  /(purchase|lead|generate_lead|checkout|conversion|sign[_ -]?up|subscribe|contact)/i;
const COMMUNITY_CONVERSION_PATTERN = /(meta|facebook|tiktok|snapchat|pinterest)/i;
const DEFAULT_TAGGING_SERVER_DOMAIN_PATTERN = /(^|\.)tagging-server\.cloud$/i;

export type MigrationEffort = "low" | "moderate" | "high" | "complex";

export interface SSTTagAssessment {
  tagId: string;
  name: string;
  type: string;
  migrationStatus: "ready" | "community" | "custom_required" | "blocker";
  effort: "none" | "low" | "medium" | "high";
  notes: string;
}

export interface SSTContainerMetadata {
  features?: {
    supportClients?: boolean | null;
    supportTransformations?: boolean | null;
  } | null;
  taggingServerUrls?: string[] | null;
  usageContext?: string[] | null;
}

export interface SSTAssessmentContext {
  container?: SSTContainerMetadata | null;
  clients?: GtmClient[];
  transformations?: GtmTransformation[];
}

export interface ServerContainerAudit {
  available: boolean;
  isServerContainer: boolean;
  clientCount: number;
  transformationCount: number;
  browserRoutingCheckAvailable: boolean;
  browserTagCount: number;
  browserTaggingServerUrlCount: number;
  hasBrowserTaggingServerUrl: boolean;
  hasGa4Client: boolean;
  hasServerTags: boolean;
  serverTagCount: number;
  canProcessCriticalConversionsServerSide: boolean;
  criticalConversionCount: number;
  processableCriticalConversionCount: number;
  taggingServerUrlCount: number;
  usesCustomDomain: boolean;
  usesDefaultCloudDomainOnly: boolean;
}

export interface SSTReadinessReport {
  timestamp: string;
  containerType: "server" | "web_or_app" | "unknown";
  totalTags: number;
  ready: number;
  community: number;
  customRequired: number;
  blockers: number;
  dataLayerCoverage: number; // Legacy diagnostic only; not used in readiness scoring
  consentReady: boolean;
  migrationEffort: MigrationEffort;
  score: number; // 0-100
  tags: SSTTagAssessment[];
  recommendations: string[];
  serverContainerAudit: ServerContainerAudit;
  summary: string;
}

function getUsageContexts(context: SSTAssessmentContext): string[] {
  return (context.container?.usageContext ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
}

function isServerContainer(context: SSTAssessmentContext): boolean {
  const usageContexts = getUsageContexts(context);
  if (usageContexts.includes("server")) return true;
  if (usageContexts.length > 0) return false;

  return (
    context.container?.features?.supportClients === true ||
    context.container?.features?.supportTransformations === true ||
    (context.clients?.length ?? 0) > 0 ||
    (context.transformations?.length ?? 0) > 0
  );
}

function getContainerType(context: SSTAssessmentContext): SSTReadinessReport["containerType"] {
  if (isServerContainer(context)) return "server";
  if (context.container) return "web_or_app";
  return "unknown";
}

function isCriticalConversionTag(tag: GtmTag): boolean {
  const lowerName = tag.name.toLowerCase();
  if (["awct", "flc", "fls", "sp"].includes(tag.type)) return true;
  if (tag.type === "gaawe" && CRITICAL_CONVERSION_PATTERN.test(lowerName)) return true;
  return (
    COMMUNITY_CONVERSION_PATTERN.test(lowerName) && CRITICAL_CONVERSION_PATTERN.test(lowerName)
  );
}

function hasGa4Client(clients: GtmClient[]): boolean {
  return clients.some((client) => GA4_CLIENT_PATTERN.test(`${client.name} ${client.type}`));
}

function hasIngressClient(clients: GtmClient[]): boolean {
  return clients.some((client) => SERVER_CLIENT_PATTERN.test(`${client.name} ${client.type}`));
}

function collectParameterValues(parameters: GtmParameter[] | undefined, key: string): string[] {
  if (!parameters) return [];

  const values: string[] = [];
  const visit = (parameter: GtmParameter) => {
    if (parameter.key === key && typeof parameter.value === "string" && parameter.value.trim()) {
      values.push(parameter.value.trim());
    }
    for (const child of parameter.list ?? []) visit(child);
    for (const child of parameter.map ?? []) visit(child);
  };

  for (const parameter of parameters) visit(parameter);
  return values;
}

function supportsBrowserRouting(tag: GtmTag): boolean {
  return BROWSER_ROUTING_TAG_TYPES.has(tag.type);
}

function hasTaggingServerUrlParam(tag: GtmTag): boolean {
  return collectParameterValues(tag.parameter, "server_container_url").length > 0;
}

function getHostname(value: string): string | null {
  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isDefaultCloudDomain(value: string): boolean {
  const hostname = getHostname(value) ?? value.toLowerCase();
  return DEFAULT_TAGGING_SERVER_DOMAIN_PATTERN.test(hostname);
}

function estimateMigrationEffort(assessments: SSTTagAssessment[]): MigrationEffort {
  if (assessments.length === 0) return "low";

  const effortWeight: Record<SSTTagAssessment["effort"], number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  const blockerCount = assessments.filter(
    (assessment) => assessment.migrationStatus === "blocker",
  ).length;
  const highEffortCount = assessments.filter((assessment) => assessment.effort === "high").length;
  const mediumEffortCount = assessments.filter(
    (assessment) => assessment.effort === "medium",
  ).length;
  const averageEffort =
    assessments.reduce((total, assessment) => total + effortWeight[assessment.effort], 0) /
    assessments.length;

  if (blockerCount >= 4 || highEffortCount >= 3 || averageEffort >= 2.4) return "complex";
  if (blockerCount > 0 || highEffortCount > 0 || averageEffort >= 2.1) return "high";
  if (mediumEffortCount > 0 || averageEffort >= 1) return "moderate";
  return "low";
}

function calculateMigrationScore(
  ready: number,
  community: number,
  customRequired: number,
  consentReady: boolean,
  totalActive: number,
  audit: ServerContainerAudit,
): number {
  const tagScore = ((ready + community * 0.7 + customRequired * 0.25) / totalActive) * 65;
  const routingScore = audit.browserRoutingCheckAvailable
    ? audit.hasBrowserTaggingServerUrl
      ? 20
      : 0
    : 10;
  const domainScore = audit.taggingServerUrlCount === 0 ? 0 : audit.usesCustomDomain ? 10 : 5;
  const consentScore = consentReady || totalActive === 0 ? 5 : 2;

  return Math.round(Math.min(100, tagScore + routingScore + domainScore + consentScore));
}

function calculateServerScore(
  ready: number,
  community: number,
  customRequired: number,
  consentReady: boolean,
  totalActive: number,
  audit: ServerContainerAudit,
): number {
  const tagScore = ((ready + community * 0.8 + customRequired * 0.3) / totalActive) * 10;
  const clientScore = audit.clientCount > 0 ? 15 : 0;
  const ga4Score = audit.hasGa4Client ? 15 : 0;
  const routingScore = audit.browserRoutingCheckAvailable
    ? audit.hasBrowserTaggingServerUrl
      ? 10
      : 0
    : 10;
  const domainScore = audit.taggingServerUrlCount === 0 ? 0 : audit.usesCustomDomain ? 10 : 5;
  const serverTagScore = audit.hasServerTags ? 15 : 0;
  const transformationScore = audit.transformationCount > 0 ? 5 : 2;
  const conversionScore =
    audit.criticalConversionCount === 0
      ? 10
      : audit.canProcessCriticalConversionsServerSide
        ? 10
        : 0;
  const consentScore = consentReady || totalActive === 0 ? 10 : 5;
  return Math.round(
    Math.min(
      100,
      tagScore +
        clientScore +
        ga4Score +
        routingScore +
        domainScore +
        serverTagScore +
        transformationScore +
        conversionScore +
        consentScore,
    ),
  );
}

/**
 * Assess a single tag's server-side migration readiness.
 */
function assessTag(tag: GtmTag): SSTTagAssessment {
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

  if (SST_COMMUNITY_TYPES.has(tag.type)) {
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: "community",
      effort: "low",
      notes: `${SST_COMMUNITY_TYPES.get(tag.type)} — community sGTM support`,
    };
  }

  const lowerName = tag.name.toLowerCase();
  if (
    lowerName.includes("meta") ||
    lowerName.includes("facebook") ||
    lowerName.includes("fb pixel")
  ) {
    const conversionComplexity = isCriticalConversionTag(tag);
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: "community",
      effort: conversionComplexity ? "high" : "medium",
      notes: conversionComplexity
        ? "Meta/Facebook — community template exists, but expect higher effort for event mapping, deduplication, user data, and secrets"
        : "Meta/Facebook — community template exists, but expect medium effort for event mapping, deduplication, and auth/secrets",
    };
  }
  if (lowerName.includes("tiktok")) {
    const conversionComplexity = isCriticalConversionTag(tag);
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      migrationStatus: "community",
      effort: conversionComplexity ? "high" : "medium",
      notes: conversionComplexity
        ? "TikTok — community template exists, but expect higher effort for event mapping, click IDs, auth/secrets, and destination validation"
        : "TikTok — community template exists, but expect medium effort for event mapping, click IDs, and auth/secrets",
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

  if (SST_BLOCKER_PATTERNS.has(tag.type)) {
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

  return {
    tagId: tag.tagId,
    name: tag.name,
    type: tag.type,
    migrationStatus: "custom_required",
    effort: "medium",
    notes: `Tag type '${tag.type}' — check sGTM Community Template Gallery for support`,
  };
}

function buildServerContainerAudit(
  activeTags: GtmTag[],
  assessments: SSTTagAssessment[],
  context: SSTAssessmentContext,
): ServerContainerAudit {
  const clients = context.clients ?? [];
  const transformations = context.transformations ?? [];
  const taggingServerUrls = (context.container?.taggingServerUrls ?? []).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const assessmentByTagId = new Map(
    assessments.map((assessment) => [assessment.tagId, assessment]),
  );
  const criticalConversionTags = activeTags.filter(isCriticalConversionTag);
  const processableCriticalConversions = criticalConversionTags.filter((tag) => {
    const status = assessmentByTagId.get(tag.tagId)?.migrationStatus;
    return status === "ready" || status === "community";
  });

  const ingressClientAvailable = hasIngressClient(clients);
  const serverContainerDetected = isServerContainer(context);
  const browserTags = serverContainerDetected
    ? []
    : activeTags.filter((tag) => supportsBrowserRouting(tag));
  const browserTaggingServerUrlCount = browserTags.filter((tag) =>
    hasTaggingServerUrlParam(tag),
  ).length;
  const usesDefaultCloudDomainOnly =
    taggingServerUrls.length > 0 && taggingServerUrls.every((url) => isDefaultCloudDomain(url));

  return {
    available: Boolean(
      context.container ||
      clients.length > 0 ||
      transformations.length > 0 ||
      activeTags.length > 0,
    ),
    isServerContainer: serverContainerDetected,
    clientCount: clients.length,
    transformationCount: transformations.length,
    browserRoutingCheckAvailable: !serverContainerDetected && browserTags.length > 0,
    browserTagCount: browserTags.length,
    browserTaggingServerUrlCount,
    hasBrowserTaggingServerUrl: browserTaggingServerUrlCount > 0,
    hasGa4Client: hasGa4Client(clients),
    hasServerTags: serverContainerDetected && activeTags.length > 0,
    serverTagCount: serverContainerDetected ? activeTags.length : 0,
    canProcessCriticalConversionsServerSide:
      serverContainerDetected &&
      ingressClientAvailable &&
      processableCriticalConversions.length === criticalConversionTags.length,
    criticalConversionCount: criticalConversionTags.length,
    processableCriticalConversionCount: processableCriticalConversions.length,
    taggingServerUrlCount: taggingServerUrls.length,
    usesCustomDomain: taggingServerUrls.length > 0 && !usesDefaultCloudDomainOnly,
    usesDefaultCloudDomainOnly,
  };
}

function buildRecommendations(
  activeTags: GtmTag[],
  blockers: number,
  community: number,
  consentReady: boolean,
  serverContainerAudit: ServerContainerAudit,
): string[] {
  const recommendations: string[] = [];

  if (serverContainerAudit.isServerContainer) {
    if (serverContainerAudit.clientCount === 0) {
      recommendations.push(
        "Server container has no clients. Add at least one ingest client before routing traffic to it.",
      );
    }
    if (!serverContainerAudit.hasGa4Client) {
      recommendations.push(
        "GA4 client is missing. Add it so GA4 and downstream conversions can be ingested reliably server-side.",
      );
    }
    if (!serverContainerAudit.hasServerTags) {
      recommendations.push(
        "Server container has no active server tags. Add at least one destination tag such as GA4, Google Ads, or Floodlight before routing production traffic.",
      );
    }
    if (serverContainerAudit.taggingServerUrlCount === 0) {
      recommendations.push(
        "No tagging server URL is configured. Set one up before treating this server container as production-ready.",
      );
    } else if (serverContainerAudit.usesDefaultCloudDomainOnly) {
      recommendations.push(
        "Container only uses the default *.tagging-server.cloud endpoint. Configure a first-party custom domain for better cookie durability and production routing.",
      );
    }
    if (
      serverContainerAudit.browserRoutingCheckAvailable &&
      !serverContainerAudit.hasBrowserTaggingServerUrl
    ) {
      recommendations.push(
        "No supported browser tag is configured with `server_container_url`. Route at least one GA4 or Google tag to the server container.",
      );
    }
    if (serverContainerAudit.transformationCount === 0) {
      recommendations.push(
        "No transformations are configured. They are optional, but consider them for enrichment, normalization, or PII controls.",
      );
    }
    if (
      serverContainerAudit.criticalConversionCount > 0 &&
      !serverContainerAudit.canProcessCriticalConversionsServerSide
    ) {
      recommendations.push(
        `Only ${serverContainerAudit.processableCriticalConversionCount}/${serverContainerAudit.criticalConversionCount} critical conversion tag(s) appear processable server-side. Finish the missing client or template coverage.`,
      );
    }
    if (!consentReady && activeTags.length > 0) {
      recommendations.push(
        "Consent coverage is below 80% on server-side tags. Harden consent handling before routing more traffic.",
      );
    }
    if (blockers > 0) {
      recommendations.push(
        `${blockers} server-side tag(s) still depend on custom HTML or incompatible patterns and need rework.`,
      );
    }
    if (recommendations.length === 0) {
      recommendations.push(
        "Server container has core ingest coverage. Focus next on monitoring, routing, and transformation governance.",
      );
    }
    return recommendations;
  }

  if (blockers > 0) {
    recommendations.push(
      `${blockers} custom HTML tag(s) need manual rewriting — these are migration blockers.`,
    );
  }
  if (
    serverContainerAudit.browserRoutingCheckAvailable &&
    !serverContainerAudit.hasBrowserTaggingServerUrl
  ) {
    recommendations.push(
      "No supported browser tag is configured with `server_container_url`. Route at least one GA4 or Google tag to the server container.",
    );
  }
  if (serverContainerAudit.taggingServerUrlCount === 0) {
    recommendations.push(
      "No tagging server URL is configured yet. Set up the server endpoint before calling this production-ready.",
    );
  } else if (serverContainerAudit.usesDefaultCloudDomainOnly) {
    recommendations.push(
      "Only the default *.tagging-server.cloud endpoint is configured. Move to a first-party custom domain for better cookie durability and production routing.",
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

  return recommendations;
}

/**
 * Run server-side tagging readiness assessment.
 */
export function assessSSTReadiness(
  tags: GtmTag[],
  variables: GtmVariable[],
  context: SSTAssessmentContext = {},
): SSTReadinessReport {
  const activeTags = tags.filter((tag) => !tag.paused);
  const assessments = activeTags.map(assessTag);

  const ready = assessments.filter((assessment) => assessment.migrationStatus === "ready").length;
  const community = assessments.filter(
    (assessment) => assessment.migrationStatus === "community",
  ).length;
  const customRequired = assessments.filter(
    (assessment) => assessment.migrationStatus === "custom_required",
  ).length;
  const blockers = assessments.filter(
    (assessment) => assessment.migrationStatus === "blocker",
  ).length;

  const dlvCount = variables.filter((variable) => variable.type === "v").length;
  const dataLayerCoverage =
    variables.length > 0 ? Math.round((dlvCount / variables.length) * 100) : 0;

  const consentConfigured = activeTags.filter(
    (tag) => tag.consentSettings && tag.consentSettings.consentStatus === "needed",
  ).length;
  const consentReady = activeTags.length > 0 && consentConfigured / activeTags.length >= 0.8;

  const serverContainerAudit = buildServerContainerAudit(activeTags, assessments, context);
  const migrationEffort = estimateMigrationEffort(assessments);
  const totalActive = Math.max(activeTags.length, 1);
  const score = serverContainerAudit.isServerContainer
    ? calculateServerScore(
        ready,
        community,
        customRequired,
        consentReady,
        totalActive,
        serverContainerAudit,
      )
    : calculateMigrationScore(
        ready,
        community,
        customRequired,
        consentReady,
        totalActive,
        serverContainerAudit,
      );

  const recommendations = buildRecommendations(
    activeTags,
    blockers,
    community,
    consentReady,
    serverContainerAudit,
  );

  const containerType = getContainerType(context);
  const summary = serverContainerAudit.isServerContainer
    ? `${serverContainerAudit.clientCount} client(s), ${serverContainerAudit.serverTagCount} server tag(s), browser routing ${serverContainerAudit.browserRoutingCheckAvailable ? (serverContainerAudit.hasBrowserTaggingServerUrl ? "configured" : "missing") : "not verifiable"}, ${serverContainerAudit.usesCustomDomain ? "custom domain configured" : serverContainerAudit.usesDefaultCloudDomainOnly ? "default cloud domain only" : "server URL missing"}`
    : `${ready} ready, ${community} community, ${customRequired} custom, ${blockers} blocker(s) — migration effort: ${migrationEffort}`;

  return {
    timestamp: new Date().toISOString(),
    containerType,
    totalTags: activeTags.length,
    ready,
    community,
    customRequired,
    blockers,
    dataLayerCoverage,
    consentReady,
    migrationEffort,
    score,
    tags: assessments,
    recommendations,
    serverContainerAudit,
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
  const containerLabel =
    report.containerType === "server"
      ? chalk.cyan("Server")
      : report.containerType === "web_or_app"
        ? "Web/App"
        : "Unknown";

  console.log(`  Readiness Score: ${scoreColor(`${report.score}%`)}`);
  console.log(`  Container:       ${containerLabel}`);
  if (report.containerType !== "server") {
    console.log(`  Migration:       ${report.migrationEffort}`);
  }
  console.log(
    `  Consent:         ${report.consentReady ? chalk.green("✔ Ready") : chalk.yellow("⚠ Needs work")}`,
  );

  if (report.serverContainerAudit.available) {
    console.log(`  Clients:         ${report.serverContainerAudit.clientCount}`);
    if (report.serverContainerAudit.isServerContainer) {
      console.log(`  Server Tags:     ${report.serverContainerAudit.serverTagCount}`);
    }
    console.log(`  Transformations: ${report.serverContainerAudit.transformationCount}`);
    const routingStatus = report.serverContainerAudit.browserRoutingCheckAvailable
      ? report.serverContainerAudit.hasBrowserTaggingServerUrl
        ? chalk.green("✔ Configured")
        : chalk.yellow("⚠ Missing")
      : chalk.dim("Not verifiable from this container");
    console.log(`  Browser Routing: ${routingStatus}`);
    console.log(`  Server URLs:     ${report.serverContainerAudit.taggingServerUrlCount}`);
    if (report.serverContainerAudit.taggingServerUrlCount > 0) {
      const domainStatus = report.serverContainerAudit.usesCustomDomain
        ? chalk.green("✔ Custom domain")
        : report.serverContainerAudit.usesDefaultCloudDomainOnly
          ? chalk.yellow("⚠ Default cloud domain")
          : chalk.yellow("⚠ Needs review");
      console.log(`  Domain:          ${domainStatus}`);
    }
    console.log(
      `  GA4 Client:      ${report.serverContainerAudit.hasGa4Client ? chalk.green("✔ Present") : chalk.yellow("⚠ Missing")}`,
    );
    console.log(
      `  Conversions:     ${report.serverContainerAudit.canProcessCriticalConversionsServerSide ? chalk.green("✔ Processable") : chalk.yellow("⚠ Not fully processable")}\n`,
    );
  } else {
    console.log();
  }

  const statusIcons: Record<SSTTagAssessment["migrationStatus"], string> = {
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
    const tags = report.tags.filter((tag) => tag.migrationStatus === group.status);
    if (tags.length === 0) continue;

    console.log(`  ${statusIcons[group.status]} ${chalk.underline(group.label)} (${tags.length})`);
    for (const tag of tags) {
      console.log(`    ${tag.name} ${chalk.dim(`— ${tag.notes}`)}`);
    }
    console.log();
  }

  if (report.recommendations.length > 0) {
    console.log(chalk.bold("  Recommendations:"));
    for (const recommendation of report.recommendations) {
      console.log(`    → ${recommendation}`);
    }
    console.log();
  }

  console.log(chalk.bold("──────────────────────────────────────────────────"));
  console.log(`  ${report.summary}\n`);
}
