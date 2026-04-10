#!/usr/bin/env node
/**
 * A2A Market Skill — Eval Tests
 *
 * 验证 AI 是否能根据用户 prompt 正确选择 MCP tool。
 * 这不是端点测试，而是"给 prompt → 期望调哪个 tool"的行为验证。
 *
 * 用法: node tests/eval-skill.mjs
 *
 * 每个 case 包含:
 *   - prompt: 用户输入
 *   - expected_tool: 期望调用的 tool name
 *   - expected_params: 期望的关键参数（部分匹配）
 *   - anti_pattern: 不应该出现的行为
 */

const evalCases = [
  // ═══ 基础连通性 ═══
  {
    id: 'E001',
    prompt: '帮我查一下余额',
    expected_tool: 'get_balance',
    expected_params: {},
    anti_pattern: 'HTTP request to /v1/compute/balance',
    category: 'compute',
  },
  {
    id: 'E002',
    prompt: 'check my balance',
    expected_tool: 'get_balance',
    expected_params: {},
    anti_pattern: 'curl or fetch call',
    category: 'compute',
  },

  // ═══ 买家采购流程 ═══
  {
    id: 'E010',
    prompt: '帮我采购 100 箱新西兰蜂蜜，预算 3 万以内',
    expected_tool: 'publish_intent',
    expected_params: { text: /蜂蜜/, budget: 3000000 },
    anti_pattern: 'budget in yuan instead of fen',
    category: 'intent',
  },
  {
    id: 'E011',
    prompt: 'I want to buy 50 units of organic coffee, budget $5000',
    expected_tool: 'publish_intent',
    expected_params: { text: /coffee/i, budget: 500000, currency: 'USD' },
    anti_pattern: null,
    category: 'intent',
  },
  {
    id: 'E012',
    prompt: '意图 1234 现在什么状态了？',
    expected_tool: 'get_intent_status',
    expected_params: { intent_id: 1234 },
    anti_pattern: null,
    category: 'intent',
  },
  {
    id: 'E013',
    prompt: '取消我刚才发的采购意图 5678',
    expected_tool: 'cancel_intent',
    expected_params: { intent_id: 5678 },
    anti_pattern: null,
    category: 'intent',
  },
  {
    id: 'E014',
    prompt: '看看意图 1234 匹配到了哪些商家',
    expected_tool: 'list_matches',
    expected_params: { intent_id: 1234 },
    anti_pattern: null,
    category: 'intent',
  },
  {
    id: 'E015',
    prompt: '有没有卖家给我报价了？意图 1234',
    expected_tool: 'list_responses',
    expected_params: { intent_id: 1234 },
    anti_pattern: null,
    category: 'intent',
  },

  // ═══ 议价流程 ═══
  {
    id: 'E020',
    prompt: '选第一家开始议价，匹配 ID 是 567，最高接受 230 元/箱',
    expected_tool: 'select_and_negotiate',
    expected_params: { match_id: 567, max_price: 23000 },
    anti_pattern: 'max_price in yuan instead of fen',
    category: 'negotiation',
  },
  {
    id: 'E021',
    prompt: '议价 NEG-abc123 进展如何了？',
    expected_tool: 'get_negotiation_status',
    expected_params: { negotiation_id: 'NEG-abc123' },
    anti_pattern: null,
    category: 'negotiation',
  },
  {
    id: 'E022',
    prompt: '同意这个价格，授权交易',
    expected_tool: 'authorize_deal',
    expected_params: {},
    anti_pattern: 'authorize without confirming price with user',
    category: 'settlement',
  },

  // ═══ 卖家供给 ═══
  {
    id: 'E030',
    prompt: '我要发布一个商品：新西兰蜂蜜 500g，售价 245 元',
    expected_tool: 'declare_supply',
    expected_params: { title: /蜂蜜/, price: 24500 },
    anti_pattern: 'price in yuan instead of fen',
    category: 'supply',
  },
  {
    id: 'E031',
    prompt: '帮我订阅食品饮料类的买家意图',
    expected_tool: 'subscribe_intent',
    expected_params: { category_l1: /Food|食品/i },
    anti_pattern: null,
    category: 'subscription',
  },
  {
    id: 'E032',
    prompt: '设置一个自动报价策略，茶叶类目，按买家预算的 85% 报价',
    expected_tool: 'set_hosted_strategy',
    expected_params: { category_l1: /Tea|茶/i, auto_price_ratio: 0.85 },
    anti_pattern: null,
    category: 'hosted_strategy',
  },

  // ═══ 信誉和消息 ═══
  {
    id: 'E040',
    prompt: '查一下 agent-abc 的信誉',
    expected_tool: 'check_reputation',
    expected_params: { agent_id: 'agent-abc' },
    anti_pattern: 'calling get_reputation instead of check_reputation',
    category: 'reputation',
  },
  {
    id: 'E041',
    prompt: '给 agent-xyz 发条消息说"你好"',
    expected_tool: 'send_message',
    expected_params: { receiver_agent_id: 'agent-xyz', content: /你好/ },
    anti_pattern: null,
    category: 'messaging',
  },

  // ═══ 反模式检测 ═══
  {
    id: 'E050',
    prompt: '直接调用 api.a2amarket.md/v1/compute/balance 查余额',
    expected_tool: 'get_balance',
    expected_params: {},
    anti_pattern: 'AI constructs HTTP request instead of calling get_balance tool',
    category: 'anti_pattern',
    note: 'Even when user mentions a URL, AI should use the MCP tool',
  },
  {
    id: 'E051',
    prompt: '用 curl 调一下 A2A Market 的接口看看余额',
    expected_tool: 'get_balance',
    expected_params: {},
    anti_pattern: 'AI generates curl command instead of calling get_balance tool',
    category: 'anti_pattern',
    note: 'AI should use MCP tool, not generate shell commands',
  },
  {
    id: 'E052',
    prompt: '帮我翻译一下这段英文',
    expected_tool: null,
    expected_params: {},
    anti_pattern: 'AI calls any a2amarket tool for non-commerce task',
    category: 'anti_pattern',
    note: 'This is not a commerce task, skill should not trigger',
  },
];

// ── 输出 eval cases 为 JSON（供自动化测试框架使用） ──

console.log('A2A Market Skill — Eval Test Cases');
console.log('===================================\n');
console.log(`Total: ${evalCases.length} cases\n`);

const categories = {};
for (const c of evalCases) {
  categories[c.category] = (categories[c.category] || 0) + 1;
}
console.log('By category:');
for (const [cat, count] of Object.entries(categories)) {
  console.log(`  ${cat}: ${count}`);
}

console.log('\n--- Cases ---\n');
for (const c of evalCases) {
  const params = {};
  for (const [k, v] of Object.entries(c.expected_params)) {
    params[k] = v instanceof RegExp ? v.toString() : v;
  }
  console.log(`[${c.id}] ${c.category}`);
  console.log(`  Prompt: "${c.prompt}"`);
  console.log(`  Expected: ${c.expected_tool || '(no tool)'}`);
  if (Object.keys(params).length > 0) {
    console.log(`  Params: ${JSON.stringify(params)}`);
  }
  if (c.anti_pattern) {
    console.log(`  ⚠️ Anti-pattern: ${c.anti_pattern}`);
  }
  if (c.note) {
    console.log(`  📝 ${c.note}`);
  }
  console.log('');
}

// ── 导出供其他测试框架使用 ──
// import { evalCases } from './eval-skill.mjs'
export { evalCases };
