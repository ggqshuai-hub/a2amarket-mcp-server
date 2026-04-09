#!/usr/bin/env bash
# A2A Market — OpenClaw One-Line Setup
# Usage: bash setup-openclaw.sh [API_KEY]
#
# What it does:
# 1. Installs the a2amarket-agent skill via clawhub (if available) or copies locally
# 2. Registers the MCP server in openclaw.json via `openclaw config set`
# 3. Restarts the gateway to pick up changes
#
# If API_KEY is not provided, it will prompt for it.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; }

# --- 1. Check prerequisites ---
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install Node.js 18+ first."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  error "Node.js 18+ required (found v$NODE_VERSION)."
  exit 1
fi

if ! command -v npx &>/dev/null; then
  error "npx not found. Install npm/npx first."
  exit 1
fi

# --- 2. Get API Key ---
API_KEY="${1:-}"
if [ -z "$API_KEY" ]; then
  echo ""
  echo "A2A Market API Key is required."
  echo "Get one at: https://dev.a2amarket.md/console/agents"
  echo ""
  read -rp "Enter your API Key (ak_live_...): " API_KEY
fi

if [[ ! "$API_KEY" =~ ^ak_ ]]; then
  warn "API Key doesn't start with 'ak_'. Proceeding anyway..."
fi

# --- 3. Install skill ---
if command -v clawhub &>/dev/null; then
  info "Installing skill via ClawHub..."
  clawhub install ggqshuai-hub/a2amarket-agent 2>/dev/null && info "Skill installed." || warn "ClawHub install failed, skill may already exist."
elif command -v openclaw &>/dev/null; then
  info "Installing skill via OpenClaw..."
  openclaw skills install a2amarket-agent 2>/dev/null && info "Skill installed." || warn "Skill install failed, may already exist."
else
  warn "Neither clawhub nor openclaw CLI found. Skill must be installed manually."
  warn "Run: clawhub install ggqshuai-hub/a2amarket-agent"
fi

# --- 4. Register MCP Server ---
info "Registering MCP server in OpenClaw config..."

if command -v openclaw &>/dev/null; then
  openclaw config set mcp.servers.a2amarket.command "npx"
  openclaw config set mcp.servers.a2amarket.args '[ "-y", "@hz-abyssal-heart/a2amarket-mcp-server" ]' --strict-json
  openclaw config set mcp.servers.a2amarket.env.A2AMARKET_API_KEY "$API_KEY"
  info "MCP server registered."
else
  # Fallback: write directly to openclaw.json
  OPENCLAW_CONFIG="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"
  if [ -f "$OPENCLAW_CONFIG" ]; then
    warn "openclaw CLI not found. Please add MCP server config manually:"
    echo ""
    echo '  "mcp": {'
    echo '    "servers": {'
    echo '      "a2amarket": {'
    echo '        "command": "npx",'
    echo '        "args": ["-y", "@hz-abyssal-heart/a2amarket-mcp-server"],'
    echo "        \"env\": { \"A2AMARKET_API_KEY\": \"$API_KEY\" }"
    echo '      }'
    echo '    }'
    echo '  }'
    echo ""
  fi
fi

# --- 5. Restart gateway ---
if command -v openclaw &>/dev/null; then
  info "Restarting OpenClaw gateway..."
  openclaw gateway restart 2>/dev/null && info "Gateway restarted." || warn "Gateway restart failed. You may need to restart manually."
fi

# --- 6. Verify ---
echo ""
info "Setup complete! 🦐"
echo ""
echo "  Skill:      a2amarket-agent"
echo "  MCP Server: @hz-abyssal-heart/a2amarket-mcp-server"
echo "  API Key:    ${API_KEY:0:10}..."
echo ""
echo "  Test it: ask your agent '查看我的算力余额' or 'check my balance'"
echo ""
echo "  Need help? https://dev.a2amarket.md/docs"
echo ""
