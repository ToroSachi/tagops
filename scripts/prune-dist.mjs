import { chmodSync, existsSync } from "node:fs";

// Ensure bin entries are executable after TypeScript compiles them.
// npm sets +x on install, but local `npm link` and `npm pack` benefit from this.
for (const entry of ["dist/cli.js", "dist/server.js"]) {
  if (existsSync(entry)) chmodSync(entry, 0o755);
}
