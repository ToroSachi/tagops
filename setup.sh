#!/bin/bash
# TagOps Setup Script
# Run this once to configure the TagOps CLI tool for a project.

set -e

echo "=== TagOps Setup ==="

# 1. Install tagops globally
echo "[1/4] Installing tagops..."
npm install -g .

# 2. Verify installation
echo "[2/4] Verifying installation..."
tagops --version

# 3. Authenticate
echo "[3/4] Checking Google Cloud Credentials..."
if [ -z "$GOOGLE_APPLICATION_CREDENTIALS" ] && [ -z "$GTM_CREDENTIALS" ]; then
  echo "  No credentials found."
  echo "  Recommended for most teams: use a Service Account JSON key."
  echo "  Browser OAuth (tagops auth login) may be blocked in strict Google Workspaces."
  read -p "  Press Enter when you have completed this step..."
else
  echo "  Credentials detected. Verifying..."
  tagops auth status
fi

# 4. Set default IDs
echo "[4/4] Setting default account/container/workspace IDs via tagops init..."
echo "  You can find these in your GTM URL."
read -p "  Account ID: " ACCOUNT_ID
read -p "  Container ID: " CONTAINER_ID
read -p "  Workspace ID (default: 1): " WORKSPACE_ID
WORKSPACE_ID=${WORKSPACE_ID:-1}

tagops init --account-id "$ACCOUNT_ID" --container-id "$CONTAINER_ID" --workspace-id "$WORKSPACE_ID"

echo ""
echo "=== Setup Complete ==="
echo "Test it with: tagops status"
echo ""
