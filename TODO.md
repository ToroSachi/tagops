# TagOps OAuth Verification Todo

**Target Date:** Check back in 2-3 days

## Status

The CLI currently uses a generic Google Desktop OAuth client. This causes "App Blocked" errors in strict Google Workspaces because the app isn't officially verified.

For now, the workaround is using a Service Account or the `TAGOPS_CLIENT_ID` / `TAGOPS_CLIENT_SECRET` environment variables.

## Action Items to Fix Natively

To make `tagops auth login` work seamlessly for any user without an "App Blocked" warning:

1. **Create a Google Cloud Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a project (e.g., "TagOps CLI")

2. **Configure OAuth Consent Screen:**
   - Navigate to **APIs & Services > OAuth consent screen**
   - User Type: **External** (if distributing outside the company) or **Internal** (if only for company workspace)
   - Note: If _Internal_, verification is skipped entirely and it will just work!

3. **Add GTM Scopes:**
   - `https://www.googleapis.com/auth/tagmanager.edit.containers`
   - `https://www.googleapis.com/auth/tagmanager.publish`
   - `https://www.googleapis.com/auth/tagmanager.readonly`
   - `https://www.googleapis.com/auth/tagmanager.edit.containerversions`

4. **Create OAuth Client ID:**
   - Go to **Credentials > Create Credentials > OAuth client ID**
   - Application Type: **Desktop app**
   - Copy the Client ID and Client Secret
   - Hardcode these into `src/lib/auth.ts` (replace `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`)

5. **Submit for Verification (If External):**
   - Click "Submit for Verification" on the Consent Screen tab
   - Provide a Privacy Policy link
   - Provide a short YouTube video link showing the CLI logging in and managing GTM tags
   - Wait 2-3 days for Google trust & safety approval.
