# A2A Market MCP Server — 待办事项

> 更新日期: 2026-04-07

---

## 已完成 ✅

### 海外服务器基础设施

- 海外服务器域名自动代理 + SSL 自动代理
- 域名解析：a2amarket.md / api.a2amarket.md / agent.a2amarket.md / dev.a2amarket.md
- 域名重定向：a2amarket.xin / a2amarket.fashion / aimarket.md / a2amarket.online
- FastReal 域名重定向：fastreal.md / fastreal.store / fastreal.online / fastreal.shop

### 寻源数据中台

- 部署独立寻源服务（sourcing-api / worker / beat）
- 配置独立 PostgreSQL + pgvector 向量数据库
- 24 小时自动寻源 + 自动解析
- 寻源后自动发送邮件邀请入驻 a2amarket.md
- 寻源结果存储在独立 Python 向量数据库，供 A2A Market 使用

### Python Agent Server

- 部署独立 Agent 服务（:9906）
- 支持买家/卖家招投标小黑屋模式议价
- 独立部署，内网提供给 A2A Market 使用，外部不直接访问

### FastReal 主站（海外）

- 部署海外 FastReal 数据库所有 2.0 DDL 脚本
- 德国服务器部署 FastReal Server 2.0
- 海外域名重定向验证完成
- 海外 Web 端全量测试完成，支持 2.0 版本服务器生图

### A2A Market Java Server（海外）

- 核心业务 Java 服务已在德国服务器部署
- 同步创建 aiMarket 数据库所有信息
- 配置海外知识库对应体系

### A2A Market Web 客户端（海外）

- 核心业务已部署：[https://a2amarket.md/](https://a2amarket.md/)

### 开发者门户（海外）

- 核心业务已部署：[https://dev.a2amarket.md/](https://dev.a2amarket.md/)
- 支持基本登录、控制台系列操作

### MCP Server 发布

- MCP Server 构建 + 本地验证（29 Tools）
- 注册 npm 官号，发布 `@hz-abyssal-heart/a2amarket-mcp-server@0.2.0`
- npm 包地址：[https://www.npmjs.com/package/@hz-abyssal-heart/a2amarket-mcp-server](https://www.npmjs.com/package/@hz-abyssal-heart/a2amarket-mcp-server)
- Cursor MCP 配置 + 联调验证
- 测试 API Key 创建

### Skill 发布

- Skill 编写（SKILL.md + reference.md + examples.md）
- 注册 ClawHub 官号，发布 `a2amarket-agent@0.2.1`
- Skills 包地址：[https://clawhub.ai/skills/a2amarket-agent](https://clawhub.ai/skills/a2amarket-agent)

### MCP Server v0.3.0 升级

- 修复 HMAC 签名格式（hex → `hmac-sha256:{base64}`）+ 补充 `X-ACAP-Timestamp`
- 修复 `sendMessage` 子协议（AMP → MSG）
- 统一 4 个端点到 `/acap/v1/` 前缀（getSourcingStatus / listMatches / getOrderStatus / getReputation）
- 补充 `buildEnvelope` 的 sender 字段 + 幂等键关联
- SSE 传输模式（`--sse --port 3100`）
- CLI 参数（`--version` / `--help` / `--sse` / `--port` / `--debug` / `--locale`）
- 结构化错误返回（AcapError 类，保留 ACAP error code / retry_after）
- 参数 Zod 运行时校验（31 个 Tool 全覆盖）
- 错误信息中英双语（`--locale en` 或 `A2AMARKET_LOCALE=en`）
- 新增 2 个 MCP Tool：`get_negotiation_rounds` + `get_preferences`
- `update_supply` inputSchema 补齐缺失字段
- 日志系统（`--debug` 模式）
- 添加 `CHANGELOG.md`
- README / SKILL.md / reference.md / examples.md 全部同步到 v0.3.0

---

## 待办 📋

### 海外部署遗留

- Web 客户端页面未完全同步、一键对接信息未更新
- 开发者门户内容 check，完善 Agent 管理和 Token 消耗展示
- 寻源覆盖率提升（当前 ACP/UCP/A2A 早期，可扫描到的 Agent 不多）

### AgentAuthFilter JWT 双认证

- 修复开发者平台 /acap/v1/ 端点 JWT 认证（代码已改，待重新构建部署）
- 开发者平台"API Key 管理"页面（/acap/v1/agents/mine 端点缺失，需补后端接口）
- 开发者平台"一键复制 MCP 配置"功能（注册 Agent 后直接给出 JSON）

### Skill 多平台发布

- ClawHub 安全标记申诉（GitHub issue）
- SkillHub 发布
- Smithery 发布（[https://smithery.ai）](https://smithery.ai）)
- Glama 发布（[https://glama.ai/mcp/servers）](https://glama.ai/mcp/servers）)
- MCP.so 收录（[https://mcp.so）](https://mcp.so）)
- PulseMCP 收录（[https://pulsemcp.com）](https://pulsemcp.com）)

### Skill 优化

- `a2amarket-lite` 纯知识型 Skill（零配置，不依赖 MCP Server，仅公开端点）
- Skill frontmatter 适配各平台差异格式
- 补充更多端到端示例（退款流程、批量采购、多轮议价失败重试）
- 简化 Skill 调用链路，探索绕过 MCP 验证的轻量方案

### MCP Server 优化

- ~~支持 SSE 传输模式（当前仅 Stdio，远程部署场景需要 SSE）~~ ✅ v0.3.0
- ~~添加 `--version` / `--help` CLI 参数~~ ✅ v0.3.0
- ~~错误信息国际化（中英双语）~~ ✅ v0.3.0
- ~~npm 包添加 `CHANGELOG.md`~~ ✅ v0.3.0

### 文档

- npm README 补充中文说明
- 各 Skill 平台的 listing 描述优化（SEO 关键词）
- A2A Market 官方文档站添加 MCP 接入指南

### Product Hunt Launch

- 前置：修复开发者平台 JWT 双认证（控制台完整可用）
- 前置：准备英文 Landing Page（a2amarket.md 或独立页）
- 录制 Demo 视频（Cursor + MCP 完整采购流程，60s 内）
- 准备 PH 素材（Logo 240x240 / Gallery 1270x760 × 5 张 / Tagline / Description）
- Tagline 草案：Tell your AI what you want. It finds, negotiates, and buys — autonomously.
- 找 Hunter（有粉丝的 PH 用户帮提交，提高首日曝光）
- 选择发布日（避开周一/周五，周二~周四最佳）
- 发布时间：北京时间 15:00-16:00（太平洋时间 00:00 刷新）
- 准备 Maker Comment（首条评论，讲清楚为什么做、怎么用、路线图）
- 社交媒体同步宣发（Twitter/X、即刻、V2EX、Hacker News）

