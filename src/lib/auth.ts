/**
 * Google Tag Manager Authentication
 *
 * Supports multiple auth strategies in priority order:
 *   1. GTM_CREDENTIALS env var (CI/CD — JSON service account key)
 *   2. ~/.tagops-credentials.json (OAuth2 — from `tagops auth login`)
 *   3. Google Application Default Credentials (ADC / gcloud auth)
 *
 * `tagops auth login` performs a browser-based OAuth2 flow and saves
 * a refresh token locally. `tagops auth import` bridges credentials
 * from @owntag/gtm-cli for users who already authenticated there.
 */

import { GoogleAuth, OAuth2Client, type AuthClient } from "google-auth-library";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getSafeErrorMessage } from "./redaction.js";

// ── OAuth2 Configuration ──
// Google's public "Desktop app" OAuth client — used by gcloud and other CLIs.
// These are NOT secrets; they're embedded in every Google SDK.
// Users can override via environment variables if their Workspace blocks the default client.
const OAUTH_CLIENT_ID =
  process.env.TAGOPS_CLIENT_ID ||
  "764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET = process.env.TAGOPS_CLIENT_SECRET || "d-FL95Q19q7MQmFpd7hHD0Ty";

const TAGMANAGER_MANAGE_USERS_SCOPE = "https://www.googleapis.com/auth/tagmanager.manage.users";
const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

const SCOPES = [
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.publish",
  TAGMANAGER_MANAGE_USERS_SCOPE,
  USERINFO_EMAIL_SCOPE,
];
const CREDENTIALS_FILE = resolve(homedir(), ".tagops-credentials.json");
const GTM_CLI_CREDENTIALS = resolve(homedir(), ".config/gtm-cli/credentials.json");

// The googleapis SDK auth param expects: GoogleAuth | OAuth2Client | BaseExternalAccountClient | string
// Our auth paths produce: JSONClient (subclass of AuthClient), OAuth2Client, or AnyAuthClient (from getClient)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GtmAuthClient = AuthClient | GoogleAuth | OAuth2Client;
let authClient: GtmAuthClient | null = null;

type StoredOauthCredentials = {
  type?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string | null;
  access_token?: string | null;
  email?: string;
  imported_from?: string;
  imported_at?: string;
};

