#!/usr/bin/env node

/**
 * A2A Market MCP Server v0.2.0
 *
 * 将 A2A Market 平台能力暴露为 29 个 MCP Tools，
 * 让 Claude/OpenClaw/Cursor 等 AI 工具直接操作 A2A Market。
 *
 * 使用方式:
 *   A2AMARKET_API_KEY=ak_xxx npx @hangzhou-qian-yuan/a2amarket-mcp-server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AcapClient } from './acap-client.js';

const BASE_URL = process.env.A2AMARKET_BASE_URL || 'https://api.a2amarket.md';
const API_KEY = process.env.A2AMARKET_API_KEY || '';
const HMAC_SECRET = process.env.A2AMARKET_HMAC_SECRET;

if (!API_KEY) {
  console.error('Error: A2AMARKET_API_KEY environment variable is required');
  process.exit(1);
}

const client = new AcapClient({ baseUrl: BASE_URL, apiKey: API_KEY, hmacSecret: HMAC_SECRET });

const server = new Server(
  { name: 'a2amarket', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

// ── Tool 定义 ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
      description: '查询订单状态（支付、发货、完成等）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session_id: { type: 'string', description: '订单会话 ID' },
        },
        required: ['session_id'],
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
      description: '更新已有的供给声明（部分更新，只传需要改的字段）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          declaration_id: { type: 'number', description: '声明 ID' },
          description: { type: 'string', description: '新描述' },
          price_min: { type: 'number', description: '新最低价格' },
          price_max: { type: 'number', description: '新最高价格' },
          delivery_days: { type: 'number', description: '新交期' },
        },
        required: ['declaration_id'],
      },
    },

    // ═══ 卖家 — 意图订阅 ═══
    {
      name: 'subscribe_intent',
      description: '订阅特定类型的买家意图。有匹配意图时会收到通知。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          category_l1: { type: 'string', description: '品类过滤' },
          category_l2: { type: 'string', description: '二级品类过滤' },
          min_budget: { type: 'number', description: '最低预算过滤' },
          max_budget: { type: 'number', description: '最高预算过滤' },
          regions: { type: 'string', description: '地区过滤' },
        },
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
      description: '设置托管议价策略。平台 Agent 会按此策略代替你与买家议价。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          strategy_type: { type: 'string', enum: ['linear_concession', 'tit_for_tat', 'time_decay'], description: '策略类型' },
          min_price: { type: 'number', description: '底价（不会低于此价格）' },
          max_concession_rate: { type: 'number', description: '最大让步比例 0.0~1.0' },
          auto_accept_above: { type: 'number', description: '高于此价格自动接受' },
        },
        required: ['strategy_type'],
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
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ],
}));

// ── Tool 处理 ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: any;

    switch (name) {
      // ── 通用 — Agent 身份管理 ──
      case 'register_agent':
        result = await client.registerAgent({
          handle: args!.handle as string,
          agentName: args!.agent_name as string,
          agentType: args!.agent_type as string,
          contactEmail: args!.contact_email as string,
          endpointUrl: args?.endpoint_url as string | undefined,
        });
        break;
      case 'get_profile':
        result = await client.getProfile(args!.agent_id as string);
        break;
      case 'update_profile':
        result = await client.updateProfile(args!.agent_id as string, {
          agentName: args?.agent_name,
          endpointUrl: args?.endpoint_url,
          capabilities: args?.capabilities,
        });
        break;
      case 'search_agents':
        result = await client.searchAgents(args?.query as string, args?.role as string);
        break;

      // ── 买家 — 意图生命周期 ──
      case 'publish_intent':
        result = await client.publishIntent(
          args!.text as string, args?.budget as number, args?.currency as string);
        break;
      case 'get_intent_status':
        result = await client.getIntent(args!.intent_id as number);
        break;
      case 'cancel_intent':
        result = await client.cancelIntent(args!.intent_id as number);
        break;
      case 'get_sourcing_status':
        result = await client.getSourcingStatus(args!.intent_id as number);
        break;
      case 'list_matches':
        result = await client.listMatches(args!.intent_id as number);
        break;
      case 'list_responses':
        result = await client.listResponses(args!.intent_id as number);
        break;

      // ── 买家 — 议价与结算 ──
      case 'select_and_negotiate':
        result = await client.selectAndNegotiate(args!.match_id as number, {
          max_price: args?.max_price as number,
          quantity: args?.quantity as number,
        });
        break;
      case 'get_negotiation_status':
        result = await client.getNegotiationStatus(args!.negotiation_id as string);
        break;
      case 'authorize_deal':
        result = await client.authorizeDeal(args!.negotiation_id as string);
        break;
      case 'reject_deal':
        result = await client.rejectDeal(args!.negotiation_id as string);
        break;
      case 'get_order_status':
        result = await client.getOrderStatus(args!.session_id as string);
        break;

      // ── 买家 — 偏好 ──
      case 'set_preferences': {
        const prefData: Record<string, any> = {};
        for (const key of ['preferred_categories', 'preferred_regions', 'default_budget_max',
          'quality_level', 'negotiation_aggression', 'max_delivery_days', 'auto_authorize']) {
          if (args?.[key] !== undefined) prefData[key] = args[key];
        }
        result = await client.setPreferences(args!.agent_id as string, prefData);
        break;
      }

      // ── 卖家 — 供给声明 ──
      case 'declare_supply':
        result = await client.declareSupply({
          title: args!.title as string,
          description: args?.description as string,
          category_l1: args?.category_l1 as string,
          category_l2: args?.category_l2 as string,
          price: args!.price as number,
          price_currency: args?.price_currency as string,
          moq: args?.moq as number,
          stock_quantity: args?.stock_quantity as number,
          delivery_days: args?.delivery_days as number,
          service_regions: args?.service_regions as string,
          image_url: args?.image_url as string,
          keywords: args?.keywords as string,
          contact_name: args?.contact_name as string,
          contact_phone: args?.contact_phone as string,
        });
        break;
      case 'update_supply': {
        const updateData: Record<string, any> = {};
        for (const key of ['description', 'price_min', 'price_max', 'delivery_days',
          'category_l1', 'category_l2', 'moq', 'service_regions', 'keywords']) {
          if (args?.[key] !== undefined) updateData[key] = args[key];
        }
        result = await client.updateSupply(args!.declaration_id as number, updateData);
        break;
      }

      // ── 卖家 — 意图订阅 ──
      case 'subscribe_intent':
        result = await client.subscribeIntent({
          category_l1: args?.category_l1 as string,
          category_l2: args?.category_l2 as string,
          min_budget: args?.min_budget as number,
          max_budget: args?.max_budget as number,
          regions: args?.regions as string,
        });
        break;
      case 'unsubscribe_intent':
        result = await client.unsubscribeIntent(args!.subscription_id as number);
        break;
      case 'list_subscriptions':
        result = await client.listSubscriptions();
        break;
      case 'get_incoming_intents':
        result = await client.getIncomingIntents(args?.page as number, args?.page_size as number);
        break;

      // ── 卖家 — 托管议价策略 ──
      case 'set_hosted_strategy':
        result = await client.setHostedStrategy({
          strategy_type: args!.strategy_type as string,
          min_price: args?.min_price as number,
          max_concession_rate: args?.max_concession_rate as number,
          auto_accept_above: args?.auto_accept_above as number,
        });
        break;

      // ── 卖家 — 信誉 ──
      case 'get_reputation':
        result = await client.getReputation();
        break;

      // ── 通用 — 信誉 / 算力 / 消息 ──
      case 'check_reputation':
        result = await client.checkReputation(args!.agent_id as string);
        break;
      case 'get_balance':
        result = await client.getBalance();
        break;
      case 'send_message':
        result = await client.sendMessage(
          args!.receiver_agent_id as string, args!.content as string, args?.message_type as string);
        break;
      case 'get_messages':
        result = await client.getMessages();
        break;

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

// ── 启动 ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('A2A Market MCP Server v0.2.0 running on stdio (29 tools)');
}

main().catch(console.error);
