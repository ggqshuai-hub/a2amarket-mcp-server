/**
 * A2A Market ACAP API Client
 *
 * 封装所有 ACAP 端点调用，处理信封格式和 HMAC 签名。
 * v0.3.0 — 31 个 Tool 对应的完整 API 方法
 */

import * as crypto from 'crypto';

export interface AcapConfig {
  baseUrl: string;
  apiKey: string;
  hmacSecret?: string;
  agentId?: string;   // 当前 Agent ID（用于信封 sender）
  locale?: string;     // 错误信息语言 'zh' | 'en'
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

/** 结构化错误，保留 ACAP 错误码和重试信息 */
export class AcapError extends Error {
  public httpStatus?: number;
  public acapCode?: string;
  public retryAfter?: number;
  public details?: any;

  constructor(message: string, opts?: { httpStatus?: number; acapCode?: string; retryAfter?: number; details?: any }) {
    super(message);
    this.name = 'AcapError';
    if (opts) {
      this.httpStatus = opts.httpStatus;
      this.acapCode = opts.acapCode;
      this.retryAfter = opts.retryAfter;
      this.details = opts.details;
    }
  }
}

export class AcapClient {
  private config: AcapConfig;

  constructor(config: AcapConfig) {
    this.config = config;
  }

  /** 构建 ACAP 请求信封（含 sender + 幂等键关联） */
  private buildEnvelope(subProtocol: string, action: string, data: any, idempotencyKey?: string): AcapEnvelope {
    return {
      acap_version: '1.0',
      message_id: crypto.randomUUID(),
      sub_protocol: subProtocol,
      timestamp: new Date().toISOString(),
      sender: this.config.agentId
        ? { agent_id: this.config.agentId, agent_type: 'EXTERNAL', platform: 'mcp-server' }
        : undefined,
      auth: idempotencyKey ? { idempotency_key: idempotencyKey } : undefined,
      payload: { action, data },
    };
  }

  /** 统一 HTTP 请求 */
  private async request<T = any>(method: string, path: string, body?: any): Promise<AcapEnvelope<T>> {
    const url = `${this.config.baseUrl}${path}`;
    const idempotencyKey = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Key': this.config.apiKey,
      'X-Idempotency-Key': idempotencyKey,
      'X-ACAP-Timestamp': timestamp,
    };

    const bodyStr = body ? JSON.stringify(body) : undefined;

    // HMAC 签名：hmac-sha256:{base64}，签名范围包含 body
    if (this.config.hmacSecret && bodyStr) {
      const hmac = crypto.createHmac('sha256', this.config.hmacSecret);
      hmac.update(bodyStr);
      headers['X-ACAP-Signature'] = `hmac-sha256:${hmac.digest('base64')}`;
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
        throw new AcapError(
          `Server returned non-JSON response (HTTP ${resp.status}): ${text.substring(0, 500)}`,
          { httpStatus: resp.status }
        );
      }

