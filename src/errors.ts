/**
 * ACAP 错误码国际化映射
 */

const ERROR_MESSAGES: Record<string, { zh: string; en: string }> = {
  UNAUTHORIZED:             { zh: '认证失败，请检查 API Key', en: 'Authentication failed, check your API Key' },
  AGENT_NOT_FOUND:          { zh: 'Agent 不存在', en: 'Agent not found' },
  AGENT_SUSPENDED:          { zh: 'Agent 已被暂停', en: 'Agent is suspended' },
  INTENT_NOT_FOUND:         { zh: '意图不存在', en: 'Intent not found' },
  INTENT_EXPIRED:           { zh: '意图已过期', en: 'Intent has expired' },
  NEGOTIATION_NOT_FOUND:    { zh: '议价会话不存在', en: 'Negotiation session not found' },
  NEGOTIATION_FAILED:       { zh: '议价失败', en: 'Negotiation failed' },
  INSUFFICIENT_COMPUTE:     { zh: '算力余额不足', en: 'Insufficient compute points' },
  RATE_LIMITED:             { zh: '请求过于频繁，请稍后重试', en: 'Rate limited, please retry later' },
  IDEMPOTENCY_CONFLICT:     { zh: '重复请求（幂等键冲突）', en: 'Duplicate request (idempotency conflict)' },
  INVALID_SIGNATURE:        { zh: 'HMAC 签名验证失败', en: 'HMAC signature verification failed' },
  INVALID_PARAMETER:        { zh: '参数校验失败', en: 'Parameter validation failed' },
  SUPPLY_NOT_FOUND:         { zh: '供给商品不存在', en: 'Supply product not found' },
  SUBSCRIPTION_NOT_FOUND:   { zh: '订阅不存在', en: 'Subscription not found' },
  SETTLEMENT_NOT_FOUND:     { zh: '结算不存在', en: 'Settlement not found' },
};

let currentLocale: 'zh' | 'en' = 'zh';

export function setLocale(locale: string) {
  currentLocale = locale === 'en' ? 'en' : 'zh';
}

export function getLocale(): string {
  return currentLocale;
}

/**
 * 格式化错误信息（支持 AcapError 结构化错误）
 */
export function formatError(error: any): string {
  // 结构化 AcapError
  if (error.acapCode && ERROR_MESSAGES[error.acapCode]) {
    const msg = ERROR_MESSAGES[error.acapCode];
    const text = currentLocale === 'en' ? msg.en : msg.zh;
    const parts = [`[${error.acapCode}] ${text}`];
    if (error.httpStatus) parts.push(`(HTTP ${error.httpStatus})`);
    if (error.retryAfter) {
      const retryHint = currentLocale === 'en' ? `retry after ${error.retryAfter}s` : `${error.retryAfter}秒后重试`;
      parts.push(retryHint);
    }
    if (error.details) parts.push(JSON.stringify(error.details));
    return parts.join(' — ');
  }

  // Zod 校验错误
  if (error.name === 'ZodError' && error.issues) {
    const issues = error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ');
    const prefix = currentLocale === 'en' ? 'Parameter validation failed' : '参数校验失败';
    return `${prefix}: ${issues}`;
  }

  // 普通错误
  if (error.acapCode) {
    return `[${error.acapCode}] ${error.message}`;
  }

  return error.message || String(error);
}
