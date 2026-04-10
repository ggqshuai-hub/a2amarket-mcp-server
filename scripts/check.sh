#!/usr/bin/env bash
# A2A Market — Quick connectivity check
# Usage: A2AMARKET_API_KEY=ak_xxx bash scripts/check.sh
#
# Checks:
# 1. API Key is set
# 2. Network connectivity to api.a2amarket.md
# 3. API Key validity (calls get_balance endpoint)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BASE_URL="${A2AMARKET_BASE_URL:-https://api.a2amarket.md}"
API_KEY="${A2AMARKET_API_KEY:-}"

echo ""
echo "🔍 A2A Market — Connectivity Check"
echo ""

# 1. Check API Key
if [ -z "$API_KEY" ]; then
  echo -e "${RED}❌ A2AMARKET_API_KEY not set${NC}"
  echo "   Set it: export A2AMARKET_API_KEY=ak_your_key_here"
  echo ""
  exit 1
fi
echo -e "${GREEN}✅ API Key: ${API_KEY:0:10}...${NC}"

# 2. Check network
if ! curl -sf --max-time 5 -o /dev/null "$BASE_URL/acap/v1/compute/balance" -H "X-Agent-Key: test" 2>/dev/null; then
  # Try just connecting
  if ! curl -sf --max-time 5 -o /dev/null "$BASE_URL" 2>/dev/null; then
    echo -e "${RED}❌ Cannot reach $BASE_URL${NC}"
    echo "   Check your network or BASE_URL setting"
    echo ""
    exit 1
  fi
fi
echo -e "${GREEN}✅ Network: $BASE_URL reachable${NC}"

# 3. Validate API Key
RESPONSE=$(curl -sf --max-time 10 \
  -H "X-Agent-Key: $API_KEY" \
  -H "Accept: application/json" \
  "$BASE_URL/acap/v1/compute/balance" 2>&1) || {
  HTTP_CODE=$(curl -sf --max-time 10 -o /dev/null -w "%{http_code}" \
    -H "X-Agent-Key: $API_KEY" \
    "$BASE_URL/acap/v1/compute/balance" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "401" ]; then
    echo -e "${RED}❌ API Key invalid (401 Unauthorized)${NC}"
    echo "   Check your key or get a new one at https://dev.a2amarket.md"
  else
    echo -e "${YELLOW}⚠️  Server returned HTTP $HTTP_CODE${NC}"
  fi
  echo ""
  exit 1
}

echo -e "${GREEN}✅ API Key valid${NC}"
echo ""
echo -e "${GREEN}✅ All checks passed! MCP Server is ready to use.${NC}"
echo ""
echo "  Next steps:"
echo "    npx @hz-abyssal-heart/a2amarket-mcp-server          # Start MCP Server"
echo "    npx @hz-abyssal-heart/a2amarket-mcp-server --sse     # Start in SSE mode"
echo ""