      // 结构化错误提取
      if (!resp.ok) {
        const acapErr = result.error || result;
        throw new AcapError(
          acapErr.message || `HTTP ${resp.status}`,
          {
            httpStatus: resp.status,
            acapCode: acapErr.code,
            retryAfter: acapErr.retry_after,
            details: acapErr.details,
          }
        );
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

  async verifyEmail(email: string, code: string) {
    return this.request('POST', '/acap/v1/agents/verify-email', { email, code });
  }

  async checkHandle(handle: string) {
    return this.request('GET', `/acap/v1/agents/check/${handle}`);
  }

  async getMyAgents() {
    return this.request('GET', '/acap/v1/agents/mine');
  }

  async listApiKeys(agentId: string) {
    return this.request('GET', `/acap/v1/agents/${agentId}/keys`);
  }

  async getUsage(agentId: string) {
    return this.request('GET', `/acap/v1/agents/${agentId}/usage`);
  }

  async rotateApiKey(agentId: string) {
    return this.request('POST', `/acap/v1/agents/${agentId}/rotate-key`);
  }

  // ══════════════════════════════════════════════════════════
  // 买家 — 意图生命周期
  // ══════════════════════════════════════════════════════════

  async publishIntent(text: string, budget?: number, currency?: string) {
    const envelope = this.buildEnvelope('IDP', 'PUBLISH_INTENT', {
      raw_text: text, budget_max: budget, currency: currency || 'CNY',
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
    return this.request('GET', `/acap/v1/intents/${intentId}/sourcing`);
  }

  async listMatches(intentId: number) {
    return this.request('GET', `/acap/v1/intents/${intentId}/matches`);
  }

  async listResponses(intentId: number) {
    return this.request('GET', `/acap/v1/intents/${intentId}/responses`);
  }

  // ══════════════════════════════════════════════════════════
  // 买家 — 议价与结算（平台托管模式）
  // ══════════════════════════════════════════════════════════

  async selectAndNegotiate(matchId: number, preferences?: { max_price?: number; quantity?: number }) {
    const envelope = this.buildEnvelope('ANP', 'CREATE_NEGOTIATION', {
      match_id: matchId, initial_offer: preferences?.max_price, quantity: preferences?.quantity,
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
    return this.request('POST', `/acap/v1/settlements/${sessionCode}/authorize`);
  }

  async rejectDeal(sessionCode: string) {
    return this.request('POST', `/acap/v1/negotiations/${sessionCode}/reject`);
  }

  async getOrderStatus(sessionId: string) {
    return this.request('GET', `/acap/v1/settlements/${sessionId}`);
  }

  async submitOffer(sessionCode: string, price: number, message?: string) {
    const envelope = this.buildEnvelope('ANP', 'SUBMIT_OFFER', { price, message });
    return this.request('POST', `/acap/v1/negotiations/${sessionCode}/offers`, envelope);
  }

  async acceptDeal(sessionCode: string) {
    return this.request('POST', `/acap/v1/negotiations/${sessionCode}/accept`);
  }

  async createSettlement(sessionCode: string) {
    const envelope = this.buildEnvelope('ASP', 'CREATE_SETTLEMENT', { negotiation_session_code: sessionCode });
    return this.request('POST', '/acap/v1/settlements', envelope);
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

  async listSupplyProducts() {
    return this.request('GET', '/acap/v1/supply-products');
  }

  async getSupplyProduct(id: number) {
    return this.request('GET', `/acap/v1/supply-products/${id}`);
  }

  async deleteSupplyProduct(id: number) {
    return this.request('DELETE', `/acap/v1/supply-products/${id}`);
  }

  async respondToIntent(intentId: number, data: { price: number; quantity?: number; delivery_days?: number; agent_message?: string }) {
    return this.request('POST', `/acap/v1/intents/${intentId}/responses`, data);
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
    strategy_name?: string; category_l1: string; category_l2?: string;
    min_budget?: number; max_budget?: number;
    auto_price?: number; auto_price_ratio?: number;
    auto_quantity?: number; auto_delivery_days?: number;
    auto_message?: string; auto_respond?: boolean;
  }) {
    return this.request('POST', '/acap/v1/hosted/strategies', data);
  }

  async listHostedStrategies() {
    return this.request('GET', '/acap/v1/hosted/strategies');
  }

  async deleteHostedStrategy(strategyId: number) {
    return this.request('DELETE', `/acap/v1/hosted/strategies/${strategyId}`);
  }

  // ══════════════════════════════════════════════════════════
  // 通用 — 信誉 / 算力 / 消息
  // ══════════════════════════════════════════════════════════

  async checkReputation(agentId: string) {
    return this.request('GET', `/acap/v1/reputation/${agentId}`);
  }

  async getReputation() {
    return this.request('GET', '/acap/v1/reputation/mine');
  }

  async getBalance() {
    return this.request('GET', '/acap/v1/compute/balance');
  }

  async sendMessage(receiverAgentId: string, content: string, messageType?: string) {
    return this.request('POST', '/acap/v1/messages', {
      receiver_agent_id: receiverAgentId,
      content,
      message_type: messageType || 'text',
    });
  }

  async getMessages(status?: string) {
    const params = status ? `?status=${status}` : '';
    return this.request('GET', `/acap/v1/messages${params}`);
  }

  async listConversations() {
    return this.request('GET', '/acap/v1/messages/conversations');
  }

  async getConversation(conversationId: string) {
    return this.request('GET', `/acap/v1/messages/conversations/${conversationId}`);
  }
}
