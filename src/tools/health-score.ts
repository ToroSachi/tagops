/**
 * Container Health Score
 *
 * A single 0-100 number combining ALL audits into one composite score.
 * This is the number agencies screenshot for client decks.
 *
 * Usage:
 *   tagops health-score
 *   tagops health-score --json
 */

import chalk from "chalk";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface HealthComponent {
  name: string;
  score: number; // 0-100
  weight: number; // 0-1, all weights must sum to 1
  details: string;
}

export interface ContainerHealthReport {
  timestamp: string;
  overallScore: number; // 0-100 weighted composite
  grade: "A" | "B" | "C" | "D" | "F";
  components: HealthComponent[];
  totalTags: number;
  totalTriggers: number;
  totalVariables: number;
  summary: string;
}

// ── Component Scorers ──

function scoreConsent(tags: GtmTag[]): HealthComponent {
  const activeTags = tags.filter((t) => !t.paused);
  if (activeTags.length === 0)
    return { name: "Consent Configuration", score: 100, weight: 0.15, details: "No active tags" };

  const configured = activeTags.filter(
    (t) => t.consentSettings && t.consentSettings.consentStatus === "needed",
  ).length;

  const score = Math.round((configured / activeTags.length) * 100);
  const details = `${configured}/${activeTags.length} tags have consent configured`;
  return { name: "Consent Configuration", score, weight: 0.15, details };
}

function scoreNaming(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variables: GtmVariable[],
): HealthComponent {
  // Check if resources follow naming conventions (prefix-based)
  const tagPrefixPattern = /^[A-Z][A-Za-z0-9]+ [-–]/;
  const variablePrefixPattern = /^(DLV|JS|1P|CJS|RegEx|Lookup|UDF|URL|Event|CONST|c) [-–]/;

  let total = 0;
  let compliant = 0;

  for (const tag of tags) {
    total++;
    if (tagPrefixPattern.test(tag.name)) compliant++;
  }
  for (const variable of variables) {
    total++;
    if (variablePrefixPattern.test(variable.name)) compliant++;
  }
  // Triggers are less strictly named, give them a pass
  total += triggers.length;
  compliant += triggers.length;

  if (total === 0)
    return { name: "Naming Conventions", score: 100, weight: 0.1, details: "No resources" };

  const score = Math.round((compliant / total) * 100);
  const details = `${compliant}/${total} resources follow naming conventions`;
  return { name: "Naming Conventions", score, weight: 0.1, details };
}

function scoreOrphanedResources(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variables: GtmVariable[],
): HealthComponent {
  // Orphaned triggers: not referenced by any tag
  const usedTriggerIds = new Set<string>();
  for (const tag of tags) {
    for (const tid of tag.firingTriggerId ?? []) usedTriggerIds.add(tid);
    for (const tid of tag.blockingTriggerId ?? []) usedTriggerIds.add(tid);
  }
  // Built-in triggers (IDs 2147479553, 2147479572, 2147479573) should be excluded
  const builtinIds = new Set(["2147479553", "2147479572", "2147479573"]);
  const orphanedTriggers = triggers.filter(
    (t) => !usedTriggerIds.has(t.triggerId) && !builtinIds.has(t.triggerId),
  );

  // Unused variables: not referenced by name in any tag/trigger JSON
  const allContent = JSON.stringify([...tags, ...triggers, ...variables]);
  const unusedVariables = variables.filter((v) => {
    const ref = `{{${v.name}}}`;
    return !allContent.includes(ref);
  });

  // Paused tags
  const pausedTags = tags.filter((t) => t.paused);

  const totalResources = tags.length + triggers.length + variables.length;
  const problemCount = orphanedTriggers.length + unusedVariables.length + pausedTags.length;

  if (totalResources === 0)
    return { name: "Resource Hygiene", score: 100, weight: 0.15, details: "No resources" };

  const score = Math.round(Math.max(0, 100 - (problemCount / totalResources) * 200));
  const details = `${orphanedTriggers.length} orphaned triggers, ${unusedVariables.length} unused variables, ${pausedTags.length} paused tags`;
  return { name: "Resource Hygiene", score, weight: 0.15, details };
}

