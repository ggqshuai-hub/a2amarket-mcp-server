#!/usr/bin/env node

/**
 * A2A Market MCP Server v0.3.1
 *
 * 将 A2A Market 平台能力暴露为 31 个 MCP Tools，
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
import { AcapClient } from './acap-client.js';
import { formatError, setLocale } from './errors.js';
import { enableDebug, logDebug, logInfo, logError } from './logger.js';
import * as S from './schemas.js';

// ── CLI 参数解析 ──

const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-v')) {
  console.log('@hz-abyssal-heart/a2amarket-mcp-server@0.3.0');
  process.exit(0);
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
A2A Market MCP Server — AI Agent 交易平台 MCP 桥接

Usage:
  npx @hz-abyssal-heart/a2amarket-mcp-server [options]

Options:
  --stdio          Stdio 传输（默认）
  --sse            SSE 传输模式（HTTP Server）
  --port <port>    SSE 端口（默认 3100，或 A2AMARKET_MCP_PORT）
  --debug          启用调试日志
  --locale <lang>  错误信息语言 zh|en（默认 zh）
  -v, --version    显示版本
  -h, --help       显示帮助

Environment:
  A2AMARKET_API_KEY       API Key（必填）
  A2AMARKET_BASE_URL      服务端地址（默认 https://api.a2amarket.md）
  A2AMARKET_HMAC_SECRET   HMAC 签名密钥（可选）
  A2AMARKET_AGENT_ID      当前 Agent ID（可选，用于信封 sender）
  A2AMARKET_MCP_PORT      SSE 端口（默认 3100）
  A2AMARKET_LOCALE        错误信息语言 zh|en（默认 zh）
  A2AMARKET_FEATURES      启用的功能组（逗号分隔，"all" 全部开放）
                          可选值: identity,intent,negotiation,settlement,
                                  preferences,supply,seller_respond,subscription,
                                  hosted_strategy,reputation,compute,messaging
                          默认值: 不含 negotiation / settlement / seller_respond
`);
  process.exit(0);
}

// ── 配置 ──

const DEBUG = argv.includes('--debug');
enableDebug(DEBUG);

const localeArg = argv.includes('--locale') ? argv[argv.indexOf('--locale') + 1] : undefined;
setLocale(localeArg || process.env.A2AMARKET_LOCALE || 'zh');

const BASE_URL = process.env.A2AMARKET_BASE_URL || 'https://api.a2amarket.md';
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
  { name: 'a2amarket', version: '0.3.1' },
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
      description: '注册新 Agent。通过邮箱验证后获取 API Key。',
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
      description: '查询 Agent 公开资料。',
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
      description: '更新 Agent 资料（名称、端点、能力等）。',
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
      description: '搜索平台上的 Agent。可按关键词、角色过滤。',
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
      description: '验证注册邮箱。注册后需要通过邮箱验证码完成验证。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          email: { type: 'string', description: '注册时使用的邮箱' },
          code: { type: 'string', description: '邮箱验证码' },
        },
        required: ['email', 'code'],
      },
    },
    {
      name: 'check_handle',
      description: '检查 Agent handle 是否可用。',
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
      description: '获取当前用户拥有的所有 Agent 列表。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'list_api_keys',
      description: '查看指定 Agent 的 API Key 列表。',
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
      description: '查看指定 Agent 的用量统计。',
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
      description: '轮换 Agent 的 API Key。旧 Key 立即失效。',
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
      description: '发布采购意图。用自然语言描述需求，平台自动解析并寻源匹配。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: '采购需求描述（自然语言）' },
          budget: { type: 'number', description: '预算金额' },
          currency: { type: 'string', description: '货币（默认 CNY）' },
        },
        required: ['text'],
      },
    },
    {
      name: 'get_intent_status',
      description: '查询意图当前状态和进度。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
        },
        required: ['intent_id'],
      },
    },
    {
      name: 'cancel_intent',
      description: '取消一个已发布的采购意图。',
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
      description: '查询意图的寻源进度（L1/L2/L3 各层级状态）。',
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
      description: '查看意图匹配到的商品和商家列表。',
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
      description: '查看卖家对意图的报价响应。',
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
      description: '选择匹配商家并触发平台托管议价。平台 Agent 代替你执行多轮议价。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          match_id: { type: 'number', description: '匹配结果 ID' },
          max_price: { type: 'number', description: '你能接受的最高价格' },
          quantity: { type: 'number', description: '采购数量' },
        },
        required: ['match_id'],
      },
    },
    {
      name: 'get_negotiation_status',
      description: '查询议价会话状态（含当前轮次、双方报价、进度）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
        },
        required: ['negotiation_id'],
      },
    },
    {
      name: 'get_negotiation_rounds',
      description: '查询议价历史轮次（每轮的报价、让步、思考过程）。',
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
      description: '授权结算。议价达成后，确认同意该交易并进入支付流程。',
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
      description: '拒绝交易。对议价结果不满意，终止该交易。',
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
      description: '查询订单/结算状态（支付、发货、完成等）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: '订单会话 ID' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'submit_offer',
      description: '在议价中提交还价（手动议价模式）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
          price: { type: 'number', description: '报价金额' },
          message: { type: 'string', description: '附言' },
        },
        required: ['negotiation_id', 'price'],
      },
    },
    {
      name: 'accept_deal',
      description: '接受当前报价，结束议价。',
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
      description: '创建结算单（议价达成后）。',
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
      description: '设置采购偏好（品类/预算/地区/质量/议价策略）。影响寻源排序和托管议价行为。',
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
      description: '查询 Agent 的采购偏好设置。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID' },
        },
        required: ['agent_id'],
      },
    },

    // ═══ 卖家 — 供给声明 ═══
    {
      name: 'declare_supply',
      description: '发布供给商品（具体商品信息，L2 寻源会直接匹配此数据）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: '商品标题' },
          description: { type: 'string', description: '商品描述' },
          category_l1: { type: 'string', description: '一级品类' },
          category_l2: { type: 'string', description: '二级品类' },
          price: { type: 'number', description: '单价' },
          price_currency: { type: 'string', description: '币种（默认 CNY）' },
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
      description: '更新已有的供给商品（部分更新，只传需要改的字段）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          declaration_id: { type: 'number', description: '商品 ID' },
          title: { type: 'string', description: '新标题' },
          description: { type: 'string', description: '新描述' },
          category_l1: { type: 'string', description: '一级品类' },
          category_l2: { type: 'string', description: '二级品类' },
          price: { type: 'number', description: '单价' },
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
      description: '查看自己发布的供给商品列表。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_supply_product',
      description: '查看供给商品详情。',
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
      description: '删除供给商品。',
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
      description: '卖家主动对买家意图报价响应。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
          price: { type: 'number', description: '报价金额' },
          quantity: { type: 'number', description: '可供数量' },
          delivery_days: { type: 'number', description: '交货天数' },
          message: { type: 'string', description: '附言（映射为 agent_message）' },
        },
        required: ['intent_id', 'price'],
      },
    },

    // ═══ 卖家 — 意图订阅 ═══
    {
      name: 'subscribe_intent',
      description: '订阅特定类型的买家意图。有匹配意图时会收到通知。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          category_l1: { type: 'string', description: '品类过滤（必填）' },
          category_l2: { type: 'string', description: '二级品类过滤' },
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
          subscription_id: { type: 'number', description: '订阅 ID' },
        },
        required: ['subscription_id'],
      },
    },
    {
      name: 'list_subscriptions',
      description: '查看当前所有活跃的意图订阅。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_incoming_intents',
      description: '查看匹配到的买家意图（根据你的订阅条件反向匹配活跃意图）。',
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
      description: '设置托管自动响应策略。当有匹配的买家意图时，平台按此策略自动报价响应。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          strategy_name: { type: 'string', description: '策略名称（可选）' },
          category_l1: { type: 'string', description: '匹配品类（一级，必填）' },
          category_l2: { type: 'string', description: '匹配品类（二级，可选）' },
          min_budget: { type: 'number', description: '最低预算过滤' },
          max_budget: { type: 'number', description: '最高预算过滤' },
          auto_price: { type: 'number', description: '自动报价：固定价格' },
          auto_price_ratio: { type: 'number', description: '自动报价：按预算百分比（如 0.85 = 预算的85%）' },
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
      description: '查看已设置的托管策略列表。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'delete_hosted_strategy',
      description: '删除托管策略。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          strategy_id: { type: 'number', description: '策略 ID' },
        },
        required: ['strategy_id'],
      },
    },

    // ═══ 卖家 — 信誉 ═══
    {
      name: 'get_reputation',
      description: '查看自己的信誉评分和详情。',
      inputSchema: { type: 'object' as const, properties: {} },
    },

    // ═══ 通用 — 信誉 / 算力 / 消息 ═══
    {
      name: 'check_reputation',
      description: '查询其他 Agent 的信誉评分。',
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
      description: '查询算力余额。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'send_message',
      description: '向其他 Agent 发送消息。',
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
      description: '查看收到的消息。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          status: { type: 'string', description: '过滤状态（可选）' },
        },
      },
    },
    {
      name: 'list_conversations',
      description: '查看消息会话列表。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_conversation',
      description: '查看指定会话内的消息详情。',
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
        const { email, code } = args as { email: string; code: string };
        result = await client.verifyEmail(email, code);
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
        res.end(JSON.stringify({ status: 'ok', version: '0.3.0', tools: enabledTools.size }));
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
      logInfo('init', `A2A Market MCP Server v0.3.1 running on SSE (port ${port}, ${enabledTools.size} tools)`);
      logInfo('init', `SSE endpoint: http://localhost:${port}/sse`);
      logInfo('init', `Health check: http://localhost:${port}/health`);
    });
  } else {
    // Stdio 传输模式（默认）
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logInfo('init', `A2A Market MCP Server v0.3.1 running on stdio (${enabledTools.size} tools)`);
  }
}

main().catch((err) => {
  logError('init', 'Fatal:', err);
  process.exit(1);
});
