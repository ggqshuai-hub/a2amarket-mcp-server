#!/usr/bin/env node
/**
 * 快速冒烟测试：验证 MCP Server 的特性开关
 * 用法: node test-feature-gate.mjs
 */
import { spawn } from 'child_process';

const HIDDEN_TOOLS = [
  'select_and_negotiate', 'get_negotiation_status', 'get_negotiation_rounds',
  'submit_offer', 'accept_deal', 'reject_deal',
  'create_settlement', 'authorize_deal', 'get_order_status',
  'respond_to_intent',
];

const EXPECTED_VISIBLE = 37;

let buffer = '';
let requestId = 0;

function send(proc, method, params = {}) {
  const id = ++requestId;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const frame = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
  proc.stdin.write(frame);
  return id;
}

function parseResponses(raw) {
  const results = [];
  const parts = raw.split(/Content-Length: \d+\r\n\r\n/).filter(Boolean);
  for (const part of parts) {
    try { results.push(JSON.parse(part)); } catch {}
  }
  return results;
}

async function runTest(envFeatures, label) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      A2AMARKET_API_KEY: 'ak_test_dummy',
      A2AMARKET_BASE_URL: 'http://localhost:9098',
    };
    if (envFeatures !== undefined) env.A2AMARKET_FEATURES = envFeatures;

    const proc = spawn('node', ['dist/index.js'], {
      cwd: new URL('.', import.meta.url).pathname,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', () => {}); // suppress logs

    // Initialize
    send(proc, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    });

    setTimeout(() => {
      // List tools
      send(proc, 'tools/list', {});

      setTimeout(() => {
        // Call a hidden tool
        send(proc, 'tools/call', { name: 'accept_deal', arguments: { negotiation_id: 'test' } });

        setTimeout(() => {
          proc.kill();
          const responses = parseResponses(stdout);
          resolve({ label, responses });
        }, 300);
      }, 300);
    }, 500);
  });
}

// ── Test 1: 默认模式 ──
console.log('=== Test 1: 默认模式（不设 A2AMARKET_FEATURES）===\n');
const t1 = await runTest(undefined, '默认模式');

const initResp = t1.responses.find(r => r.id === 1);
const listResp = t1.responses.find(r => r.id === 2);
const callResp = t1.responses.find(r => r.id === 3);

if (listResp?.result?.tools) {
  const tools = listResp.result.tools;
  const names = tools.map(t => t.name);
  const count = tools.length;
  const leaked = HIDDEN_TOOLS.filter(h => names.includes(h));

  console.log(`  工具总数: ${count} (期望 ${EXPECTED_VISIBLE})`);
  console.log(`  ${count === EXPECTED_VISIBLE ? '✅ PASS' : '❌ FAIL'} — 工具数量`);
  console.log(`  泄露的隐藏工具: ${leaked.length === 0 ? '无 ✅' : leaked.join(', ') + ' ❌'}`);
} else {
  console.log('  ❌ ListTools 无响应');
}

if (callResp?.result) {
  const text = callResp.result.content?.[0]?.text || '';
  const isBlocked = callResp.result.isError === true && text.includes('暂未开放');
  console.log(`  调用隐藏工具 accept_deal: ${isBlocked ? '✅ 正确拒绝' : '❌ 未拦截'}`);
  if (!isBlocked) console.log(`    响应: ${text}`);
} else {
  console.log('  ⚠️  CallTool 无响应（可能因为无真实后端）');
}

// ── Test 2: all 模式 ──
console.log('\n=== Test 2: A2AMARKET_FEATURES=all ===\n');
const t2 = await runTest('all', 'all 模式');

const listResp2 = t2.responses.find(r => r.id === 2);
if (listResp2?.result?.tools) {
  const count2 = listResp2.result.tools.length;
  console.log(`  工具总数: ${count2} (期望 47)`);
  console.log(`  ${count2 === 47 ? '✅ PASS' : '❌ FAIL'} — 全量开放`);
} else {
  console.log('  ❌ ListTools 无响应');
}

console.log('\n=== 测试完成 ===');