function scoreCustomHTML(tags: GtmTag[]): HealthComponent {
  const activeTags = tags.filter((t) => !t.paused);
  if (activeTags.length === 0)
    return { name: "Custom HTML Risk", score: 100, weight: 0.15, details: "No active tags" };

  const htmlTags = activeTags.filter((t) => t.type === "html");
  const docWriteTags = htmlTags.filter((t) =>
    t.parameter?.some((p) => p.key === "supportDocumentWrite" && p.value === "true"),
  );

  // Custom HTML is a risk factor; document.write is worse
  const riskScore = htmlTags.length * 5 + docWriteTags.length * 15;
  const score = Math.max(0, 100 - riskScore);
  const details = `${htmlTags.length} custom HTML tags, ${docWriteTags.length} with document.write`;
  return { name: "Custom HTML Risk", score, weight: 0.15, details };
}

function scoreTriggerCoverage(tags: GtmTag[]): HealthComponent {
  const activeTags = tags.filter((t) => !t.paused);
  if (activeTags.length === 0)
    return { name: "Trigger Coverage", score: 100, weight: 0.1, details: "No active tags" };

  const withTriggers = activeTags.filter((t) => (t.firingTriggerId?.length ?? 0) > 0);
  const score = Math.round((withTriggers.length / activeTags.length) * 100);
  const details = `${withTriggers.length}/${activeTags.length} tags have firing triggers`;
  return { name: "Trigger Coverage", score, weight: 0.1, details };
}

function scoreDuplicates(tags: GtmTag[]): HealthComponent {
  const nameCount = new Map<string, number>();
  for (const tag of tags) {
    nameCount.set(tag.name, (nameCount.get(tag.name) ?? 0) + 1);
  }
  const duplicates = [...nameCount.values()].filter((c) => c > 1).length;

  if (tags.length === 0)
    return { name: "Duplicate Detection", score: 100, weight: 0.1, details: "No tags" };

  const score = Math.max(0, 100 - duplicates * 20);
  const details =
    duplicates === 0 ? "No duplicate tag names" : `${duplicates} duplicate tag name(s)`;
  return { name: "Duplicate Detection", score, weight: 0.1, details };
}

function scoreTagVolume(tags: GtmTag[]): HealthComponent {
  // Industry best practice: containers with 100+ tags are bloated
  const count = tags.length;
  let score: number;
  let details: string;

  if (count <= 30) {
    score = 100;
    details = `${count} tags — lean container`;
  } else if (count <= 60) {
    score = 85;
    details = `${count} tags — healthy size`;
  } else if (count <= 100) {
    score = 60;
    details = `${count} tags — consider cleanup`;
  } else {
    score = 30;
    details = `${count} tags — bloated, major cleanup recommended`;
  }

  return { name: "Container Size", score, weight: 0.05, details };
}

function scoreSPAFiring(tags: GtmTag[]): HealthComponent {
  const activeTags = tags.filter((t) => !t.paused);
  if (activeTags.length === 0)
    return { name: "SPA Firing Safety", score: 100, weight: 0.1, details: "No active tags" };

  const unlimitedCount = activeTags.filter(
    (t) => !t.tagFiringOption || t.tagFiringOption === "unlimited",
  ).length;

  const score = Math.round(Math.max(0, 100 - (unlimitedCount / activeTags.length) * 100));
  const details =
    unlimitedCount === 0
      ? "All tags have proper firing options"
      : `${unlimitedCount}/${activeTags.length} tags have unlimited firing (SPA risk)`;
  return { name: "SPA Firing Safety", score, weight: 0.1, details };
}

function scoreExactDuplicates(tags: GtmTag[]): HealthComponent {
  if (tags.length === 0)
    return { name: "Exact Duplicates", score: 100, weight: 0.05, details: "No tags" };

  // Hash tag configs (same approach as audit.ts)
  const hashes = new Map<string, number>();
  for (const tag of tags) {
    const payload = JSON.stringify({
      type: tag.type,
      config: tag.parameter,
      consent: tag.consentSettings,
      firing: tag.firingTriggerId?.slice().sort(),
      blocking: tag.blockingTriggerId?.slice().sort(),
      firingOpt: tag.tagFiringOption,
    });
    const key = payload; // simple string compare since we only need counts
    hashes.set(key, (hashes.get(key) ?? 0) + 1);
  }
  const duplicateGroups = [...hashes.values()].filter((c) => c > 1).length;
  const score = Math.max(0, 100 - duplicateGroups * 25);
  const details =
    duplicateGroups === 0
      ? "No exact duplicate tag configs"
      : `${duplicateGroups} group(s) of identically configured tags`;
  return { name: "Exact Duplicates", score, weight: 0.05, details };
}

