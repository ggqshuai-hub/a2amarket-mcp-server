#!/usr/bin/env node

/**
 * A2A Market MCP Server
 *
 * 将 A2A Market 平台能力暴露为 47 个 MCP Tools，
 * 让 Claude/Cursor 等 AI 工具直接操作 A2A Market。
 *
 * 使用方式:
 *   A2AMARKET_API_KEY=ak_xxx npx @hz-abyssal-heart/a2amarket-mcp-server
 *   A2AMARKET_API_KEY=ak_xxx npx @hz-abyssal-heart/a2amarket-mcp-server --sse --port 3100
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AcapClient } from './acap-client.js';
import { formatError, setLocale } from './errors.js';
import { enableDebug, logDebug, logInfo, logError } from './logger.js';
import * as S from './schemas.js';

// ── 版本号（从 package.json 读取，单一来源） ──

const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION: string = PKG.version;
const PKG_NAME: string = PKG.name;

// ── CLI 参数解析 ──

const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-v')) {
  console.log(`${PKG_NAME}@${VERSION}`);
  process.exit(0);
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
A2A Market MCP Server
  ${PKG_NAME}@${VERSION} — 将 A2A Market 平台能力以 MCP Tools 形式暴露给
  Claude / Cursor / OpenClaw 等 AI 工具。

用法
  npx @hz-abyssal-heart/a2amarket-mcp-server [options]

环境变量
  A2AMARKET_API_KEY       必填。Agent API Key（格式 ak_xxx）。
  A2AMARKET_BASE_URL      可选。平台地址（默认 https://api.a2amarket.md）。
  A2AMARKET_HMAC_SECRET   可选。HMAC 签名密钥。
  A2AMARKET_AGENT_ID      可选。当前 Agent ID。
  A2AMARKET_LOCALE        可选。错误信息语言 zh|en（默认 zh）。
  A2AMARKET_FEATURES      可选。启用的工具组，逗号分隔；all 表示全部。
                          默认不含: negotiation, settlement, seller_respond

选项
  --sse            启用 SSE 传输模式（默认 Stdio）
  --port <n>       SSE 端口（默认 3100）
  --debug          输出调试日志到 stderr
  --check          预检查：验证 API Key 和网络连通性
  --locale <zh|en> 错误信息语言
  -v, --version    显示版本号
  -h, --help       显示帮助

示例
  # Stdio 模式（本地使用）
  A2AMARKET_API_KEY=ak_xxx npx @hz-abyssal-heart/a2amarket-mcp-server

  # SSE 模式（远程使用）
  A2AMARKET_API_KEY=ak_xxx npx @hz-abyssal-heart/a2amarket-mcp-server --sse --port 3100

  # 预检查连通性
  A2AMARKET_API_KEY=ak_xxx npx @hz-abyssal-heart/a2amarket-mcp-server --check
`);
  process.exit(0);
}

// ── 配置 ──

const DEBUG = argv.includes('--debug');
enableDebug(DEBUG);

const localeArg = argv.includes('--locale') ? argv[argv.indexOf('--locale') + 1] : undefined;
setLocale(localeArg || process.env.A2AMARKET_LOCALE || 'zh');

const BASE_URL = process.env.A2AMARKET_BASE_URL || 'https://agent.a2amarket.md';
const API_KEY = process.env.A2AMARKET_API_KEY || '';
const HMAC_SECRET = process.env.A2AMARKET_HMAC_SECRET;
const AGENT_ID = process.env.A2AMARKET_AGENT_ID;

if (!API_KEY) {
  logError('init', 'A2AMARKET_API_KEY environment variable is required');
  process.exit(1);
}

const client = new AcapClient({
  baseUrl: BASE_URL, apiKey: API_KEY, hmacSecret: HMAC_SECRET, agentId: AGENT_ID,
});

const server = new Server(
  { name: 'a2amarket', version: VERSION },
  { capabilities: { tools: {} } }
);

// ── 特性开关 ──
// 通过 A2AMARKET_FEATURES 环境变量控制哪些工具组对外可见。
// 值为逗号分隔的 group 名称，"all" 表示全部开放。
// 默认不含 negotiation / settlement / seller_respond，这些功能暂不对外开放。

const FEATURE_GROUPS: Record<string, string[]> = {
  identity: [
    'register_agent', 'get_profile', 'update_profile', 'search_agents',
    'verify_email', 'check_handle', 'get_my_agents', 'list_api_keys',
    'get_usage', 'rotate_api_key',
  ],
  intent: [
    'publish_intent', 'get_intent_status', 'cancel_intent',
    'get_sourcing_status', 'list_matches', 'list_responses',
  ],
  negotiation: [
    'select_and_negotiate', 'get_negotiation_status', 'get_negotiation_rounds',
    'submit_offer', 'accept_deal', 'reject_deal',
  ],
  settlement: [
    'create_settlement', 'authorize_deal', 'get_order_status',
  ],
  preferences: [
    'set_preferences', 'get_preferences',
  ],
  supply: [
    'declare_supply', 'update_supply', 'list_supply_products',
    'get_supply_product', 'delete_supply_product',
  ],
  seller_respond: [
    'respond_to_intent',
  ],
  subscription: [
    'subscribe_intent', 'unsubscribe_intent', 'list_subscriptions',
    'get_incoming_intents',
  ],
  hosted_strategy: [
    'set_hosted_strategy', 'list_hosted_strategies', 'delete_hosted_strategy',
  ],
  reputation: [
    'get_reputation', 'check_reputation',
  ],
  compute: [
    'get_balance',
  ],
  messaging: [
    'send_message', 'get_messages', 'list_conversations', 'get_conversation',
  ],
};

const DEFAULT_FEATURES = 'identity,intent,preferences,supply,subscription,hosted_strategy,reputation,compute,messaging';

const featuresRaw = process.env.A2AMARKET_FEATURES || DEFAULT_FEATURES;
const enabledGroups = new Set(
  featuresRaw === 'all' ? Object.keys(FEATURE_GROUPS) : featuresRaw.split(',').map(s => s.trim()),
);

const enabledTools = new Set(
  [...enabledGroups].flatMap(g => FEATURE_GROUPS[g] || []),
);

logDebug('init', `baseUrl=${BASE_URL}, agentId=${AGENT_ID || '(not set)'}, hmac=${HMAC_SECRET ? 'yes' : 'no'}`);
logDebug('init', `features=${[...enabledGroups].join(',')}, tools=${enabledTools.size}/${Object.values(FEATURE_GROUPS).flat().length}`);

// ── Tool 定义（47 个，按特性开关过滤） ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ([
    // ═══ 通用 — Agent 身份管理 ═══
    {
      name: 'register_agent',
      description: '注册新 Agent。注册后会收到验证邮件，用 verify_email 完成激活。返回 agent_id。handle 格式：小写字母+数字+连字符，3-30 字符。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          handle: { type: 'string', description: 'Agent 唯一标识（英文+数字+连字符）' },
          agent_name: { type: 'string', description: 'Agent 显示名称' },
          agent_type: { type: 'string', enum: ['BUYER', 'SELLER'], description: '角色类型' },
          contact_email: { type: 'string', description: '联系邮箱（用于验证）' },
          endpoint_url: { type: 'string', description: 'Webhook 回调地址（可选）' },
        },
        required: ['handle', 'agent_name', 'agent_type', 'contact_email'],
      },
    },
    {
      name: 'get_profile',
      description: '查询 Agent 公开资料。返回 agent_name、handle、agent_type、capabilities、endpoint_url 等。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'update_profile',
      description: '更新 Agent 资料。只传需要改的字段。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
          agent_name: { type: 'string', description: '新名称' },
          endpoint_url: { type: 'string', description: '新 Webhook 地址' },
          capabilities: { type: 'string', description: '能力清单 JSON' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'search_agents',
      description: '搜索平台上的 Agent。返回匹配的 Agent 列表（含 agent_id、handle、name、type）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          role: { type: 'string', enum: ['buyer', 'seller'], description: '角色过滤' },
        },
      },
    },
    {
      name: 'verify_email',
      description: '验证注册邮箱，完成 Agent 激活。需要 register_agent 返回的 agent_id 和邮件中的 verification_token。验证通过后返回 API Key。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: '注册时返回的 Agent ID' },
          verification_token: { type: 'string', description: '邮件中的验证 token' },
        },
        required: ['agent_id', 'verification_token'],
      },
    },
    {
      name: 'check_handle',
      description: '检查 handle 是否可用。返回 available: true/false。建议在 register_agent 前调用。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          handle: { type: 'string', description: '要检查的 handle' },
        },
        required: ['handle'],
      },
    },
    {
      name: 'get_my_agents',
      description: '列出当前 API Key 关联的所有 Agent。返回 Agent 列表（含 agent_id、handle、name、type、status）。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'list_api_keys',
      description: '查看指定 Agent 的 API Key 列表。返回 key 前缀和创建时间（不返回完整 key）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'get_usage',
      description: '查看 Agent 的用量统计。返回 API 调用次数、算力消耗等。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'rotate_api_key',
      description: '轮换 API Key。旧 Key 立即失效，返回新 Key。请妥善保存新 Key。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
        },
        required: ['agent_id'],
      },
    },

    // ═══ 买家 — 意图生命周期 ═══
    {
      name: 'publish_intent',
      description: '发布采购意图。用自然语言描述你要买什么，平台自动寻源匹配。返回 intent_id。发布后用 get_intent_status 轮询进度（每 5 秒），状态变为 MATCHED 后用 list_matches 查看匹配结果。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: '采购需求描述，如"100箱新西兰蜂蜜，预算3万"' },
          budget: { type: 'number', description: '预算上限（单位：分，如 3000000 = 3万元）' },
          currency: { type: 'string', description: '货币代码，默认 CNY' },
        },
        required: ['text'],
      },
    },
    {
      name: 'get_intent_status',
      description: '查询意图状态。返回 status（PENDING/SOURCING/MATCHED/EXPIRED/CANCELLED）和 match_count。状态为 MATCHED 时用 list_matches 查看结果。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID（publish_intent 返回）' },
        },
        required: ['intent_id'],
      },
    },
    {
      name: 'cancel_intent',
      description: '取消采购意图。只能取消 PENDING 或 SOURCING 状态的意图。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
        },
        required: ['intent_id'],
      },
    },
    {
      name: 'get_sourcing_status',
      description: '查询寻源进度详情。返回各层级（L1 内部/L2 平台供给/L3 外部）的匹配状态和满足度评分。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
        },
        required: ['intent_id'],
      },
    },
    {
      name: 'list_matches',
      description: '查看意图匹配到的商品和商家。返回列表含 match_id、商家名称、价格、匹配度评分。选中商家后用 select_and_negotiate 开始议价。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
        },
        required: ['intent_id'],
      },
    },
    {
      name: 'list_responses',
      description: '查看卖家主动报价。返回列表含报价金额、数量、交期、卖家信息。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
        },
        required: ['intent_id'],
      },
    },

    // ═══ 买家 — 议价与结算（平台托管模式） ═══
    {
      name: 'select_and_negotiate',
      description: '选择商家开始议价。平台 Agent 自动执行多轮议价。返回 negotiation_id。用 get_negotiation_status 轮询进度，DEAL_REACHED 后用 authorize_deal 确认或 reject_deal 拒绝。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          match_id: { type: 'number', description: '匹配结果 ID（list_matches 返回）' },
          max_price: { type: 'number', description: '你能接受的最高价格（单位：分）' },
          quantity: { type: 'number', description: '采购数量' },
        },
        required: ['match_id'],
      },
    },
    {
      name: 'get_negotiation_status',
      description: '查询议价进度。返回 status（IN_PROGRESS/DEAL_REACHED/FAILED/REJECTED）、当前轮次、双方最新报价、agent_thought（AI 决策思路）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID（select_and_negotiate 返回）' },
        },
        required: ['negotiation_id'],
      },
    },
    {
      name: 'get_negotiation_rounds',
      description: '查询议价全部轮次历史。每轮含买方报价、卖方报价、让步幅度、agent_thought。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
        },
        required: ['negotiation_id'],
      },
    },
    {
      name: 'authorize_deal',
      description: '授权交易。议价达成（DEAL_REACHED）后调用，确认同意并进入结算。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
        },
        required: ['negotiation_id'],
      },
    },
    {
      name: 'reject_deal',
      description: '拒绝交易。对议价结果不满意时调用，终止该交易。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
        },
        required: ['negotiation_id'],
      },
    },
    {
      name: 'get_order_status',
      description: '查询结算/订单状态。返回 status（CREATED/PAID/SHIPPED/COMPLETED）和订单详情。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: '结算会话 ID（authorize_deal 返回）' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'submit_offer',
      description: '手动议价模式：提交还价。用于需要人工介入的议价场景。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
          price: { type: 'number', description: '报价金额（单位：分）' },
          message: { type: 'string', description: '附言（可选）' },
        },
        required: ['negotiation_id', 'price'],
      },
    },
    {
      name: 'accept_deal',
      description: '接受当前报价，结束议价进入结算。与 authorize_deal 不同：accept_deal 是在议价过程中主动接受，authorize_deal 是平台议价达成后的确认。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
        },
        required: ['negotiation_id'],
      },
    },
    {
      name: 'create_settlement',
      description: '创建结算单。议价达成并授权后调用。返回 settlement_id 和支付信息。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
        },
        required: ['negotiation_id'],
      },
    },

    // ═══ 买家 — 偏好设置 ═══
    {
      name: 'set_preferences',
      description: '设置采购偏好。影响寻源排序和托管议价行为。negotiation_aggression: 0.0(保守)~1.0(激进)。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
          preferred_categories: { type: 'array', items: { type: 'string' }, description: '偏好品类' },
          preferred_regions: { type: 'array', items: { type: 'string' }, description: '偏好地区' },
          default_budget_max: { type: 'number', description: '默认预算上限' },
          quality_level: { type: 'string', enum: ['economy', 'standard', 'premium'], description: '质量偏好' },
          negotiation_aggression: { type: 'number', description: '议价激进度 0.0~1.0' },
          max_delivery_days: { type: 'number', description: '最大可接受交期（天）' },
          auto_authorize: { type: 'boolean', description: '是否自动授权低于阈值的交易' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'get_preferences',
      description: '查询当前采购偏好设置。返回品类、预算、地区、质量等级、议价策略等。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
        },
        required: ['agent_id'],
      },
    },

    // ═══ 卖家 — 供给管理 ═══
    {
      name: 'declare_supply',
      description: '发布供给商品。买家寻源时会自动匹配你的商品。返回 product_id。title 和 price 必填，其余可选。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: '商品标题' },
          description: { type: 'string', description: '商品描述' },
          category_l1: { type: 'string', description: '一级品类' },
          category_l2: { type: 'string', description: '二级品类' },
          price: { type: 'number', description: '单价（单位：分）' },
          price_currency: { type: 'string', description: '币种，默认 CNY' },
          moq: { type: 'number', description: '最小起订量' },
          stock_quantity: { type: 'number', description: '库存数量' },
          delivery_days: { type: 'number', description: '交期（天）' },
          service_regions: { type: 'string', description: '服务区域' },
          image_url: { type: 'string', description: '商品图片 URL' },
          keywords: { type: 'string', description: '搜索关键词' },
          contact_name: { type: 'string', description: '联系人' },
          contact_phone: { type: 'string', description: '联系电话' },
        },
        required: ['title', 'price'],
      },
    },
    {
      name: 'update_supply',
      description: '更新供给商品信息。只传需要改的字段。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          declaration_id: { type: 'number', description: '商品 ID（declare_supply 返回）' },
          title: { type: 'string', description: '新标题' },
          description: { type: 'string', description: '新描述' },
          category_l1: { type: 'string', description: '一级品类' },
          category_l2: { type: 'string', description: '二级品类' },
          price: { type: 'number', description: '新单价（分）' },
          price_currency: { type: 'string', description: '币种' },
          moq: { type: 'number', description: '最小起订量' },
          stock_quantity: { type: 'number', description: '库存数量' },
          delivery_days: { type: 'number', description: '交期（天）' },
          service_regions: { type: 'string', description: '服务区域' },
          keywords: { type: 'string', description: '搜索关键词' },
        },
        required: ['declaration_id'],
      },
    },
    {
      name: 'list_supply_products',
      description: '列出我发布的所有供给商品。返回商品列表含 product_id、标题、价格、状态。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_supply_product',
      description: '查看供给商品详情。返回完整商品信息。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          product_id: { type: 'number', description: '商品 ID' },
        },
        required: ['product_id'],
      },
    },
    {
      name: 'delete_supply_product',
      description: '删除供给商品。删除后不再参与寻源匹配。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          product_id: { type: 'number', description: '商品 ID' },
        },
        required: ['product_id'],
      },
    },
    {
      name: 'respond_to_intent',
      description: '对买家意图主动报价。买家可在 list_responses 中看到你的报价。intent_id 和 price 必填。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
          price: { type: 'number', description: '报价金额（分）' },
          quantity: { type: 'number', description: '可供数量' },
          delivery_days: { type: 'number', description: '交货天数' },
          message: { type: 'string', description: '报价附言' },
        },
        required: ['intent_id', 'price'],
      },
    },

    // ═══ 卖家 — 意图订阅 ═══
    {
      name: 'subscribe_intent',
      description: '订阅特定品类的买家意图。有匹配意图时收到通知。用 get_incoming_intents 查看匹配到的意图，用 respond_to_intent 报价。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          category_l1: { type: 'string', description: '一级品类（必填）' },
          category_l2: { type: 'string', description: '二级品类' },
          min_budget: { type: 'number', description: '最低预算过滤' },
          max_budget: { type: 'number', description: '最高预算过滤' },
          regions: { type: 'string', description: '地区过滤' },
        },
        required: ['category_l1'],
      },
    },
    {
      name: 'unsubscribe_intent',
      description: '取消意图订阅。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          subscription_id: { type: 'number', description: '订阅 ID（subscribe_intent 返回）' },
        },
        required: ['subscription_id'],
      },
    },
    {
      name: 'list_subscriptions',
      description: '列出我的所有活跃订阅。返回订阅列表含 subscription_id、品类、过滤条件。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_incoming_intents',
      description: '查看与我的供给匹配的买家意图。可用 respond_to_intent 对感兴趣的意图报价。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          page: { type: 'number', description: '页码（默认 1）' },
          page_size: { type: 'number', description: '每页条数（默认 20，最大 50）' },
        },
      },
    },

    // ═══ 卖家 — 托管议价策略 ═══
    {
      name: 'set_hosted_strategy',
      description: '设置托管自动响应策略。有匹配意图时平台按此策略自动报价。auto_price: 固定报价（分）; auto_price_ratio: 按买家预算百分比（如 0.85 = 85%）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          strategy_name: { type: 'string', description: '策略名称' },
          category_l1: { type: 'string', description: '匹配品类（一级，必填）' },
          category_l2: { type: 'string', description: '匹配品类（二级）' },
          min_budget: { type: 'number', description: '最低预算过滤' },
          max_budget: { type: 'number', description: '最高预算过滤' },
          auto_price: { type: 'number', description: '固定报价（分）' },
          auto_price_ratio: { type: 'number', description: '按预算比例报价（0.0~1.0）' },
          auto_quantity: { type: 'number', description: '可供数量' },
          auto_delivery_days: { type: 'number', description: '交货天数' },
          auto_message: { type: 'string', description: '自动附言模板' },
          auto_respond: { type: 'boolean', description: '是否自动响应（默认 true）' },
        },
        required: ['category_l1'],
      },
    },
    {
      name: 'list_hosted_strategies',
      description: '列出已设置的托管策略。返回策略列表含 strategy_id、品类、报价规则。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'delete_hosted_strategy',
      description: '删除托管策略。删除后不再自动响应该品类的意图。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          strategy_id: { type: 'number', description: '策略 ID' },
        },
        required: ['strategy_id'],
      },
    },

    // ═══ 信誉 ═══
    {
      name: 'get_reputation',
      description: '查看自己的信誉评分。返回 total_score、level（BRONZE/SILVER/GOLD/PLATINUM）、正面/负面事件数。无需参数。',
      inputSchema: { type: 'object' as const, properties: {} },
    },

    // ═══ 通用 — 信誉 / 算力 / 消息 ═══
    {
      name: 'check_reputation',
      description: '查询其他 Agent 的信誉评分。用于交易前评估对方可信度。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: '要查询的 Agent ID' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'get_balance',
      description: '查询算力点数余额。返回 balance（可用）、frozen（冻结中）、currency。无需参数。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'send_message',
      description: '向其他 Agent 发送消息。receiver_agent_id 和 content 必填。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          receiver_agent_id: { type: 'string', description: '接收方 Agent ID' },
          content: { type: 'string', description: '消息内容' },
          message_type: { type: 'string', description: '消息类型（默认 text）' },
        },
        required: ['receiver_agent_id', 'content'],
      },
    },
    {
      name: 'get_messages',
      description: '查看收到的消息。返回消息列表含发送者、内容、时间。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          status: { type: 'string', description: '状态过滤（可选）' },
        },
      },
    },
    {
      name: 'list_conversations',
      description: '列出消息会话。返回会话列表含对方 Agent 信息和最后消息。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_conversation',
      description: '查看指定会话的消息详情。返回完整消息历史。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          conversation_id: { type: 'string', description: '会话 ID' },
        },
        required: ['conversation_id'],
      },
    },
  ] as Array<{ name: string; description: string; inputSchema: any }>).filter(t => enabledTools.has(t.name)),
}));

// ── Tool 处理（Zod 校验 + 结构化错误） ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  logDebug('tool', `call: ${name}`, args);

  if (!enabledTools.has(name)) {
    const hint = name === 'Unknown' ? '' : ' 如需开放，请设置环境变量 A2AMARKET_FEATURES=all';
    return { content: [{ type: 'text', text: `该功能（${name}）当前版本暂未开放。${hint}` }], isError: true };
  }

  try {
    let result: any;

    switch (name) {
      // ── 通用 — Agent 身份管理 ──
      case 'register_agent': {
        const p = S.RegisterAgentSchema.parse(args);
        result = await client.registerAgent({
          handle: p.handle, agentName: p.agent_name, agentType: p.agent_type,
          contactEmail: p.contact_email, endpointUrl: p.endpoint_url,
        });
        break;
      }
      case 'get_profile': {
        const p = S.GetProfileSchema.parse(args);
        result = await client.getProfile(p.agent_id);
        break;
      }
      case 'update_profile': {
        const p = S.UpdateProfileSchema.parse(args);
        result = await client.updateProfile(p.agent_id, {
          agentName: p.agent_name, endpointUrl: p.endpoint_url, capabilities: p.capabilities,
        });
        break;
      }
      case 'search_agents': {
        const p = S.SearchAgentsSchema.parse(args);
        result = await client.searchAgents(p.query, p.role);
        break;
      }
      case 'verify_email': {
        const { agent_id, verification_token } = args as { agent_id: string; verification_token: string };
        result = await client.verifyEmail(agent_id, verification_token);
        break;
      }
      case 'check_handle': {
        const { handle } = args as { handle: string };
        result = await client.checkHandle(handle);
        break;
      }
      case 'get_my_agents': {
        result = await client.getMyAgents();
        break;
      }
      case 'list_api_keys': {
        const { agent_id } = args as { agent_id: string };
        result = await client.listApiKeys(agent_id);
        break;
      }
      case 'get_usage': {
        const { agent_id } = args as { agent_id: string };
        result = await client.getUsage(agent_id);
        break;
      }
      case 'rotate_api_key': {
        const { agent_id } = args as { agent_id: string };
        result = await client.rotateApiKey(agent_id);
        break;
      }

      // ── 买家 — 意图生命周期 ──
      case 'publish_intent': {
        const p = S.PublishIntentSchema.parse(args);
        result = await client.publishIntent(p.text, p.budget, p.currency);
        break;
      }
      case 'get_intent_status': {
        const p = S.IntentIdSchema.parse(args);
        result = await client.getIntent(p.intent_id);
        break;
      }
      case 'cancel_intent': {
        const p = S.IntentIdSchema.parse(args);
        result = await client.cancelIntent(p.intent_id);
        break;
      }
      case 'get_sourcing_status': {
        const p = S.IntentIdSchema.parse(args);
        result = await client.getSourcingStatus(p.intent_id);
        break;
      }
      case 'list_matches': {
        const p = S.IntentIdSchema.parse(args);
        result = await client.listMatches(p.intent_id);
        break;
      }
      case 'list_responses': {
        const p = S.IntentIdSchema.parse(args);
        result = await client.listResponses(p.intent_id);
        break;
      }

      // ── 买家 — 议价与结算 ──
      case 'select_and_negotiate': {
        const p = S.SelectAndNegotiateSchema.parse(args);
        result = await client.selectAndNegotiate(p.match_id, {
          max_price: p.max_price, quantity: p.quantity,
        });
        break;
      }
      case 'get_negotiation_status': {
        const p = S.NegotiationIdSchema.parse(args);
        result = await client.getNegotiationStatus(p.negotiation_id);
        break;
      }
      case 'get_negotiation_rounds': {
        const p = S.NegotiationIdSchema.parse(args);
        result = await client.getNegotiationRounds(p.negotiation_id);
        break;
      }
      case 'authorize_deal': {
        const p = S.NegotiationIdSchema.parse(args);
        result = await client.authorizeDeal(p.negotiation_id);
        break;
      }
      case 'reject_deal': {
        const p = S.NegotiationIdSchema.parse(args);
        result = await client.rejectDeal(p.negotiation_id);
        break;
      }
      case 'get_order_status': {
        const p = S.SessionIdSchema.parse(args);
        result = await client.getOrderStatus(p.session_id);
        break;
      }
      case 'submit_offer': {
        const { negotiation_id, price, message } = args as { negotiation_id: string; price: number; message?: string };
        result = await client.submitOffer(negotiation_id, price, message);
        break;
      }
      case 'accept_deal': {
        const { negotiation_id } = args as { negotiation_id: string };
        result = await client.acceptDeal(negotiation_id);
        break;
      }
      case 'create_settlement': {
        const { negotiation_id } = args as { negotiation_id: string };
        result = await client.createSettlement(negotiation_id);
        break;
      }

      // ── 买家 — 偏好 ──
      case 'set_preferences': {
        const p = S.SetPreferencesSchema.parse(args);
        const { agent_id, ...prefData } = p;
        result = await client.setPreferences(agent_id, prefData);
        break;
      }
      case 'get_preferences': {
        const p = S.GetProfileSchema.parse(args);
        result = await client.getPreferences(p.agent_id);
        break;
      }

      // ── 卖家 — 供给声明 ──
      case 'declare_supply': {
        const p = S.DeclareSupplySchema.parse(args);
        result = await client.declareSupply(p);
        break;
      }
      case 'update_supply': {
        const p = S.UpdateSupplySchema.parse(args);
        const { declaration_id, ...updateData } = p;
        result = await client.updateSupply(declaration_id, updateData);
        break;
      }
      case 'list_supply_products': {
        result = await client.listSupplyProducts();
        break;
      }
      case 'get_supply_product': {
        const { product_id } = args as { product_id: number };
        result = await client.getSupplyProduct(product_id);
        break;
      }
      case 'delete_supply_product': {
        const { product_id } = args as { product_id: number };
        result = await client.deleteSupplyProduct(product_id);
        break;
      }
      case 'respond_to_intent': {
        const { intent_id, message, ...rest } = args as { intent_id: number; price: number; quantity?: number; delivery_days?: number; message?: string };
        result = await client.respondToIntent(intent_id, { ...rest, agent_message: message });
        break;
      }

      // ── 卖家 — 意图订阅 ──
      case 'subscribe_intent': {
        const p = S.SubscribeIntentSchema.parse(args);
        result = await client.subscribeIntent(p);
        break;
      }
      case 'unsubscribe_intent': {
        const p = S.UnsubscribeSchema.parse(args);
        result = await client.unsubscribeIntent(p.subscription_id);
        break;
      }
      case 'list_subscriptions':
        result = await client.listSubscriptions();
        break;
      case 'get_incoming_intents': {
        const p = S.PaginationSchema.parse(args);
        result = await client.getIncomingIntents(p.page, p.page_size);
        break;
      }

      // ── 卖家 — 托管议价策略 ──
      case 'set_hosted_strategy': {
        const p = S.SetHostedStrategySchema.parse(args);
        result = await client.setHostedStrategy(p);
        break;
      }
      case 'list_hosted_strategies': {
        result = await client.listHostedStrategies();
        break;
      }
      case 'delete_hosted_strategy': {
        const { strategy_id } = args as { strategy_id: number };
        result = await client.deleteHostedStrategy(strategy_id);
        break;
      }

      // ── 卖家 — 信誉 ──
      case 'get_reputation':
        result = await client.getReputation();
        break;

      // ── 通用 — 信誉 / 算力 / 消息 ──
      case 'check_reputation': {
        const p = S.AgentIdSchema.parse(args);
        result = await client.checkReputation(p.agent_id);
        break;
      }
      case 'get_balance':
        result = await client.getBalance();
        break;
      case 'send_message': {
        const p = S.SendMessageSchema.parse(args);
        result = await client.sendMessage(p.receiver_agent_id, p.content, p.message_type);
        break;
      }
      case 'get_messages': {
        const p = S.GetMessagesSchema.parse(args);
        result = await client.getMessages(p.status);
        break;
      }
      case 'list_conversations': {
        result = await client.listConversations();
        break;
      }
      case 'get_conversation': {
        const { conversation_id } = args as { conversation_id: string };
        result = await client.getConversation(conversation_id);
        break;
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    logDebug('tool', `success: ${name}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    const msg = formatError(error);
    logError('tool', `${name} failed:`, msg);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
});

// ── 预检查模式 ──

if (argv.includes('--check')) {
  (async () => {
    const apiKey = process.env.A2AMARKET_API_KEY;
    const baseUrl = process.env.A2AMARKET_BASE_URL || 'https://api.a2amarket.md';

    console.log(`\n🔍 A2A Market MCP Server — 连通性预检查\n`);

    // 1. 检查 API Key
    if (!apiKey) {
      console.log('❌ A2AMARKET_API_KEY 未设置');
      console.log('   设置方式: export A2AMARKET_API_KEY=ak_your_key_here\n');
      process.exit(1);
    }
    console.log(`✅ API Key: ${apiKey.substring(0, 10)}...`);
    console.log(`✅ Base URL: ${baseUrl}`);

    // 2. 验证 Key 有效性（调 get_balance）
    try {
      const resp = await fetch(`${baseUrl}/acap/v1/compute/balance`, {
        headers: { 'X-Agent-Key': apiKey, 'Accept': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        const balance = data?.payload?.data?.balance ?? data?.balance ?? 'unknown';
        console.log(`✅ API Key 有效，算力余额: ${balance}`);
      } else if (resp.status === 401) {
        console.log('❌ API Key 无效（401 Unauthorized）');
        console.log('   请检查 Key 是否正确，或是否已过期\n');
        process.exit(1);
      } else {
        console.log(`⚠️  服务端返回 ${resp.status}: ${resp.statusText}`);
      }
    } catch (err: any) {
      console.log(`❌ 网络不通: ${err.message}`);
      console.log(`   请检查 ${baseUrl} 是否可达\n`);
      process.exit(1);
    }

    console.log(`\n✅ 预检查通过！MCP Server 可以正常使用。\n`);
    process.exit(0);
  })();
} else {

// ── 启动（Stdio / SSE 双模式） ──

async function main() {
  const useSSE = argv.includes('--sse');

  if (useSSE) {
    // SSE 传输模式
    const portArg = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : undefined;
    const port = parseInt(portArg || process.env.A2AMARKET_MCP_PORT || '3100', 10);

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // 健康检查
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: VERSION, tools: enabledTools.size }));
        return;
      }

      // CORS 预检
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Key',
        });
        res.end();
        return;
      }

      // SSE 端点
      if (req.url === '/sse' || req.url?.startsWith('/sse?')) {
        logDebug('sse', 'new SSE connection');
        res.setHeader('Access-Control-Allow-Origin', '*');
        const transport = new SSEServerTransport('/messages', res);
        await server.connect(transport);
        return;
      }

      // SSE 消息端点
      if (req.method === 'POST' && req.url === '/messages') {
        // SSEServerTransport 内部处理
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    httpServer.listen(port, () => {
      logInfo('init', `A2A Market MCP Server v${VERSION} running on SSE (port ${port}, ${enabledTools.size} tools)`);
      logInfo('init', `SSE endpoint: http://localhost:${port}/sse`);
      logInfo('init', `Health check: http://localhost:${port}/health`);
    });
  } else {
    // Stdio 传输模式（默认）
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logInfo('init', `A2A Market MCP Server v${VERSION} running on stdio (${enabledTools.size} tools)`);
  }
}

main().catch((err) => {
  logError('init', 'Fatal:', err);
  process.exit(1);
});

} // end of --check else block
