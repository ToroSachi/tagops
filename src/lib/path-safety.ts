import { dirname, isAbsolute, relative, resolve } from "node:path";
import { findConfigPath } from "./config.js";

function containsTraversalSegment(inputPath: string): boolean {
  return inputPath
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function getProjectRoot(baseDir?: string): string {
  const startDir = resolve(baseDir ?? process.cwd());
  const configPath = findConfigPath(startDir);
  return configPath ? dirname(configPath) : startDir;
}

export function resolveProjectPath(inputPath: string, label: string): string {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} path is required.`);
  }

  if (isAbsolute(trimmed) || trimmed.startsWith("/")) {
    throw new Error(`${label} path must be relative to the project root.`);
  }

  if (containsTraversalSegment(trimmed)) {
    throw new Error(`${label} path must not contain '..' path traversal segments.`);
  }

  const baseDir = resolve(process.cwd());
  const projectRoot = getProjectRoot(baseDir);
  const resolvedPath = resolve(baseDir, trimmed);
  const relativeToRoot = relative(projectRoot, resolvedPath);

  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith("../") ||
    relativeToRoot.startsWith("..\\") ||
    isAbsolute(relativeToRoot)
  ) {
    throw new Error(`${label} path must stay within the project root: ${projectRoot}`);
  }

  return resolvedPath;
}
