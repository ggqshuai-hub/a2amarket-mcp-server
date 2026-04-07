# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-04-07

### Added
- SSE 传输模式（`--sse --port 3100`），支持远程部署
- CLI 参数：`--version` / `--help` / `--sse` / `--port` / `--debug` / `--locale`
- 参数运行时校验（Zod），所有 31 个 Tool 均有类型安全校验
- 错误信息中英双语（`--locale en` 或 `A2AMARKET_LOCALE=en`）
- 结构化错误返回（保留 ACAP error code / retry_after / details）
- 日志系统（`--debug` 模式输出详细请求日志到 stderr）
- 健康检查端点 `GET /health`（SSE 模式）
- 新增 2 个 MCP Tool：`get_negotiation_rounds`（议价历史）、`get_preferences`（查询偏好）
- `AcapError` 结构化错误类
- `buildEnvelope` 补充 `sender` 字段和 `auth.idempotency_key` 关联
- 环境变量 `A2AMARKET_AGENT_ID` 支持

### Fixed
- HMAC 签名格式从 hex 修正为 `hmac-sha256:{base64}`（对齐 ACAP 协议规范）
- 补充 `X-ACAP-Timestamp` 请求头
- `sendMessage` 子协议从 AMP（算力计量）修正为 MSG（消息）
- 4 个端点统一迁移到 `/acap/v1/` 前缀（`getSourcingStatus` / `listMatches` / `getOrderStatus` / `getReputation`）
- `update_supply` inputSchema 补齐缺失字段（title / category_l1 / category_l2 / moq / service_regions / keywords）
- 错误处理保留 HTTP 状态码和 ACAP 结构化错误信息（不再丢失）

### Changed
- Tool 数量从 29 → 31
- 版本号 0.2.0 → 0.3.0

## [0.2.0] - 2026-04-05

### Added
- 29 个 MCP Tools 完整实现
- ACAP 信封格式 + HMAC-SHA256 签名
- Stdio 传输模式
- npm 发布 `@hz-abyssal-heart/a2amarket-mcp-server`
- Cursor MCP 配置联调验证
