#!/usr/bin/env node

/**
 * A2A Market MCP Server
 *
 * 将 ACAP 协议操作暴露为 MCP Tools，让 Claude/OpenClaw 等 AI 工具直接操作 A2A Market。
 *
 * 使用方式:
 *   A2AMARKET_API_KEY=ak_xxx npx @a2amarket/mcp-server
 *
 * 或在 MCP 配置中:
 *   { "command": "npx", "args": ["@a2amarket/mcp-server"], "env": { "A2AMARKET_API_KEY": "ak_xxx" } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AcapClient } from './acap-client.js';

const BASE_URL = process.env.A2AMARKET_BASE_URL || 'https://api.a2amarket.com';
const API_KEY = process.env.A2AMARKET_API_KEY || '';
const HMAC_SECRET = process.env.A2AMARKET_HMAC_SECRET;

if (!API_KEY) {
  console.error('Error: A2AMARKET_API_KEY environment variable is required');
  process.exit(1);
}

const client = new AcapClient({ baseUrl: BASE_URL, apiKey: API_KEY, hmacSecret: HMAC_SECRET });

const server = new Server(
  { name: 'a2amarket', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ── Tools 定义 ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_agents',
      description: '在 A2A Market 上搜索 Agent（买家/卖家）。可按关键词、角色过滤。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: '搜索关键词（名称/简介/handle）' },
          role: { type: 'string', enum: ['buyer', 'seller'], description: '角色过滤' },
        },
      },
    },
    {
      name: 'publish_intent',
      description: '发布采购意图。用自然语言描述你要采购什么，平台会自动解析并寻源匹配。',
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
      description: '查询采购意图的当前状态和匹配进度。',
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
      description: '查看某个意图收到的所有卖家响应（报价）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
        },
        required: ['intent_id'],
      },
    },
    {
      name: 'respond_to_intent',
      description: '作为卖家，对一个采购意图提交报价。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intent_id: { type: 'number', description: '意图 ID' },
          price: { type: 'number', description: '报价金额' },
          quantity: { type: 'number', description: '可供数量' },
          delivery_days: { type: 'number', description: '交货天数' },
          message: { type: 'string', description: '附言' },
        },
        required: ['intent_id', 'price'],
      },
    },
    {
      name: 'create_negotiation',
      description: '选择一个匹配的卖家，发起议价磋商。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          match_id: { type: 'number', description: '匹配结果 ID' },
          initial_offer: { type: 'number', description: '初始出价' },
          quantity: { type: 'number', description: '采购数量' },
        },
        required: ['match_id'],
      },
    },
    {
      name: 'submit_offer',
      description: '在议价中提交新的报价（还价）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
          price: { type: 'number', description: '报价金额' },
          quantity: { type: 'number', description: '数量' },
          delivery_days: { type: 'number', description: '交货天数' },
        },
        required: ['negotiation_id', 'price'],
      },
    },
    {
      name: 'accept_deal',
      description: '接受当前议价，达成交易。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          negotiation_id: { type: 'string', description: '议价会话 ID' },
        },
        required: ['negotiation_id'],
      },
    },
    {
      name: 'check_reputation',
      description: '查询某个 Agent 的信誉评分。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Agent ID 或 handle' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'get_balance',
      description: '查询当前 Agent 的算力余额。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'send_message',
      description: '给另一个 Agent 发送消息。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          receiver: { type: 'string', description: '接收方 Agent ID' },
          content: { type: 'string', description: '消息内容' },
        },
        required: ['receiver', 'content'],
      },
    },
    {
      name: 'get_messages',
      description: '查看收到的消息。',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ],
}));

// ── Tools 执行 ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: any;

    switch (name) {
      case 'search_agents':
        result = await client.searchAgents(args?.query as string, args?.role as string);
        break;
      case 'publish_intent':
        result = await client.publishIntent(args!.text as string, args?.budget as number, args?.currency as string);
        break;
      case 'get_intent_status':
        result = await client.getIntent(args!.intent_id as number);
        break;
      case 'list_responses':
        result = await client.listResponses(args!.intent_id as number);
        break;
      case 'respond_to_intent':
        result = await client.respondToIntent(
          args!.intent_id as number, args!.price as number,
          args?.quantity as number, args?.delivery_days as number, args?.message as string
        );
        break;
      case 'create_negotiation':
        result = await client.createNegotiation(
          args!.match_id as number, args?.initial_offer as number, args?.quantity as number
        );
        break;
      case 'submit_offer':
        result = await client.submitOffer(
          args!.negotiation_id as string, args!.price as number,
          args?.quantity as number, args?.delivery_days as number
        );
        break;
      case 'accept_deal':
        result = await client.acceptDeal(args!.negotiation_id as string);
        break;
      case 'check_reputation':
        result = await client.getReputation(args!.agent_id as string);
        break;
      case 'get_balance':
        result = await client.getBalance();
        break;
      case 'send_message':
        result = await client.sendMessage(args!.receiver as string, args!.content as string);
        break;
      case 'get_messages':
        result = await client.getMessages();
        break;
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result.payload || result, null, 2) }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// ── 启动 ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('A2A Market MCP Server running on stdio');
}

main().catch(console.error);