type CredentialsProvider = {
  getCredentials: () => Promise<{ client_email?: string | null }>;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function readStoredOauthEmail(): string | undefined {
  if (!existsSync(CREDENTIALS_FILE)) return undefined;

  try {
    const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8")) as StoredOauthCredentials;
    if (typeof data.email === "string" && data.email.trim().length > 0) {
      return normalizeEmail(data.email);
    }
  } catch {
    // Ignore malformed cached credentials here; auth loading handles the real error path.
  }

  return undefined;
}

async function getOAuthClientEmail(
  client: OAuth2Client,
  options: { useCache?: boolean } = {},
): Promise<string | undefined> {
  if (options.useCache !== false) {
    const cachedEmail = readStoredOauthEmail();
    if (cachedEmail) return cachedEmail;
  }

  const accessToken = await client.getAccessToken();
  const token = typeof accessToken === "string" ? accessToken : accessToken?.token;
  if (!token) return undefined;

  const tokenInfo = await client.getTokenInfo(token);
  if (typeof tokenInfo.email === "string" && tokenInfo.email.trim().length > 0) {
    return normalizeEmail(tokenInfo.email);
  }

  return undefined;
}

async function getServiceAccountEmail(client: GtmAuthClient): Promise<string | undefined> {
  const maybeClient = client as Partial<CredentialsProvider> & { email?: string | null };

  if (typeof maybeClient.email === "string" && maybeClient.email.trim().length > 0) {
    return normalizeEmail(maybeClient.email);
  }

  if (typeof maybeClient.getCredentials === "function") {
    const credentials = await maybeClient.getCredentials();
    if (
      typeof credentials.client_email === "string" &&
      credentials.client_email.trim().length > 0
    ) {
      return normalizeEmail(credentials.client_email);
    }
  }

  return undefined;
}

export async function getCurrentAuthenticatedEmail(): Promise<string | undefined> {
  const client = await getAuthClient();

  if (client instanceof OAuth2Client) {
    return getOAuthClientEmail(client);
  }

  return getServiceAccountEmail(client);
}

export async function getAuthClient(): Promise<GtmAuthClient> {
  if (authClient) return authClient;

  // 1. Try GTM_CREDENTIALS env var (for CI/CD without files)
  if (process.env.GTM_CREDENTIALS) {
    try {
      const keys = JSON.parse(process.env.GTM_CREDENTIALS);
      const auth = new GoogleAuth({ scopes: SCOPES });
      authClient = auth.fromJSON(keys);
      return authClient;
    } catch (err) {
      console.warn("Invalid JSON in GTM_CREDENTIALS environment variable.");
    }
  }

  // 2. Try tagops OAuth credentials cache
  if (existsSync(CREDENTIALS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
      if (data.type === "oauth") {
        const oauth2Client = new OAuth2Client(data.client_id, data.client_secret);

        // Set all available credentials
        const creds: Record<string, string> = {};
        if (data.refresh_token) creds.refresh_token = data.refresh_token;
        if (data.access_token) creds.access_token = data.access_token;
        oauth2Client.setCredentials(creds);

        authClient = oauth2Client;
        return authClient;
      }
    } catch (e) {
      // Fall through
    }
  }

  // 3. Try Google Application Default Credentials (ADC)
  try {
    const auth = new GoogleAuth({ scopes: SCOPES });
    authClient = await auth.getClient();
    return authClient;
  } catch (err) {
    throw new Error(
      "Not authenticated with Google.\n" +
        "Run `tagops auth login` to authenticate via browser,\n" +
        "or set GOOGLE_APPLICATION_CREDENTIALS to a Service Account JSON file.\n" +
        "See README.md for CI/CD setup.",
    );
  }
}

/**
 * Validates that current credentials can actually fetch from the Tag Manager API.
 */
export async function checkAuthStatus(): Promise<{
  authenticated: boolean;
  method: string;
  email?: string;
  error?: string;
}> {
  try {
    const client = await getAuthClient();

    const { tagmanager } = await import("@googleapis/tagmanager");
    const gtm = tagmanager({ version: "v2", auth: client as unknown as GoogleAuth });

    await gtm.accounts.list();

    let method = "Application Default Credentials";
    if (client.constructor.name === "OAuth2Client") method = "OAuth2 (tagops auth login)";
    else if (process.env.GTM_CREDENTIALS) method = "GTM_CREDENTIALS Env Var";

    const email = await getCurrentAuthenticatedEmail().catch(() => undefined);
    return { authenticated: true, method, email };
  } catch (err: unknown) {
    return { authenticated: false, method: "none", error: getSafeErrorMessage(err) };
  }
}

// ── Browser-based OAuth Login ──

/**
 * Run an interactive OAuth2 login flow:
 *   1. Start a local HTTP server on a random port
 *   2. Open the user's browser to Google's consent screen
 *   3. Receive the authorization code on the redirect
 *   4. Exchange the code for a refresh token
 *   5. Save to ~/.tagops-credentials.json
 */
export async function loginWithOAuth(): Promise<{
  success: boolean;
  email?: string;
  error?: string;
}> {
  return new Promise((resolveLogin) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost`);
        const code = url.searchParams.get("code");
        const errorParam = url.searchParams.get("error");

        if (errorParam) {
          res.writeHead(200, { "Content-Type": "text/html" });
          let helpText = `<p>${errorParam}</p>`;
          if (errorParam === "access_denied" || errorParam === "admin_policy_enforced") {
            helpText += `<p><strong>App Blocked Error?</strong> If your Google Workspace is blocking this app, you need to either:<ol><li>Provide your own OAuth Client ID via <code>process.env.TAGOPS_CLIENT_ID</code> and <code>TAGOPS_CLIENT_SECRET</code></li><li>Or use a Google Service Account JSON file instead (set <code>GOOGLE_APPLICATION_CREDENTIALS</code>)</li></ol></p>`;
          }
          res.end(
            `<html><body style="font-family:system-ui;padding:40px;"><h2>Authentication failed</h2>${helpText}<p>You can close this tab and return to the terminal.</p></body></html>`,
          );
          server.close();
          resolveLogin({ success: false, error: errorParam });
          return;
        }

        if (!code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><p>Waiting for authentication...</p></body></html>");
          return;
        }

        // Exchange code for tokens
        const oauth2Client = new OAuth2Client(
          OAUTH_CLIENT_ID,
          OAUTH_CLIENT_SECRET,
          `http://localhost:${(server.address() as { port: number }).port}`,
        );

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        if (!tokens.refresh_token) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            `<html><body><h2>Error</h2><p>No refresh token received. Try revoking access at <a href="https://myaccount.google.com/permissions">Google Account Permissions</a> and running <code>tagops auth login</code> again.</p></body></html>`,
          );
          server.close();
          resolveLogin({
            success: false,
            error: "No refresh token received. Revoke access and retry.",
          });
          return;
        }

        // Save credentials
        const email = await getOAuthClientEmail(oauth2Client, { useCache: false }).catch(
          () => undefined,
        );
        const creds = {
          type: "oauth",
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
          refresh_token: tokens.refresh_token,
          email,
        };
        writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });

        // Clear cached auth client so the new credentials are picked up
        authClient = null;

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2 style="color:#22c55e">✔ Authenticated with TagOps</h2><p>Credentials saved. You can close this tab and return to the terminal.</p></body></html>`,
        );
        server.close();
        resolveLogin({ success: true });
      } catch (err) {
        const safeMessage = getSafeErrorMessage(err);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Error</h2><p>${safeMessage}</p></body></html>`);
        server.close();
        resolveLogin({ success: false, error: safeMessage });
      }
    });

    // Listen on a random available port
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://localhost:${port}`;

      const oauth2Client = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, redirectUri);
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        prompt: "consent", // Force consent screen to get refresh_token
      });

      // Open the browser
      const open =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      import("node:child_process").then(({ exec }) => {
        exec(`${open} "${authUrl}"`);
      });

      console.log(`\n  Opening browser for Google authentication...`);
      console.log(`  If the browser doesn't open, visit:`);
      console.log(`  ${authUrl}\n`);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      resolveLogin({ success: false, error: "Authentication timed out after 2 minutes." });
    }, 120_000);
  });
}

