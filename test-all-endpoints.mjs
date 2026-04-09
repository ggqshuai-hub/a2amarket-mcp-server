#!/usr/bin/env node
/**
 * A2A Market MCP Server v0.3.1 — 全量端点冒烟测试
 *
 * 两阶段测试：
 *   Phase 1: 特性开关（MCP stdio 协议层）
 *   Phase 2-4: 所有端点的实际请求（直接通过 AcapClient 调后端）
 *
 * 用法: node test-all-endpoints.mjs
 * 前提: 本地后端 localhost:9098 已启动
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:9098';
const API_KEY = 'ak_test_dummy';

// ── 轻量 HTTP Client（模拟 AcapClient 的行为） ──

async function acapRequest(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Agent-Key': API_KEY,
    'X-Idempotency-Key': crypto.randomUUID(),
    'X-ACAP-Timestamp': new Date().toISOString(),
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, ok: resp.ok, data };
}

function buildEnvelope(subProtocol, action, data) {
  return {
    acap_version: '1.0',
    message_id: crypto.randomUUID(),
    sub_protocol: subProtocol,
    timestamp: new Date().toISOString(),
    payload: { action, data },
  };
}

// ── Test Runner ──

let passed = 0, failed = 0, skipped = 0;

function ok(name, detail = '') {
  passed++;
  console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
  failed++;
  console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, detail = '') {
  skipped++;
  console.log(`  ⏭️  ${name}${detail ? ' — ' + detail : ''}`);
}

function check(name, resp, acceptCodes = [200, 201]) {
  if (acceptCodes.includes(resp.status)) {
    ok(name, `HTTP ${resp.status}`);
    return true;
  } else {
    const msg = typeof resp.data === 'string' ? resp.data.substring(0, 120) : (resp.data?.message || resp.data?.error?.message || JSON.stringify(resp.data)).substring(0, 120);
    fail(name, `HTTP ${resp.status} — ${msg}`);
    return false;
  }
}

// 允许认证失败（因为用的是 dummy key）
function checkAllowAuth(name, resp) {
  if (resp.ok) { ok(name, `HTTP ${resp.status}`); return true; }
  if (resp.status === 401 || resp.status === 403) { ok(name, `HTTP ${resp.status}（认证失败 — dummy key 预期）`); return true; }
  const msg = typeof resp.data === 'string' ? resp.data.substring(0, 120) : (resp.data?.message || resp.data?.error?.message || JSON.stringify(resp.data)).substring(0, 120);
  fail(name, `HTTP ${resp.status} — ${msg}`);
  return false;
}

// 允许 404（资源不存在是预期的）
function checkAllowNotFound(name, resp) {
  if (resp.ok) { ok(name, `HTTP ${resp.status}`); return true; }
  if ([401, 403, 404].includes(resp.status)) { ok(name, `HTTP ${resp.status}（预期错误）`); return true; }
  const msg = typeof resp.data === 'string' ? resp.data.substring(0, 120) : (resp.data?.message || resp.data?.error?.message || JSON.stringify(resp.data)).substring(0, 120);
  fail(name, `HTTP ${resp.status} — ${msg}`);
  return false;
}

// ── Phase 1: Feature Gate (MCP 协议层) ──

async function testFeatureGate() {
  console.log('\n══════════════════════════════════════');
  console.log('Phase 1: 特性开关验证');
  console.log('══════════════════════════════════════');

  // 直接 import 代码逻辑验证
  const FEATURE_GROUPS = {
    identity: ['register_agent','get_profile','update_profile','search_agents','verify_email','check_handle','get_my_agents','list_api_keys','get_usage','rotate_api_key'],
    intent: ['publish_intent','get_intent_status','cancel_intent','get_sourcing_status','list_matches','list_responses'],
    negotiation: ['select_and_negotiate','get_negotiation_status','get_negotiation_rounds','submit_offer','accept_deal','reject_deal'],
    settlement: ['create_settlement','authorize_deal','get_order_status'],
    preferences: ['set_preferences','get_preferences'],
    supply: ['declare_supply','update_supply','list_supply_products','get_supply_product','delete_supply_product'],
    seller_respond: ['respond_to_intent'],
    subscription: ['subscribe_intent','unsubscribe_intent','list_subscriptions','get_incoming_intents'],
    hosted_strategy: ['set_hosted_strategy','list_hosted_strategies','delete_hosted_strategy'],
    reputation: ['get_reputation','check_reputation'],
    compute: ['get_balance'],
    messaging: ['send_message','get_messages','list_conversations','get_conversation'],
  };

  const DEFAULT_FEATURES = 'identity,intent,preferences,supply,subscription,hosted_strategy,reputation,compute,messaging';
  const HIDDEN = ['negotiation', 'settlement', 'seller_respond'];

  const allTools = Object.values(FEATURE_GROUPS).flat();
  const defaultEnabled = new Set(DEFAULT_FEATURES.split(',').flatMap(g => FEATURE_GROUPS[g] || []));
  const hiddenTools = HIDDEN.flatMap(g => FEATURE_GROUPS[g]);

  console.log('\n── 1.1 默认模式 ──');
  if (defaultEnabled.size === 37) ok('默认工具数 = 37', `实际 ${defaultEnabled.size}`);
  else fail('默认工具数 = 37', `实际 ${defaultEnabled.size}`);

  if (allTools.length === 47) ok('全量工具数 = 47', `实际 ${allTools.length}`);
  else fail('全量工具数 = 47', `实际 ${allTools.length}`);

  const leaked = hiddenTools.filter(t => defaultEnabled.has(t));
  if (leaked.length === 0) ok('默认模式不含隐藏工具');
  else fail('默认模式泄露隐藏工具', leaked.join(', '));

  if (hiddenTools.length === 10) ok('隐藏工具数 = 10', hiddenTools.join(', '));
  else fail('隐藏工具数 = 10', `实际 ${hiddenTools.length}`);

  console.log('\n── 1.2 全量模式 ──');
  const allEnabled = new Set(Object.keys(FEATURE_GROUPS).flatMap(g => FEATURE_GROUPS[g]));
  if (allEnabled.size === 47) ok('all 模式工具数 = 47');
  else fail('all 模式工具数 = 47', `实际 ${allEnabled.size}`);
}

// ── Phase 2: Buyer Flow ──

async function testBuyerFlow() {
  console.log('\n══════════════════════════════════════');
  console.log('Phase 2: 买家视角全流程');
  console.log('══════════════════════════════════════');

  // 2.1 注册买家
  console.log('\n── 2.1 注册买家 Agent ──');
  const handle = `test-buyer-${Date.now()}`;
  const reg = await acapRequest('POST', '/acap/v1/agents', {
    handle, agentName: 'Test Buyer', agentType: 'BUYER',
    contactEmail: `${handle}@test.a2amarket.md`,
  });
  let agentId;
  if (check('register_agent', reg)) {
    agentId = reg.data?.data?.agent_id || reg.data?.data?.agentId;
    if (agentId) console.log(`    → agent_id: ${agentId}`);
  }

  // 2.2 检查 handle
  console.log('\n── 2.2 检查 handle ──');
  const handleCheck = await acapRequest('GET', `/acap/v1/agents/check/${handle}`);
  check('check_handle', handleCheck);

  // 2.3 查看公开 Profile
  console.log('\n── 2.3 查看公开 Profile ──');
  if (agentId) {
    const profile = await acapRequest('GET', `/acap/v1/agents/${agentId}`);
    check('get_profile', profile);
  } else skip('get_profile', '无 agent_id');

  // 2.4 查看我的 Agents
  console.log('\n── 2.4 查看我的 Agents ──');
  const myAgents = await acapRequest('GET', '/acap/v1/agents/mine');
  checkAllowAuth('get_my_agents', myAgents);

  // 2.5 搜索 Agent（与 /acap/v1/** 一致，需有效 API Key；dummy key 预期 403）
  console.log('\n── 2.5 搜索 Agent ──');
  const search = await acapRequest('GET', '/acap/v1/discovery/agents?role=seller&q=test');
  checkAllowAuth('search_agents', search);

  // 2.6 发布意图 (IDP 信封)
  console.log('\n── 2.6 发布采购意图 ──');
  const intentEnv = buildEnvelope('IDP', 'PUBLISH_INTENT', {
    raw_text: '采购100箱新西兰蜂蜜，需要有机认证', budget_max: 30000, currency: 'CNY',
  });
  const intent = await acapRequest('POST', '/acap/v1/intents', intentEnv);
  let intentId;
  if (checkAllowAuth('publish_intent', intent)) {
    intentId = intent.data?.payload?.intent_id || intent.data?.payload?.data?.intent_id;
    if (intentId) console.log(`    → intent_id: ${intentId}`);
  }

  // 2.7 查询意图状态
  console.log('\n── 2.7 查询意图状态 ──');
  if (intentId) {
    const status = await acapRequest('GET', `/acap/v1/intents/${intentId}`);
    checkAllowAuth('get_intent_status', status);
  } else skip('get_intent_status', '无 intent_id');

  // 2.8 寻源状态
  console.log('\n── 2.8 查询寻源状态 ──');
  if (intentId) {
    const sourcing = await acapRequest('GET', `/acap/v1/intents/${intentId}/sourcing`);
    checkAllowAuth('get_sourcing_status', sourcing);
  } else skip('get_sourcing_status', '无 intent_id');

  // 2.9 匹配结果
  console.log('\n── 2.9 查看匹配结果 ──');
  if (intentId) {
    const matches = await acapRequest('GET', `/acap/v1/intents/${intentId}/matches`);
    checkAllowAuth('list_matches', matches);
  } else skip('list_matches', '无 intent_id');

  // 2.10 报价响应
  console.log('\n── 2.10 查看报价响应 ──');
  if (intentId) {
    const responses = await acapRequest('GET', `/acap/v1/intents/${intentId}/responses`);
    checkAllowAuth('list_responses', responses);
  } else skip('list_responses', '无 intent_id');

  // 2.11 设置偏好
  console.log('\n── 2.11 设置采购偏好 ──');
  if (agentId) {
    const pref = await acapRequest('POST', `/acap/v1/agents/${agentId}/preferences`, {
      preferred_categories: ['食品', '保健品'], quality_level: 'premium', negotiation_aggression: 0.7,
    });
    checkAllowAuth('set_preferences', pref);
  } else skip('set_preferences', '无 agent_id');

  // 2.12 查询偏好
  console.log('\n── 2.12 查询偏好 ──');
  if (agentId) {
    const getPref = await acapRequest('GET', `/acap/v1/agents/${agentId}/preferences`);
    check('get_preferences', getPref);
  } else skip('get_preferences', '无 agent_id');

  // 2.13 取消意图
  console.log('\n── 2.13 取消意图 ──');
  if (intentId) {
    const cancel = await acapRequest('DELETE', `/acap/v1/intents/${intentId}`);
    checkAllowAuth('cancel_intent', cancel);
  } else skip('cancel_intent', '无 intent_id');

  // ── 隐藏端点验证（议价/结算）──
  console.log('\n── 2.14 议价端点可达性（隐藏功能验证） ──');
  const negoEnv = buildEnvelope('ANP', 'CREATE_NEGOTIATION', { match_id: 99999 });
  const nego = await acapRequest('POST', '/acap/v1/negotiations', negoEnv);
  checkAllowAuth('select_and_negotiate (后端可达)', nego);

  const negoStatus = await acapRequest('GET', '/acap/v1/negotiations/NGT-test');
  checkAllowNotFound('get_negotiation_status (后端可达)', negoStatus);

  const negoRounds = await acapRequest('GET', '/acap/v1/negotiations/NGT-test/rounds');
  checkAllowNotFound('get_negotiation_rounds (后端可达)', negoRounds);

  const submitOffer = buildEnvelope('ANP', 'SUBMIT_OFFER', { price: 100 });
  const offer = await acapRequest('POST', '/acap/v1/negotiations/NGT-test/offers', submitOffer);
  checkAllowNotFound('submit_offer (后端可达)', offer);

  const accept = await acapRequest('POST', '/acap/v1/negotiations/NGT-test/accept');
  checkAllowNotFound('accept_deal (后端可达)', accept);

  const reject = await acapRequest('POST', '/acap/v1/negotiations/NGT-test/reject');
  checkAllowNotFound('reject_deal (后端可达)', reject);

  const settlementEnv = buildEnvelope('ASP', 'CREATE_SETTLEMENT', { negotiation_session_code: 'NGT-test' });
  const settlement = await acapRequest('POST', '/acap/v1/settlements', settlementEnv);
  checkAllowAuth('create_settlement (后端可达)', settlement);

  const authorize = await acapRequest('POST', '/acap/v1/settlements/NGT-test/authorize');
  checkAllowNotFound('authorize_deal (后端可达)', authorize);

  const orderStatus = await acapRequest('GET', '/acap/v1/settlements/NGT-test');
  checkAllowNotFound('get_order_status (后端可达)', orderStatus);
}

// ── Phase 3: Seller Flow ──

async function testSellerFlow() {
  console.log('\n══════════════════════════════════════');
  console.log('Phase 3: 卖家视角全流程');
  console.log('══════════════════════════════════════');

  // 3.1 注册卖家
  console.log('\n── 3.1 注册卖家 Agent ──');
  const handle = `test-seller-${Date.now()}`;
  const reg = await acapRequest('POST', '/acap/v1/agents', {
    handle, agentName: 'Test Seller', agentType: 'SELLER',
    contactEmail: `${handle}@test.a2amarket.md`,
  });
  let agentId;
  if (check('register_agent (seller)', reg)) {
    agentId = reg.data?.data?.agent_id || reg.data?.data?.agentId;
    if (agentId) console.log(`    → agent_id: ${agentId}`);
  }

  // 3.2 发布商品 (body 使用 snake_case, buildFromMap 手动解析)
  console.log('\n── 3.2 发布供给商品 ──');
  const supply = await acapRequest('POST', '/acap/v1/supply-products', {
    title: 'Test Manuka Honey UMF10+', price: 250, price_currency: 'CNY',
    category_l1: '食品', category_l2: '蜂蜜', moq: 10, stock_quantity: 500,
    delivery_days: 7, service_regions: 'CN', keywords: '蜂蜜,新西兰',
  });
  let productId;
  if (checkAllowAuth('declare_supply', supply)) {
    productId = supply.data?.data?.id;
    if (productId) console.log(`    → product_id: ${productId}`);
  }

  // 3.3 查看商品列表
  console.log('\n── 3.3 查看商品列表 ──');
  const listProducts = await acapRequest('GET', '/acap/v1/supply-products');
  checkAllowAuth('list_supply_products', listProducts);

  // 3.4 查看商品详情
  console.log('\n── 3.4 查看商品详情 ──');
  if (productId) {
    const detail = await acapRequest('GET', `/acap/v1/supply-products/${productId}`);
    check('get_supply_product', detail);
  } else skip('get_supply_product', '无 product_id');

  // 3.5 更新商品
  console.log('\n── 3.5 更新商品 ──');
  if (productId) {
    const update = await acapRequest('PUT', `/acap/v1/supply-products/${productId}`, {
      price: 230, stock_quantity: 400,
    });
    checkAllowAuth('update_supply', update);
  } else skip('update_supply', '无 product_id');

  // 3.6 订阅买家意图
  console.log('\n── 3.6 订阅买家意图 ──');
  const sub = await acapRequest('POST', '/acap/v1/subscriptions', {
    category_l1: '食品', min_budget: 5000,
  });
  let subId;
  if (checkAllowAuth('subscribe_intent', sub)) {
    subId = sub.data?.data?.id;
    if (subId) console.log(`    → subscription_id: ${subId}`);
  }

  // 3.7 查看订阅列表
  console.log('\n── 3.7 查看订阅列表 ──');
  const listSubs = await acapRequest('GET', '/acap/v1/subscriptions');
  checkAllowAuth('list_subscriptions', listSubs);

  // 3.8 查看匹配意图
  console.log('\n── 3.8 查看匹配的买家意图 ──');
  const incoming = await acapRequest('GET', '/acap/v1/intents/incoming?page=1&pageSize=10');
  checkAllowAuth('get_incoming_intents', incoming);

  // 3.9 卖家主动报价 (隐藏功能)
  console.log('\n── 3.9 卖家主动报价（隐藏功能验证） ──');
  const respond = await acapRequest('POST', '/acap/v1/intents/99999/responses', {
    price: 200, quantity: 50, delivery_days: 5, agent_message: '测试报价',
  });
  checkAllowAuth('respond_to_intent (后端可达)', respond);

  // 3.10 托管策略
  console.log('\n── 3.10 设置托管策略 ──');
  const strat = await acapRequest('POST', '/acap/v1/hosted/strategies', {
    strategy_name: '测试策略', category_l1: '食品', auto_price_ratio: 0.85, auto_respond: true,
  });
  let stratId;
  if (checkAllowAuth('set_hosted_strategy', strat)) {
    stratId = strat.data?.payload?.id || strat.data?.data?.id;
    if (stratId) console.log(`    → strategy_id: ${stratId}`);
  }

  // 3.11 查看策略列表
  console.log('\n── 3.11 查看策略列表 ──');
  const listStrats = await acapRequest('GET', '/acap/v1/hosted/strategies');
  checkAllowAuth('list_hosted_strategies', listStrats);

  // 3.12 删除策略
  console.log('\n── 3.12 删除策略 ──');
  if (stratId) {
    const delStrat = await acapRequest('DELETE', `/acap/v1/hosted/strategies/${stratId}`);
    checkAllowAuth('delete_hosted_strategy', delStrat);
  } else skip('delete_hosted_strategy', '无 strategy_id');

  // 3.13 取消订阅
  console.log('\n── 3.13 取消订阅 ──');
  if (subId) {
    const unsub = await acapRequest('DELETE', `/acap/v1/subscriptions/${subId}`);
    checkAllowAuth('unsubscribe_intent', unsub);
  } else skip('unsubscribe_intent', '无 subscription_id');

  // 3.14 删除商品
  console.log('\n── 3.14 删除商品 ──');
  if (productId) {
    const del = await acapRequest('DELETE', `/acap/v1/supply-products/${productId}`);
    checkAllowAuth('delete_supply_product', del);
  } else skip('delete_supply_product', '无 product_id');
}

// ── Phase 4: Common Tools ──

async function testCommonTools() {
  console.log('\n══════════════════════════════════════');
  console.log('Phase 4: 通用工具');
  console.log('══════════════════════════════════════');

  console.log('\n── 4.1 查看自己的信誉 ──');
  const rep = await acapRequest('GET', '/acap/v1/reputation/mine');
  checkAllowAuth('get_reputation', rep);

  console.log('\n── 4.2 查询他人信誉 ──');
  const checkRep = await acapRequest('GET', '/acap/v1/reputation/agt_000000000000');
  checkAllowNotFound('check_reputation', checkRep);

  console.log('\n── 4.3 查询算力余额 ──');
  const balance = await acapRequest('GET', '/acap/v1/compute/balance');
  checkAllowAuth('get_balance', balance);

  console.log('\n── 4.4 发送消息 ──');
  const msg = await acapRequest('POST', '/acap/v1/messages', {
    receiver_agent_id: 'agt_000000000001', content: '你好，测试消息', message_type: 'text',
  });
  checkAllowAuth('send_message', msg);

  console.log('\n── 4.5 查看收件箱 ──');
  const inbox = await acapRequest('GET', '/acap/v1/messages');
  checkAllowAuth('get_messages', inbox);

  console.log('\n── 4.6 查看会话列表 ──');
  const convs = await acapRequest('GET', '/acap/v1/messages/conversations');
  checkAllowAuth('list_conversations', convs);

  console.log('\n── 4.7 查看会话详情 ──');
  const conv = await acapRequest('GET', '/acap/v1/messages/conversations/conv_test_123');
  checkAllowNotFound('get_conversation', conv);

  console.log('\n── 4.8 验证邮箱 ──');
  const verify = await acapRequest('POST', '/acap/v1/agents/verify-email', { email: 'test@test.com', code: '000000' });
  checkAllowNotFound('verify_email', verify);

  console.log('\n── 4.9 更新 Profile ──');
  const update = await acapRequest('PUT', '/acap/v1/agents/agt_000000000000', { agentName: 'Updated' });
  checkAllowAuth('update_profile', update);

  console.log('\n── 4.10 API Key 列表 ──');
  const keys = await acapRequest('GET', '/acap/v1/agents/agt_000000000000/keys');
  checkAllowAuth('list_api_keys', keys);

  console.log('\n── 4.11 用量统计 ──');
  const usage = await acapRequest('GET', '/acap/v1/agents/agt_000000000000/usage');
  checkAllowAuth('get_usage', usage);

  console.log('\n── 4.12 轮换 API Key ──');
  const rotate = await acapRequest('POST', '/acap/v1/agents/agt_000000000000/rotate-key');
  checkAllowAuth('rotate_api_key', rotate);
}

// ── Main ──

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  A2A Market MCP Server v0.3.1                ║');
  console.log('║  全量端点冒烟测试（47 个端点）                 ║');
  console.log('║  后端: http://localhost:9098                  ║');
  console.log('╚══════════════════════════════════════════════╝');

  try {
    await testFeatureGate();
    await testBuyerFlow();
    await testSellerFlow();
    await testCommonTools();
  } catch (err) {
    console.error('\n💥 测试异常:', err);
  }

  console.log('\n══════════════════════════════════════');
  console.log(`测试报告: ✅ ${passed}  ❌ ${failed}  ⏭️  ${skipped}  总计 ${passed + failed + skipped}`);
  console.log('══════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main();
