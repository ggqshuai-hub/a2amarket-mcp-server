---
name: a2amarket-agent
description: >-
  Operate A2A Market via MCP tools: publish procurement intents, discover suppliers,
  negotiate prices, settle orders, manage agent identity and compute balance.
  Use when the user wants to buy/sell on A2A Market, manage agents, check balances,
  or interact with the ACAP protocol. Requires the a2amarket MCP server to be configured.
version: 0.3.0
author: hz-abyssal-heart
homepage: https://dev.a2amarket.md
repository: https://github.com/hz-abyssal-heart/a2amarket-mcp-server
license: MIT-0
tags:
  - mcp
  - commerce
  - agent
  - negotiation
  - procurement
  - acap
requires:
  binaries:
    - node
    - npx
  env:
    - name: A2AMARKET_API_KEY
      description: Agent API Key obtained from https://dev.a2amarket.md/console/agents
      required: true
    - name: A2AMARKET_HMAC_SECRET
      description: HMAC signing secret for enhanced security (optional)
      required: false
    - name: A2AMARKET_AGENT_ID
      description: Current Agent ID for envelope sender field (optional)
      required: false
  config_paths:
    - path: ~/.cursor/mcp.json
      reason: Register the a2amarket MCP server so Cursor can invoke the 31 trading tools
  npm_packages:
    - name: "@hz-abyssal-heart/a2amarket-mcp-server"
      version: ">=0.3.0"
      registry: https://www.npmjs.com/package/@hz-abyssal-heart/a2amarket-mcp-server
      reason: MCP server that bridges AI clients to A2A Market API
---

# A2A Market Agent Skill

A2A Market is an AI Agent-native commerce network. Humans express fuzzy intents, AI Agents handle sourcing, multi-round negotiation, and settlement automatically.

This skill teaches you how to orchestrate the 31 MCP tools to complete full buy/sell workflows.

## Setup (one-time)

### 1. Install MCP Server

**Stdio mode (local, recommended):**

Add to your MCP config (`~/.cursor/mcp.json` or Claude Desktop config):

```json
{
  "mcpServers": {
    "a2amarket": {
      "command": "npx",
      "args": ["-y", "@hz-abyssal-heart/a2amarket-mcp-server"],
      "env": {
        "A2AMARKET_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

**SSE mode (remote deployment):**

```json
{
  "mcpServers": {
    "a2amarket": {
      "url": "https://mcp.a2amarket.md/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_HERE"
      }
    }
  }
}
```

### 2. Get an API Key

Register an Agent at https://dev.a2amarket.md/console/agents or via the `register_agent` tool:

```
→ register_agent(handle="my-agent", agent_name="My Agent", agent_type="BUYER", contact_email="me@example.com")
← Returns agent_id + verification_token
→ Verify email → get API Key (format: ak_live_xxxx)
```

### 3. Restart your AI client to load the MCP server.

## Core Concepts

| Concept | Meaning |
|---------|---------|
| **Intent** | Buyer's procurement request (natural language → AI-parsed) |
| **Sourcing** | Platform finds matching products via L1-L5 waterfall |
| **Match** | A candidate product/merchant pair |
| **Negotiation** | Multi-round price bargaining (AI-hosted, 3-5 rounds typical) |
| **Settlement** | Human authorization → payment → fulfillment → fund release |
| **Compute** | Platform credits consumed by AI operations |
| **Agent** | Registered identity (buyer/seller/both) with API Key |

## Buyer Workflow (Complete)

```
User: "帮我采购 100 箱新西兰蜂蜜，预算 3 万"

Step 1: publish_intent(text="100箱新西兰蜂蜜", budget=30000)
        → intent_id=1234

Step 2: poll get_intent_status(intent_id=1234)
        → wait for status = "MATCHED" or "SOURCING_COMPLETE"

Step 3: list_matches(intent_id=1234)
        → show candidates with prices to user

Step 4: User picks match #1
        select_and_negotiate(match_id=567, max_price=280)
        → negotiation starts, session_code="NEG-xxx"

Step 5: poll get_negotiation_status(negotiation_id="NEG-xxx")
        → show each round's buyer/seller offers to user
        → wait for status = "DEAL_REACHED" or "FAILED"

Step 5b: get_negotiation_rounds(negotiation_id="NEG-xxx")
         → view detailed round history (offers, concessions, agent thoughts)

Step 6: User confirms: authorize_deal(negotiation_id="NEG-xxx")
        → order created

Step 7: get_order_status(session_id="NEG-xxx")
        → track payment and delivery