// ── Import from @owntag/gtm-cli ──

/**
 * Import OAuth credentials from @owntag/gtm-cli's credential store.
 * Since the gtm-cli binary uses its own OAuth client ID, we can't reuse the
 * refresh token directly. Instead, we use the stored access token to make a
 * tokeninfo call and prompt the user to do a proper `tagops auth login`.
 *
 * However, if the user's refresh token was obtained via the same Google
 * default OAuth client, this import will work directly.
 */
export async function importFromGtmCli(): Promise<{ success: boolean; message: string }> {
  if (!existsSync(GTM_CLI_CREDENTIALS)) {
    return {
      success: false,
      message: `No @owntag/gtm-cli credentials found at ${GTM_CLI_CREDENTIALS}.\nRun \`tagops auth login\` instead to authenticate directly.`,
    };
  }

  try {
    const data = JSON.parse(readFileSync(GTM_CLI_CREDENTIALS, "utf-8"));

    if (!data.accessToken) {
      return {
        success: false,
        message: "gtm-cli credentials file exists but has no access token.",
      };
    }

    // Try to use the access token directly via OAuth2Client
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({ access_token: data.accessToken });

    // Verify it works by calling the Tag Manager API
    const { tagmanager } = await import("@googleapis/tagmanager");
    const gtm = tagmanager({ version: "v2", auth: oauth2Client as unknown as GoogleAuth });
    await gtm.accounts.list();

    // It works — save as a tagops credential with the access token
    // Note: access tokens expire (~1h), so this is a temporary bridge.
    // We do NOT save the gtm-cli refresh token because it belongs to a different client ID
    // and would cause "unauthorized_client" errors if we tried to use it.
    const email = await getOAuthClientEmail(oauth2Client, { useCache: false }).catch(
      () => undefined,
    );
    const creds = {
      type: "oauth",
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: null, // Always null for imports
      access_token: data.accessToken,
      email,
      imported_from: "gtm-cli",
      imported_at: new Date().toISOString(),
    };
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });

    // Clear cached auth client
    authClient = null;

    return {
      success: true,
      message:
        "Imported credentials from @owntag/gtm-cli.\nNote: Access tokens expire in ~1 hour. If auth fails later, run `tagops auth login` for a permanent login.",
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to import credentials: ${getSafeErrorMessage(err)}\nRun \`tagops auth login\` instead.`,
    };
  }
}

export function promptAuthLogin() {
  return (
    "Not authenticated with Google.\n\n" +
    "Authenticate using one of the following methods:\n\n" +
    "  1. Browser login (recommended):\n" +
    "     tagops auth login\n" +
    "     (Note: If your Google Workspace displays 'App Blocked', set TAGOPS_CLIENT_ID\n" +
    "     and TAGOPS_CLIENT_SECRET env vars to use a verified internal OAuth client.)\n\n" +
    "  2. Service Account (best for CI/CD or restricted Workspaces):\n" +
    '     export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"\n\n' +
    "  3. Import from @owntag/gtm-cli:\n" +
    "     tagops auth import\n"
  );
}
