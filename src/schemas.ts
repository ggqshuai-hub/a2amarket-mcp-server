/**
 * MCP Tool 参数的 Zod 运行时校验 schemas
 */

import { z } from 'zod';

// ═══ Agent 身份管理 ═══

export const RegisterAgentSchema = z.object({
  handle: z.string().min(1).regex(/^[a-zA-Z0-9-]+$/, 'handle 只允许英文+数字+连字符'),
  agent_name: z.string().min(1),
  agent_type: z.enum(['BUYER', 'SELLER']),
  contact_email: z.string().email(),
  endpoint_url: z.string().url().optional(),
});

export const GetProfileSchema = z.object({
  agent_id: z.string().min(1),
});

export const UpdateProfileSchema = z.object({
  agent_id: z.string().min(1),
  agent_name: z.string().optional(),
  endpoint_url: z.string().url().optional(),
  capabilities: z.string().optional(),
});

export const SearchAgentsSchema = z.object({
  query: z.string().optional(),
  role: z.enum(['buyer', 'seller']).optional(),
});

// ═══ 买家 — 意图 ═══

export const PublishIntentSchema = z.object({
  text: z.string().min(1, '采购需求不能为空'),
  budget: z.number().positive().optional(),
  currency: z.string().default('CNY'),
});

export const IntentIdSchema = z.object({
  intent_id: z.number().int().positive(),
});

// ═══ 买家 — 议价与结算 ═══

export const SelectAndNegotiateSchema = z.object({
  match_id: z.number().int().positive(),
  max_price: z.number().positive().optional(),
  quantity: z.number().int().positive().optional(),
});

export const NegotiationIdSchema = z.object({
  negotiation_id: z.string().min(1),
});

export const SessionIdSchema = z.object({
  session_id: z.string().min(1),
});

// ═══ 买家 — 偏好 ═══

export const SetPreferencesSchema = z.object({
  agent_id: z.string().min(1),
  preferred_categories: z.array(z.string()).optional(),
  preferred_regions: z.array(z.string()).optional(),
  default_budget_max: z.number().positive().optional(),
  quality_level: z.enum(['economy', 'standard', 'premium']).optional(),
  negotiation_aggression: z.number().min(0).max(1).optional(),
  max_delivery_days: z.number().int().positive().optional(),
  auto_authorize: z.boolean().optional(),
});

// ═══ 卖家 — 供给 ═══

export const DeclareSupplySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category_l1: z.string().optional(),
  category_l2: z.string().optional(),
  price: z.number().positive(),
  price_currency: z.string().optional(),
  moq: z.number().int().positive().optional(),
  stock_quantity: z.number().int().nonnegative().optional(),
  delivery_days: z.number().int().positive().optional(),
  service_regions: z.string().optional(),
  image_url: z.string().url().optional(),
  keywords: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
});

export const UpdateSupplySchema = z.object({
  declaration_id: z.number().int().positive(),
  title: z.string().optional(),
  description: z.string().optional(),
  category_l1: z.string().optional(),
  category_l2: z.string().optional(),
  price_min: z.number().positive().optional(),
  price_max: z.number().positive().optional(),
  moq: z.number().int().positive().optional(),
  delivery_days: z.number().int().positive().optional(),
  service_regions: z.string().optional(),
  keywords: z.string().optional(),
});

// ═══ 卖家 — 订阅 ═══

export const SubscribeIntentSchema = z.object({
  category_l1: z.string().optional(),
  category_l2: z.string().optional(),
  min_budget: z.number().nonnegative().optional(),
  max_budget: z.number().positive().optional(),
  regions: z.string().optional(),
});

export const UnsubscribeSchema = z.object({
  subscription_id: z.number().int().positive(),
});

export const PaginationSchema = z.object({
  page: z.number().int().positive().optional(),
  page_size: z.number().int().min(1).max(50).optional(),
});

// ═══ 卖家 — 托管策略 ═══

export const SetHostedStrategySchema = z.object({
  strategy_type: z.enum(['linear_concession', 'tit_for_tat', 'time_decay']),
  min_price: z.number().positive().optional(),
  max_concession_rate: z.number().min(0).max(1).optional(),
  auto_accept_above: z.number().positive().optional(),
});

// ═══ 通用 ═══

export const AgentIdSchema = z.object({
  agent_id: z.string().min(1),
});

export const SendMessageSchema = z.object({
  receiver_agent_id: z.string().min(1),
  content: z.string().min(1),
  message_type: z.string().optional(),
});

export const GetMessagesSchema = z.object({
  status: z.string().optional(),
});