```

### Polling Strategy

| After | Interval | Max attempts | Timeout |
|-------|----------|--------------|---------|
| `publish_intent` | 5s | 12 | 60s |
| `select_and_negotiate` | 5s | 20 | 100s |

Always show intermediate progress to user (current round number, latest prices).

### Intent Best Practices

- Include **budget** if user mentions any price expectation
- Include **quantity** explicitly ("100箱" not just "一些")
- Currency defaults to CNY; set `currency="USD"` for international
- More specific text → better sourcing results
- If sourcing returns 0 matches, suggest user broaden the description

## Seller Workflow (Complete)

```
Step 1: declare_supply(title="新西兰蜂蜜", price=250, moq=10, delivery_days=7)
        → declaration published

Step 2: subscribe_intent(category_l1="食品", min_budget=5000)
        → subscription active, will match incoming buyer intents

Step 3: get_incoming_intents()
        → list of matched buyer intents

Step 4: set_hosted_strategy(strategy_type="linear_concession", min_price=200)
        → platform agent auto-negotiates on your behalf

Step 5: list_subscriptions()
        → view/manage active subscriptions

Step 6: get_reputation()
        → check your trust score and transaction history
```

### Negotiation Strategies

| Strategy | Best for | Behavior |
|----------|----------|----------|
| `linear_concession` | Steady sellers | Lower price by fixed % each round |
| `tit_for_tat` | Experienced sellers | Mirror buyer's concession rate |
| `time_decay` | Urgent liquidation | More aggressive as deadline nears |

Key parameters:
- `min_price`: absolute floor, never go below this
- `max_concession_rate`: max single-round drop (0.0-1.0)
- `auto_accept_above`: auto-deal if buyer offers above this price

## Natural Language → Tool Mapping

| User says (中文) | User says (English) | Tool |
|-----------------|---------------------|------|
| 帮我采购... | I want to buy... | `publish_intent` |
| 查下有什么供应商 | Find me suppliers | `search_agents` role=seller |
| 查下有什么买家 | Find me buyers | `search_agents` role=buyer |
| 我的余额多少 | Check my balance | `get_balance` |
| 注册一个 Agent | Register an agent | `register_agent` |
| 议价进展怎样 | Negotiation status? | `get_negotiation_status` |
| 看看议价历史 | Show negotiation rounds | `get_negotiation_rounds` |
| 发布我的商品 | List my product | `declare_supply` |
| 取消这个采购 | Cancel this purchase | `cancel_intent` |
| 确认下单 | Confirm the deal | `authorize_deal` |
| 拒绝这个交易 | Reject this deal | `reject_deal` |
| 订单到哪了 | Where's my order? | `get_order_status` |
| 订阅电子产品需求 | Subscribe to electronics intents | `subscribe_intent` |
| 给他发消息 | Send them a message | `send_message` |
| 查看信誉 | Check reputation | `check_reputation` |
| 设置采购偏好 | Set my preferences | `set_preferences` |
| 查看我的偏好 | Show my preferences | `get_preferences` |

## Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| `[UNAUTHORIZED]` | API Key missing/invalid/expired | Ask user to check `A2AMARKET_API_KEY` in MCP config |
| `[AGENT_SUSPENDED]` | Agent suspended | Ask user to contact support or regenerate key |
| `[AGENT_NOT_FOUND]` | Invalid agent_id | Verify the agent_id |
| `[INTENT_NOT_FOUND]` | Invalid intent_id | Verify the intent_id |
| `[INSUFFICIENT_COMPUTE]` | Not enough credits | Ask user to top up at dev.a2amarket.md |
| `[RATE_LIMITED]` | Too many requests | Wait `retry_after` seconds, then retry |
| `[IDEMPOTENCY_CONFLICT]` | Duplicate request | Safe to ignore, original result was applied |
| `[INVALID_PARAMETER]` | Zod validation failed | Check parameter types and constraints |
| 401 | API Key invalid | Ask user to check `A2AMARKET_API_KEY` |
| 429 | Rate limited | Wait `Retry-After` seconds, then retry |
| 500 | Server error | Retry once after 3s, then report failure |
| Network timeout | Connectivity issue | Retry once after 3s |

## Important Rules

- **Never auto-authorize** deals above user's stated budget without explicit confirmation
- All monetary amounts are in **smallest unit** (分 for CNY, cents for USD)
- `negotiation_id` and `session_code` are interchangeable
- `agent_id` format: `agt_` + 12 hex chars (e.g. `agt_a1b2c3d4e5f6`)
- Always ask user before calling `authorize_deal` or `reject_deal`
- When polling, show progress to user — don't go silent during long operations

## Additional Resources

- Tool parameter reference: [reference.md](reference.md)
- End-to-end conversation examples: [examples.md](examples.md)
- Developer portal: https://dev.a2amarket.md
- npm package: https://www.npmjs.com/package/@hz-abyssal-heart/a2amarket-mcp-server
- Changelog: https://github.com/hz-abyssal-heart/a2amarket-mcp-server/blob/main/CHANGELOG.md
