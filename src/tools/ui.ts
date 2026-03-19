import express from "express";
import cors from "cors";
import open from "open";
import chalk from "chalk";
import { resolve, dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { listProfileConfigs, loadConfig } from "../lib/config.js";
import { getAuthClient } from "../lib/auth.js";
import { tagmanager } from "@googleapis/tagmanager";
import { calculateHealthScore } from "./health-score.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function launchUI(port = 3000) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve static UI files from dist/ui
  // When running via tsx from src/, __dirname is src/tools, so dist/ui is ../../dist/ui
  // When running compiled via node from dist/, __dirname is dist/tools, so dist/ui is ../ui
  const isDev = __dirname.includes("src/tools");
  const uiPath = isDev ? resolve(__dirname, "../../dist/ui") : resolve(__dirname, "../ui");

  // API Routes
  app.get("/api/profiles", (req, res) => {
    try {
      res.json(listProfileConfigs());
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/health/:profile", async (req, res) => {
    try {
      const profileName = req.params.profile;
      const config = loadConfig(profileName);
      const auth = await getAuthClient();
      const gtm = tagmanager({ version: "v2", auth: auth as any });

      const parent = `accounts/${config.accountId}/containers/${config.containerId}/workspaces/${config.workspaceId}`;
      const [tagsRes, triggersRes, variablesRes] = await Promise.all([
        gtm.accounts.containers.workspaces.tags.list({ parent }),
        gtm.accounts.containers.workspaces.triggers.list({ parent }),
        gtm.accounts.containers.workspaces.variables.list({ parent }),
      ]);

      const tags = (tagsRes.data.tag || []) as import("../types/gtm.js").GtmTag[];
      const triggers = (triggersRes.data.trigger || []) as import("../types/gtm.js").GtmTrigger[];
      const variables = (variablesRes.data.variable ||
        []) as import("../types/gtm.js").GtmVariable[];

      const report = calculateHealthScore(tags, triggers, variables);
      res.json(report);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Serve the React App
  if (existsSync(uiPath)) {
    app.use(express.static(uiPath));
    app.get("*", (req, res) => {
      if (!req.path.startsWith("/api/")) {
        res.sendFile(join(uiPath, "index.html"));
      }
    });
  } else {
    app.get("*", (req, res) => {
      res.status(404).send(`UI build not found at ${uiPath}. Run 'npm run build:ui' first.`);
    });
  }

  app.listen(port, async () => {
    const url = `http://localhost:${port}`;
    console.log(chalk.green(`\n🚀 tagops local dashboard running at: `) + chalk.cyan.bold(url));
    console.log(chalk.dim("Press Ctrl+C to stop the server\n"));

    // Automatically open the browser
    try {
      await open(url);
    } catch (e) {
      // Ignore open errors (e.g., in CI or headless environments)
    }
  });
}
