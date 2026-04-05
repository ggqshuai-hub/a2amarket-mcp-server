/**
 * A2A Market ACAP API Client
 *
 * 封装所有 ACAP 端点调用，处理信封格式和 HMAC 签名。
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
  private buildEnvelope(subProtocol: string, action: string, data: any): AcapEnvelope {
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`;
    const body: AcapEnvelope = {
      acap_version: '1.0',
      message_id: messageId,
      sub_protocol: subProtocol,
      timestamp: new Date().toISOString(),
      payload: { action, data },
    };
    return body;
  }

  /** 计算 HMAC-SHA256 签名 */
  private sign(body: string): string {
    if (!this.config.hmacSecret) return '';
    const hmac = crypto.createHmac('sha256', this.config.hmacSecret);
    hmac.update(body);
    return `hmac-sha256:${hmac.digest('base64')}`;
  }

  /** 发送请求 */
  async request<T = any>(method: string, path: string, body?: any): Promise<AcapEnvelope<T>> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Key': this.config.apiKey,
    };

    let bodyStr: string | undefined;
    if (body) {
      bodyStr = JSON.stringify(body);
      const sig = this.sign(bodyStr);
      if (sig) headers['X-ACAP-Signature'] = sig;
      headers['X-Idempotency-Key'] = `idem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: bodyStr,
    });

    const result = await resp.json() as AcapEnvelope<T>;

    if (result.error) {
      throw new Error(`ACAP Error [${result.error.code}]: ${result.error.message}`);
    }

    return result;
  }

  // ── AIP ──

  async registerAgent(handle: string, displayName: string, agentType: string) {
    return this.request('POST', '/acap/v1/agents', { handle, display_name: displayName, agent_type: agentType });
  }

  async searchAgents(query?: string, role?: string) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (role) params.set('role', role);
    return this.request('GET', `/acap/v1/discovery/agents?${params}`);
  }

  // ── IDP ──

  async publishIntent(rawText: string, budget?: number, currency?: string) {
    const envelope = this.buildEnvelope('IDP', 'PUBLISH_INTENT', {
      raw_text: rawText,
      budget,
      currency: currency || 'CNY',
    });
    return this.request('POST', '/acap/v1/intents', envelope);
  }

  async getIntent(intentId: number) {
    return this.request('GET', `/acap/v1/intents/${intentId}`);
  }

  async cancelIntent(intentId: number) {
    return this.request('DELETE', `/acap/v1/intents/${intentId}`);
  }

  async respondToIntent(intentId: number, price: number, quantity?: number, deliveryDays?: number, message?: string) {
    return this.request('POST', `/acap/v1/intents/${intentId}/responses`, {
      price, quantity, delivery_days: deliveryDays, agent_message: message,
    });
  }

  async listResponses(intentId: number) {
    return this.request('GET', `/acap/v1/intents/${intentId}/responses`);
  }

  // ── ANP ──

  async createNegotiation(matchId: number, initialOffer?: number, quantity?: number) {
    const envelope = this.buildEnvelope('ANP', 'CREATE_NEGOTIATION', {
      match_id: matchId,
      initial_offer: initialOffer,
      quantity,
    });
    return this.request('POST', '/acap/v1/negotiations', envelope);
  }

  async getNegotiation(sessionCode: string) {
    return this.request('GET', `/acap/v1/negotiations/${sessionCode}`);
  }

  async submitOffer(sessionCode: string, price: number, quantity?: number, deliveryDays?: number) {
    const envelope = this.buildEnvelope('ANP', 'COUNTER_OFFER', {
      price, quantity, delivery_days: deliveryDays,
    });
    return this.request('POST', `/acap/v1/negotiations/${sessionCode}/offers`, envelope);
  }

  async acceptDeal(sessionCode: string) {
    return this.request('POST', `/acap/v1/negotiations/${sessionCode}/accept`);
  }

  async rejectDeal(sessionCode: string) {
    return this.request('POST', `/acap/v1/negotiations/${sessionCode}/reject`);
  }

  // ── ARP / AMP ──

  async getReputation(agentId: string) {
    return this.request('GET', `/acap/v1/reputation/${agentId}`);
  }

  async getBalance() {
    return this.request('GET', '/acap/v1/compute/balance');
  }

  // ── Messaging ──

  async sendMessage(receiverAgentId: string, content: string, messageType?: string) {
    return this.request('POST', '/acap/v1/messages', {
      receiver_agent_id: receiverAgentId, content, message_type: messageType || 'text',
    });
  }

  async getMessages(status?: string) {
    const params = status ? `?status=${status}` : '';
    return this.request('GET', `/acap/v1/messages${params}`);
  }
}
