import chalk from "chalk";

/** Standardized error codes for the TagOps CLI. */
export enum ErrorCode {
  AUTH_MISSING = "E_AUTH_MISSING",
  CONFIG_MISSING = "E_CONFIG_MISSING",
  API_RATE_LIMIT = "E_API_RATE_LIMIT",
  API_FORBIDDEN = "E_API_FORBIDDEN",
  API_NOT_FOUND = "E_API_NOT_FOUND",
  RESOURCE_DUPLICATE = "E_RESOURCE_DUPLICATE",
  VALIDATION_FAILED = "E_VALIDATION_FAILED",
  INTERNAL_ERROR = "E_INTERNAL_ERROR",
}

export interface TagOpsErrorOptions {
  code: ErrorCode;
  message: string;
  suggestion?: string;
  cause?: unknown;
}

/**
 * A structured error class representing an expected operational failure in TagOps.
 */
export class TagOpsError extends Error {
  public code: ErrorCode;
  public suggestion?: string;
  public cause?: unknown;

  constructor(options: TagOpsErrorOptions) {
    super(options.message);
    this.name = "TagOpsError";
    this.code = options.code;
    this.suggestion = options.suggestion;
    this.cause = options.cause;

    // Fix prototype chain when extending Error in TS
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Maps raw API errors or unknown throws into structured TagOpsErrors.
 */
export function handleError(err: unknown): never {
  const isDebug = process.env.DEBUG === "true";

  if (err instanceof TagOpsError) {
    console.error(chalk.red.bold(`\n  ✖ [${err.code}] Error`));
    console.error(`  ${err.message}`);
    if (err.suggestion) {
      console.error(chalk.yellow(`\n  💡 Suggestion:`));
      console.error(`  ${err.suggestion}\n`);
    }
  } else {
    // Map common Google API errors
    const maybeApiError = err as any;
    const status = maybeApiError?.response?.status;
    const dataMessage = maybeApiError?.response?.data?.error?.message?.toLowerCase() || "";

    console.error(chalk.red.bold(`\n  ✖ [E_UNEXPECTED] Error`));

    if (status === 401 || status === 403) {
      console.error(`  Google API Authentication Failed (HTTP ${status})`);
      console.error(chalk.yellow(`\n  💡 Suggestion:`));
      console.error(`  Run 'tagops auth login' to refresh your credentials.`);
      console.error(`  Ensure your Service Account has "Editor" access to the GTM container.\n`);
    } else if (status === 404) {
      console.error(`  Resource Not Found (HTTP 404)`);
      console.error(chalk.yellow(`\n  💡 Suggestion:`));
      console.error(
        `  Verify that your account, container, and workspace IDs in .gtmrc.json are correct.\n`,
      );
    } else if (status === 429 || dataMessage.includes("rate limit")) {
      console.error(`  Google API Rate Limit Exceeded`);
      console.error(chalk.yellow(`\n  💡 Suggestion:`));
      console.error(`  Wait exactly 100 seconds before retrying (100 requests / 100 sec limit).\n`);
    } else {
      console.error(`  ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  if (isDebug) {
    console.error(chalk.dim("\n--- Stack Trace ---"));
    if (err instanceof Error) console.error(chalk.dim(err.stack));
    if (err instanceof TagOpsError && err.cause instanceof Error) {
      console.error(chalk.dim("\n--- Caused By ---"));
      console.error(chalk.dim(err.cause.stack));
    }
    console.error(chalk.dim("-------------------\n"));
  } else {
    console.error(chalk.dim(`  Pass DEBUG=true for stack traces.\n`));
  }

  process.exit(1);
}
