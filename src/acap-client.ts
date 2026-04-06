/**
 * A2A Market ACAP API Client
 *
 * 封装所有 ACAP 端点调用，处理信封格式和 HMAC 签名。
 * v0.2.0 — 29 个 Tool 对应的完整 API 方法
 */

import * as crypto from 'crypto';

export interface AcapConfig {
  baseUrl: string;
  apiKey: string;
  hmacSecret?: string;
}

export interface AcapEnvelope<T = any> {
  acap_version: string;
  message_id: string;
  sub_protocol: string;
  timestamp: string;
  sender?: { agent_id: string; agent_type: string; platform: string };
  ref_message_id?: string;
  auth?: { signature?: string; idempotency_key?: string };
  payload?: T;
  error?: { code: string; message: string; http_status: number; retry_after?: number; details?: any };
}

export class AcapClient {
  private config: AcapConfig;

  constructor(config: AcapConfig) {
    this.config = config;
  }

  /** 构建 ACAP 请求信封 */
  private buildEnvelope(subProtocol: string, action: string, payload: any): AcapEnvelope {
    return {
      acap_version: '1.0',
      message_id: crypto.randomUUID(),
      sub_protocol: subProtocol,
      timestamp: new Date().toISOString(),
      payload: { action, ...payload },
    };
  }