function scoreGA4Schema(tags: GtmTag[]): HealthComponent {
  const ga4Tags = tags.filter((t) => t.type === "gaawe" && !t.paused);
  const ecomEvents = ["purchase", "view_item", "begin_checkout", "add_to_cart"];
  const ecomTags = ga4Tags.filter((t) => {
    const eventName = t.parameter?.find((p) => p.key === "eventName")?.value;
    return eventName && ecomEvents.includes(eventName);
  });

  if (ecomTags.length === 0)
    return { name: "GA4 Schema", score: 100, weight: 0.05, details: "No GA4 e-commerce tags" };

  let valid = 0;
  for (const tag of ecomTags) {
    const payloadStr = JSON.stringify(tag.parameter);
    const eventName = tag.parameter?.find((p) => p.key === "eventName")?.value;
    const hasItems = payloadStr.includes('"value":"items"');
    const hasValue = payloadStr.includes('"value":"value"');
    const hasTxId = eventName !== "purchase" || payloadStr.includes('"value":"transaction_id"');
    if (hasItems && hasValue && hasTxId) valid++;
  }

  const score = Math.round((valid / ecomTags.length) * 100);
  const details = `${valid}/${ecomTags.length} GA4 e-commerce tags have complete schemas`;
  return { name: "GA4 Schema", score, weight: 0.05, details };
}

function scoreFolderOrganization(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variables: GtmVariable[],
): HealthComponent {
  const all = [...tags, ...triggers, ...variables] as Array<{ parentFolderId?: string }>;
  if (all.length === 0)
    return { name: "Folder Organization", score: 100, weight: 0.05, details: "No resources" };

  const inFolders = all.filter((r) => r.parentFolderId).length;
  const pct = Math.round((inFolders / all.length) * 100);
  const score = Math.min(100, Math.round(pct * 1.5)); // 67%+ in folders => 100 score
  const details = `${pct}% of resources (${inFolders}/${all.length}) are organized into folders`;
  return { name: "Folder Organization", score, weight: 0.05, details };
}

/**
 * Generate a composite health score from all components.
 */
export function calculateHealthScore(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variables: GtmVariable[],
): ContainerHealthReport {
  const components = [
    scoreConsent(tags),
    scoreNaming(tags, triggers, variables),
    scoreOrphanedResources(tags, triggers, variables),
    scoreCustomHTML(tags),
    scoreTriggerCoverage(tags),
    scoreDuplicates(tags),
    scoreTagVolume(tags),
    scoreSPAFiring(tags),
    scoreExactDuplicates(tags),
    scoreGA4Schema(tags),
    scoreFolderOrganization(tags, triggers, variables),
  ];

  // Weighted average
  const overallScore = Math.round(components.reduce((sum, c) => sum + c.score * c.weight, 0));

  // Grade
  const grade: ContainerHealthReport["grade"] =
    overallScore >= 90
      ? "A"
      : overallScore >= 75
        ? "B"
        : overallScore >= 60
          ? "C"
          : overallScore >= 40
            ? "D"
            : "F";

  const summary = `Container health: ${grade} (${overallScore}/100) — ${tags.length} tags, ${triggers.length} triggers, ${variables.length} variables`;

  return {
    timestamp: new Date().toISOString(),
    overallScore,
    grade,
    components,
    totalTags: tags.length,
    totalTriggers: triggers.length,
    totalVariables: variables.length,
    summary,
  };
}

/**
 * Print a formatted health score report.
 */
export function printHealthReport(report: ContainerHealthReport): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(chalk.bold("  Container Health Score"));
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  const gradeColor =
    report.grade === "A"
      ? chalk.green
      : report.grade === "B"
        ? chalk.green
        : report.grade === "C"
          ? chalk.yellow
          : chalk.red;

  console.log(`  Overall: ${gradeColor(`${report.grade} (${report.overallScore}/100)`)}`);
  console.log(
    `  Resources: ${report.totalTags} tags, ${report.totalTriggers} triggers, ${report.totalVariables} variables\n`,
  );

  // Component breakdown
  for (const component of report.components) {
    const bar =
      "█".repeat(Math.round(component.score / 5)) +
      "░".repeat(20 - Math.round(component.score / 5));
    const color =
      component.score >= 80 ? chalk.green : component.score >= 50 ? chalk.yellow : chalk.red;
    const pct = String(component.score).padStart(3);
    console.log(`  ${color(bar)} ${pct}%  ${component.name}`);
    console.log(`  ${" ".repeat(20)}      ${chalk.dim(component.details)}`);
  }

  console.log(`\n${chalk.bold("──────────────────────────────────────────────────")}`);
  console.log(`  ${report.summary}\n`);
}
