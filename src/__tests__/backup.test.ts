import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPreFixBackup, listPreFixBackups } from "../lib/pre-fix-backup.js";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const BACKUP_DIR = join(PROJECT_ROOT, "backups", "pre-fix");

// Mock gtm-cli to avoid real API calls
vi.mock("../lib/gtm-cli.js", () => ({
  listTags: vi.fn().mockResolvedValue([{ tagId: "1", name: "Test Tag", type: "html" }]),
  listTriggers: vi
    .fn()
    .mockResolvedValue([{ triggerId: "1", name: "Test Trigger", type: "pageview" }]),
  listVariables: vi
    .fn()
    .mockResolvedValue([{ variableId: "1", name: "Test Var", type: "constant" }]),
}));

describe("Pre-Fix Backup System", () => {
  beforeEach(() => {
    // Clean backup dir before each test
    if (existsSync(BACKUP_DIR)) {
      rmSync(BACKUP_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(BACKUP_DIR)) {
      rmSync(BACKUP_DIR, { recursive: true, force: true });
    }
  });

  it("creates a backup file with correct metadata", async () => {
    const result = await createPreFixBackup("test-tool");

    expect(existsSync(result.backupPath)).toBe(true);
    expect(result.toolName).toBe("test-tool");
    expect(result.tagCount).toBe(1);
    expect(result.triggerCount).toBe(1);
    expect(result.variableCount).toBe(1);

    const content = JSON.parse(
      await import("node:fs").then((fs) => fs.readFileSync(result.backupPath, "utf-8")),
    );
    expect(content.meta.toolName).toBe("test-tool");
    expect(content.tags[0].name).toBe("Test Tag");
  });

  it("lists backups in reverse chronological order", async () => {
    // Create two backups
    await createPreFixBackup("tool-a");
    // Small delay to ensure different timestamps if granularity is seconds
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await createPreFixBackup("tool-b");

    const backups = listPreFixBackups();
    expect(backups.length).toBe(2);
    expect(backups[0].toolName).toBe("tool-b");
    expect(backups[1].toolName).toBe("tool-a");
  });
});
