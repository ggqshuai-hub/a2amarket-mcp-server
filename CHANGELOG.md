# Changelog

All notable changes to this project will be documented in this file.

## [0.3.5] - 2026-04-10

### Changed
- SKILL.md 从 200 行精简到 117 行（渐进披露）
- REST fallback 指南拆到独立 `rest-fallback.md`（含完整端点映射表）
- Setup 配置流程拆到独立 `setup.md`
- description 新增"Do NOT use for non-commerce tasks"负面触发限定
- frontmatter 新增 `allowed-tools: mcp__a2amarket__*` 权限收窄

### Added
- `rest-fallback.md` — MCP 不可用时的 REST API 完整指南（23 个端点映射）
- `setup.md` — OpenClaw / Cursor / Claude Desktop 配置指南
- `scripts/check.sh` — 独立连通性检查脚本（不依赖 Node.js MCP Server）
- `tests/eval-skill.mjs` — 19 个 Skill eval 测试用例（含 3 个反模式检测）

## [0.3.4] - 2026-04-10

### Changed
- 重写全部 47 个 tool 的 description：只说"做什么+参数+返回什么+下一步调什么"，删除所有内部实现细节和"禁止"指令
- 重写 SKILL.md：友好引导（官网/开发者平台链接）+ 三步上手 + REST fallback 指南
- 重写 README.md：删除"给 AI 必读"恐吓段落，新增完整工具表格和 REST API 章节
- 精简 `--help` 输出：删除"生产集成契约"大段文字
- 仓库地址从 Gitee 迁移到 GitHub

### Added
- `--check` 预检查命令：验证 API Key 有效性和网络连通性，不启动 MCP Server
- SKILL.md 新增"如果 MCP 工具不可用"章节：REST API fallback 指南（解决国产 AI 客户端不支持 MCP 的问题）

### Fixed
- `get_balance` description 不再暴露内部 HTTP 路径（这是导致 LLM 自行拼接 REST 请求的根因）

### Housekeeping
- 删除仓库中的旧版 .tgz 打包产物
- 测试文件移入 tests/ 目录
- .gitignore 新增 *.tgz 规则

## [0.3.3] - 2026-04-09

### Fixed
- `verify_email` 字段名对齐后端：`email`+`code` → `agent_id`+`verification_token`（对齐 `AcapAgentController.verifyEmail`）。
- `registerAgent` 字段名 camelCase→snake_case：后端全局 Jackson `SNAKE_CASE`，MCP 发送的 `agentName` 等字段后端无法反序列化，现已转换为 `agent_name`/`agent_type`/`contact_email`/`endpoint_url`。
- `updateProfile` 同上，camelCase→snake_case 字段映射修复。
- `index.ts` / `acap-client.ts` 头部注释版本号和 Tool 数量对齐（去除硬编码版本号，Tool 数量更正为 47）。
- Skill 文档（SKILL.md / reference.md / examples.md）中 `verify_email` 参数描述和注册流程示例同步修正。

## [0.3.2] - 2026-04-09

### Fixed / Docs
- `--help` 按生产视角重写：产品边界、集成契约、ACAP vs 买家 REST、认证头说明、环境变量语义（`A2AMARKET_BASE_URL` 非「公开 REST 目录」）；默认 `BASE_URL` 为 `https://agent.a2amarket.md`。
- README、Skill：同上主题的文档补强；Skill 元数据版本对齐。
- `get_balance` 工具 description 增强，避免 AI 客户端绕过 MCP 自行 HTTP。

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
