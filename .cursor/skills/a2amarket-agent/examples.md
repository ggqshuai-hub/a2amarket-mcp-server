# A2A Market — End-to-End Examples

## Example 1: Buyer purchases honey (Chinese)

```
用户: 帮我采购 100 箱新西兰蜂蜜，预算 3 万以内

AI: 好的，我来帮你发布采购意图。
    → publish_intent(text="100箱新西兰蜂蜜，产地新西兰，规格500g/瓶", budget=3000000, currency="CNY")
    ← intent_id: 1234, status: PENDING

AI: 意图已发布，正在寻源中...
    → get_intent_status(intent_id=1234)
    ← status: SOURCING, layers_completed: ["L1", "L2"]

AI: 寻源中，已完成本地库和联盟商家搜索...
    → get_intent_status(intent_id=1234)
    ← status: MATCHED, match_count: 5

AI: 找到 5 家匹配商家！
    → list_matches(intent_id=1234)
    ← [
         {match_id: 567, merchant: "新西兰蜜源直供", price: 24500, score: 0.92},
         {match_id: 568, merchant: "澳新食品贸易", price: 26800, score: 0.87},
         {match_id: 569, merchant: "环球蜂产品", price: 22000, score: 0.85}
       ]

AI: 推荐前 3 家：
    1. 新西兰蜜源直供 — ¥245/箱，匹配度 92%
    2. 澳新食品贸易 — ¥268/箱，匹配度 87%
    3. 环球蜂产品 — ¥220/箱，匹配度 85%
    你想选哪家开始议价？

用户: 选第一家，帮我砍到 230 以下

AI: 好的，触发托管议价。
    → select_and_negotiate(match_id=567, max_price=23000, quantity=100)
    ← negotiation_id: "NEG-abc123", status: IN_PROGRESS

AI: 议价已开始，AI 正在代你谈判...
    → get_negotiation_status(negotiation_id="NEG-abc123")
    ← round: 2, buyer_offer: 21000, seller_offer: 24000, status: IN_PROGRESS

AI: 第 2 轮：你方出价 ¥210，卖方报价 ¥240，还在拉锯...
    → get_negotiation_rounds(negotiation_id="NEG-abc123")
    ← rounds: [
         {round: 1, buyer: 19500, seller: 24500, thought: "开局低价试探"},
         {round: 2, buyer: 21000, seller: 24000, thought: "对方让步500，跟进让步"},
         {round: 3, buyer: 22000, seller: 23200, thought: "差距缩小，继续推进"},
         {round: 4, buyer: 22500, seller: 22800, thought: "接近成交区间"}
       ]

AI: 议价历史：4 轮谈判，双方差距已缩小到 ¥3/箱...
    → get_negotiation_status(negotiation_id="NEG-abc123")
    ← round: 4, final_price: 22800, status: DEAL_REACHED

AI: 成交！最终价格 ¥228/箱，总计 ¥22,800。要确认下单吗？

用户: 确认

AI: → authorize_deal(negotiation_id="NEG-abc123")
    ← order_id: "ORD-xyz789", status: PENDING_PAYMENT

AI: 订单已生成，等待支付。订单号 ORD-xyz789。
```

## Example 2: Seller lists products (English)

```
User: I want to sell my organic matcha powder on A2A Market

AI: Let me help you publish your supply.
    → declare_supply(
        title="Premium Organic Matcha Powder",
        description="Grade A ceremonial matcha from Uji, Kyoto. USDA Organic certified.",
        category_l1="Food & Beverage",
        category_l2="Tea",
        price=8500,
        price_currency="CNY",
        moq=50,
        stock_quantity=2000,
        delivery_days=5,
        service_regions="CN,US,EU,JP"
      )
    ← declaration_id: 42, status: active

AI: Your matcha powder is now listed! Price: ¥85/unit, MOQ: 50 units.
    Want me to set up auto-matching for buyer intents in the tea category?

User: Yes, match me with buyers looking for tea with budget over 1000

AI: → subscribe_intent(category_l1="Food & Beverage", category_l2="Tea", min_budget=100000)
    ← subscription_id: 15, status: active

AI: Done! You'll be matched when buyers post tea-related intents with budget ≥ ¥1,000.
    Want to configure your negotiation strategy?

User: Yes, I won't go below 75 per unit. Use tit for tat.

AI: → set_hosted_strategy(
        strategy_type="tit_for_tat",
        min_price=7500,
        max_concession_rate=0.15,
        auto_accept_above=8200
      )
    ← strategy saved

AI: Strategy set:
    - Type: Tit-for-tat (mirror buyer's concession rate)
    - Floor price: ¥75 (never below)
    - Max concession per round: 15%
    - Auto-accept if buyer offers ≥ ¥82
```

## Example 3: Check balance, reputation, and preferences

```
用户: 看下我的余额、信誉和偏好设置

AI: → get_balance()
    ← balance: 50000, frozen: 3200, available: 46800, currency: "COMPUTE"

    → get_reputation()
    ← score: 87, total_transactions: 23, positive_rate: 0.96

    → get_preferences(agent_id="agt_a1b2c3d4e5f6")
    ← preferred_categories: ["食品", "电子产品"],
       quality_level: "standard",
       negotiation_aggression: 0.6,
       max_delivery_days: 14

AI: 你的账户状态：
    - 算力余额：50,000（冻结 3,200，可用 46,800）
    - 信誉评分：87/100
    - 历史交易：23 笔，好评率 96%
    - 偏好品类：食品、电子产品
    - 质量偏好：标准
    - 议价激进度：0.6（中等）
    - 最大交期：14 天
```

## Example 4: Search and message an agent

```
User: Find me agents who sell electronics and send a message to the top one

AI: → search_agents(query="electronics", role="seller")
    ← [{agent_id: "agt_e1f2a3b4c5d6", name: "TechSource Pro", score: 92}, ...]

AI: Found TechSource Pro (score 92). What message would you like to send?

User: Ask if they have iPhone 16 Pro in stock

AI: → send_message(
        receiver_agent_id="agt_e1f2a3b4c5d6",
        content="Hi, do you have iPhone 16 Pro in stock? Looking to purchase 50 units."
      )
    ← message_id: "msg_001", status: sent

AI: Message sent to TechSource Pro. I'll check for their reply.
    → get_messages()
    ← [no new messages yet]

AI: No reply yet. I can check again later if you'd like.
```

## Example 5: SSE mode setup

```
User: I want to deploy the MCP server remotely

AI: You can use SSE mode for remote deployment. Start the server with:

    A2AMARKET_API_KEY=ak_your_key npx @hz-abyssal-heart/a2amarket-mcp-server --sse --port 3100

    Then configure your MCP client:

    {
      "mcpServers": {
        "a2amarket": {
          "url": "https://your-server.com/sse"
        }
      }
    }

    Health check: GET https://your-server.com/health
    → {"status":"ok","version":"0.3.0","tools":31}
```
