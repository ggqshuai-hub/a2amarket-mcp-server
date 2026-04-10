#!/usr/bin/env node
/**
 * 双 Key 联调：买家发布意图 + 双方常用读接口
 *
 * 用法（勿把 Key 写进仓库）:
 *   export A2AMARKET_BASE_URL=http://localhost:9098
 *   export A2AMARKET_BUYER_KEY=ak_live_...
 *   export A2AMARKET_SELLER_KEY=ak_live_...
 *   node test-live-keys.mjs
 *
 * 可选: INTENT_TEXT="..." 覆盖默认需求文案
 */

import * as crypto from 'crypto';

const BASE_URL = process.env.A2AMARKET_BASE_URL || 'http://localhost:9098';
const BUYER_KEY = process.env.A2AMARKET_BUYER_KEY || '';
const SELLER_KEY = process.env.A2AMARKET_SELLER_KEY || '';
const INTENT_TEXT = process.env.INTENT_TEXT || '我需要黄子弘凡小卡';

function buildEnvelope(subProtocol, action, data) {
  return {
    acap_version: '1.0',
    message_id: crypto.randomUUID(),
    sub_protocol: subProtocol,
    timestamp: new Date().toISOString(),
    payload: { action, data },
  };
}

async function acapRequest(apiKey, method, path, body) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Agent-Key': apiKey,
    'X-Idempotency-Key': crypto.randomUUID(),
    'X-ACAP-Timestamp': new Date().toISOString(),
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: resp.status, ok: resp.ok, data };
}

function extractIntentId(d) {
  const p = d?.payload;
  if (p == null) return null;
  const id = p.intent_id ?? p.data?.intent_id;
  return id != null ? Number(id) : null;
}

function shortJson(obj, max = 400) {
  const s = JSON.stringify(obj, null, 2);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('baseUrl:', BASE_URL);
  console.log('intent:', INTENT_TEXT);

  if (!BUYER_KEY || !SELLER_KEY) {
    console.error('请设置环境变量 A2AMARKET_BUYER_KEY 与 A2AMARKET_SELLER_KEY');
    process.exit(1);
  }

  let failed = 0;
  const fail = (name, r) => {
    failed++;
    console.log(`❌ ${name} HTTP ${r.status}`, shortJson(r.data, 600));
  };
  const ok = (name, r, extra = '') => {
    console.log(`✅ ${name} HTTP ${r.status}${extra ? ' ' + extra : ''}`);
  };

  // ── 买家：发布意图 ──
  const env = buildEnvelope('IDP', 'PUBLISH_INTENT', {
    raw_text: INTENT_TEXT,
    currency: 'CNY',
  });
  const pub = await acapRequest(BUYER_KEY, 'POST', '/acap/v1/intents', env);
  if (!pub.ok) {
    fail('publish_intent (买家)', pub);
    process.exit(1);
  }
  ok('publish_intent (买家)', pub);
  const intentId = extractIntentId(pub.data);
  console.log('   intent_id:', intentId);
  if (!intentId) {
    console.log('   payload:', shortJson(pub.data, 800));
    process.exit(1);
  }

  await sleep(1500);

  // ── 买家：意图 / 寻源 / 匹配 / 响应 ──
  const st = await acapRequest(BUYER_KEY, 'GET', `/acap/v1/intents/${intentId}`);
  st.ok ? ok('get_intent_status', st) : fail('get_intent_status', st);

  const src = await acapRequest(BUYER_KEY, 'GET', `/acap/v1/intents/${intentId}/sourcing`);
  src.ok ? ok('get_sourcing_status', src) : fail('get_sourcing_status', src);

  const mat = await acapRequest(BUYER_KEY, 'GET', `/acap/v1/intents/${intentId}/matches`);
  mat.ok ? ok('list_matches', mat) : fail('list_matches', mat);

  const rsp = await acapRequest(BUYER_KEY, 'GET', `/acap/v1/intents/${intentId}/responses`);
  rsp.ok ? ok('list_responses', rsp) : fail('list_responses', rsp);

  // ── 买家：搜索 Agent（有效 Key 应 200）──
  const searchB = await acapRequest(BUYER_KEY, 'GET', '/acap/v1/discovery/agents?role=seller&size=5');
  searchB.ok ? ok('search_agents (买家 Key)', searchB) : fail('search_agents (买家 Key)', searchB);

  const mineB = await acapRequest(BUYER_KEY, 'GET', '/acap/v1/agents/mine');
  mineB.ok ? ok('get_my_agents (买家)', mineB) : fail('get_my_agents (买家)', mineB);

  const balB = await acapRequest(BUYER_KEY, 'GET', '/acap/v1/compute/balance');
  balB.ok ? ok('get_balance (买家)', balB) : fail('get_balance (买家)', balB);

  const repB = await acapRequest(BUYER_KEY, 'GET', '/acap/v1/reputation/mine');
  repB.ok ? ok('get_reputation (买家)', repB) : fail('get_reputation (买家)', repB);

  // ── 卖家：供给 / 订阅 / 进站意图 / 搜索 ──
  const searchS = await acapRequest(SELLER_KEY, 'GET', '/acap/v1/discovery/agents?role=buyer&size=5');
  searchS.ok ? ok('search_agents (卖家 Key)', searchS) : fail('search_agents (卖家 Key)', searchS);

  const mineS = await acapRequest(SELLER_KEY, 'GET', '/acap/v1/agents/mine');
  mineS.ok ? ok('get_my_agents (卖家)', mineS) : fail('get_my_agents (卖家)', mineS);

  const products = await acapRequest(SELLER_KEY, 'GET', '/acap/v1/supply-products');
  products.ok ? ok('list_supply_products', products) : fail('list_supply_products', products);

  const subs = await acapRequest(SELLER_KEY, 'GET', '/acap/v1/subscriptions');
  subs.ok ? ok('list_subscriptions', subs) : fail('list_subscriptions', subs);

  const incoming = await acapRequest(SELLER_KEY, 'GET', '/acap/v1/intents/incoming?page=1&pageSize=10');
  incoming.ok ? ok('get_incoming_intents', incoming) : fail('get_incoming_intents', incoming);

  const strat = await acapRequest(SELLER_KEY, 'GET', '/acap/v1/hosted/strategies');
  strat.ok ? ok('list_hosted_strategies', strat) : fail('list_hosted_strategies', strat);

  const balS = await acapRequest(SELLER_KEY, 'GET', '/acap/v1/compute/balance');
  balS.ok ? ok('get_balance (卖家)', balS) : fail('get_balance (卖家)', balS);

  const repS = await acapRequest(SELLER_KEY, 'GET', '/acap/v1/reputation/mine');
  repS.ok ? ok('get_reputation (卖家)', repS) : fail('get_reputation (卖家)', repS);

  console.log('\n── 摘要 ──');
  console.log('intent_id:', intentId, '| 失败数:', failed);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