  /** 统一 HTTP 请求 */
  private async request<T = any>(method: string, path: string, body?: any): Promise<AcapEnvelope<T>> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Key': this.config.apiKey,
      'X-Idempotency-Key': crypto.randomUUID(),
    };

    const bodyStr = body ? JSON.stringify(body) : undefined;

    // HMAC 签名（可选）
    if (this.config.hmacSecret && bodyStr) {
      const hmac = crypto.createHmac('sha256', this.config.hmacSecret);
      hmac.update(bodyStr);
      headers['X-ACAP-Signature'] = hmac.digest('hex');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: bodyStr,
        signal: controller.signal,
      });

      const text = await resp.text();
      let result: any;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(`Server returned non-JSON response (HTTP ${resp.status}): ${text.substring(0, 200)}`);
      }

      if (!resp.ok && !result.payload) {
        throw new Error(`HTTP ${resp.status}: ${result.message || result.error?.message || text.substring(0, 200)}`);
      }

      return result as AcapEnvelope<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 通用 — Agent 身份管理
  // ══════════════════════════════════════════════════════════

  async registerAgent(data: { handle: string; agentName: string; agentType: string; contactEmail: string; endpointUrl?: string; capabilities?: string }) {
    return this.request('POST', '/acap/v1/agents', data);
  }

  async getProfile(agentId: string) {
    return this.request('GET', `/acap/v1/agents/${agentId}`);
  }

  async updateProfile(agentId: string, data: Record<string, any>) {
    return this.request('PUT', `/acap/v1/agents/${agentId}`, data);
  }

  async searchAgents(query?: string, role?: string) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (role) params.set('role', role);
    const qs = params.toString();
    return this.request('GET', `/acap/v1/discovery/agents${qs ? '?' + qs : ''}`);
  }

  // ══════════════════════════════════════════════════════════
  // 买家 — 意图生命周期
  // ══════════════════════════════════════════════════════════

  async publishIntent(text: string, budget?: number, currency?: string) {
    const envelope = this.buildEnvelope('IDP', 'PUBLISH_INTENT', {
      text, budget_max: budget, currency: currency || 'CNY',
    });
    return this.request('POST', '/acap/v1/intents', envelope);
  }

  async getIntent(intentId: number) {
    return this.request('GET', `/acap/v1/intents/${intentId}`);
  }

  async cancelIntent(intentId: number) {
    return this.request('DELETE', `/acap/v1/intents/${intentId}`);
  }

  async getSourcingStatus(intentId: number) {
    return this.request('GET', `/api/v1/sourcing/intent/${intentId}`);
  }

  async listMatches(intentId: number) {
    return this.request('GET', `/api/v1/match/intent/${intentId}`);
  }

  async listResponses(intentId: number) {
    return this.request('GET', `/acap/v1/intents/${intentId}/responses`);
  }

  // ══════════════════════════════════════════════════════════
  // 买家 — 议价与结算（平台托管模式）
  // ══════════════════════════════════════════════════════════

  async selectAndNegotiate(matchId: number, preferences?: { max_price?: number; quantity?: number }) {
    const envelope = this.buildEnvelope('ANP', 'CREATE_NEGOTIATION', {
      match_id: matchId, hosted: true, ...preferences,
    });
    return this.request('POST', '/acap/v1/negotiations', envelope);
  }

  async getNegotiationStatus(sessionCode: string) {
    return this.request('GET', `/acap/v1/negotiations/${sessionCode}`);
  }

  async getNegotiationRounds(sessionCode: string) {
    return this.request('GET', `/acap/v1/negotiations/${sessionCode}/rounds`);
  }

  async authorizeDeal(sessionCode: string) {
    const envelope = this.buildEnvelope('ASP', 'AUTHORIZE', { session_code: sessionCode });
    return this.request('POST', `/acap/v1/settlements/${sessionCode}/authorize`, envelope);
  }

  async rejectDeal(sessionCode: string) {
    const envelope = this.buildEnvelope('ANP', 'REJECT', { session_code: sessionCode });
    return this.request('POST', `/acap/v1/negotiations/${sessionCode}/reject`, envelope);
  }

  async getOrderStatus(sessionId: string) {
    return this.request('GET', `/api/v1/orders/${sessionId}`);
  }

  // ══════════════════════════════════════════════════════════
  // 买家 — 偏好设置
  // ══════════════════════════════════════════════════════════

  async setPreferences(agentId: string, preferences: Record<string, any>) {
    return this.request('POST', `/acap/v1/agents/${agentId}/preferences`, preferences);
  }

  async getPreferences(agentId: string) {
    return this.request('GET', `/acap/v1/agents/${agentId}/preferences`);
  }

  // ══════════════════════════════════════════════════════════
  // 卖家 — 供给声明
  // ══════════════════════════════════════════════════════════

  async declareSupply(data: {
    title: string; description?: string;
    category_l1?: string; category_l2?: string;
    price: number; price_currency?: string;
    moq?: number; stock_quantity?: number;
    delivery_days?: number; service_regions?: string;
    image_url?: string; keywords?: string;
    contact_name?: string; contact_phone?: string;
    extra_attrs?: Record<string, any>; expires_at?: string;
  }) {
    return this.request('POST', '/acap/v1/supply-products', data);
  }

  async updateSupply(id: number, data: Record<string, any>) {
    return this.request('PUT', `/acap/v1/supply-products/${id}`, data);
  }

  // ══════════════════════════════════════════════════════════
  // 卖家 — 意图订阅
  // ══════════════════════════════════════════════════════════

  async subscribeIntent(criteria: {
    category_l1?: string; category_l2?: string;
    min_budget?: number; max_budget?: number;
    regions?: string; notify_channel?: string;
  }) {
    return this.request('POST', '/acap/v1/subscriptions', criteria);
  }

  async unsubscribeIntent(subscriptionId: number) {
    return this.request('DELETE', `/acap/v1/subscriptions/${subscriptionId}`);
  }

  async listSubscriptions() {
    return this.request('GET', '/acap/v1/subscriptions');
  }

  async getIncomingIntents(page?: number, pageSize?: number) {
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (pageSize) params.set('pageSize', String(pageSize));
    const qs = params.toString();
    return this.request('GET', `/acap/v1/intents/incoming${qs ? '?' + qs : ''}`);
  }

  // ══════════════════════════════════════════════════════════
  // 卖家 — 托管议价策略
  // ══════════════════════════════════════════════════════════

  async setHostedStrategy(data: {
    strategy_type: string; min_price?: number; max_concession_rate?: number;
    auto_accept_above?: number; extra_params?: Record<string, any>;
  }) {
    return this.request('POST', '/acap/v1/hosted/strategies', data);
  }

  // ══════════════════════════════════════════════════════════
  // 通用 — 信誉 / 算力 / 消息
  // ══════════════════════════════════════════════════════════

  async checkReputation(agentId: string) {
    return this.request('GET', `/acap/v1/reputation/${agentId}`);
  }

  async getReputation() {
    return this.request('GET', '/api/v1/reputation/score');
  }

  async getBalance() {
    return this.request('GET', '/acap/v1/compute/balance');
  }

  async sendMessage(receiverAgentId: string, content: string, messageType?: string) {
    const envelope = this.buildEnvelope('AMP', 'SEND_MESSAGE', {
      receiver_agent_id: receiverAgentId, content, message_type: messageType || 'text',
    });
    return this.request('POST', '/acap/v1/messages', envelope);
  }

  async getMessages(status?: string) {
    const params = status ? `?status=${status}` : '';
    return this.request('GET', `/acap/v1/messages${params}`);
  }
}
