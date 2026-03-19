import { rmSync } from "node:fs";

rmSync("dist/ui-app", { recursive: true, force: true });
