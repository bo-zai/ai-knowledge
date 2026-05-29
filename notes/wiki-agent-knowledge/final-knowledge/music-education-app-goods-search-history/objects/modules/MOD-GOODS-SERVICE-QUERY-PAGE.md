---
id: MOD-GOODS-SERVICE-QUERY-PAGE
type: MOD
status: fact
domain: mall
owner: knowledge-mvp
task_triggers:
  - 关键字搜索逻辑修改
  - 搜索历史触发条件修改
  - 商品列表排序修改
decision_points:
  - change_surface
  - implementation_plan
evidence_primary:
  - music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:112
  - music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:122
  - music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:125
stale_if:
  - GoodsService queryPageGoods changes
  - GoodsMapper selectByQuery changes
last_verified: 2026-05-19
---

# MOD-GOODS-SERVICE-QUERY-PAGE 商品列表查询服务

## Responsibility
### RSP-001 Owned Responsibility
- Claim: `GoodsService.queryPageGoods` 负责商品列表能力的主要业务编排，包括读取用户上下文、触发搜索历史写入、设定排序和上架状态、调用查询并补充价格信息。
- Owns:
  - `ThreadContextHolder.getUserId()`
  - 搜索历史触发条件
  - `req.setOrderByClause("p.create_time desc")`
  - `req.setOnSell(1)`
  - 调用 `goodsMapper.selectByQuery(req)`
- Does not own:
  - HTTP 认证
  - 搜索历史表时间戳实现细节

## Entry Points
### ENT-001 Entry Anchors
- Claim: 该方法由 `GoodsController.list` 调用，是商品列表搜索的主业务入口。
- Entry points:
  - `GoodsController.list`
- Callers:
  - `POST /goods/list`

## Change Guidance
### TCH-001 Touch When
- Claim: 只要需求改变搜索词如何生效、何时写历史、默认排序或列表增强逻辑，就应首先检查这个文件。
- Touch when:
  - change keyword-to-history condition
  - change default order
  - change on-sell default filter
  - change price enrichment behavior
- Why: 这些语义都集中在 `queryPageGoods`。

### NTC-001 Do Not Touch When
- Claim: 登录边界不是这个模块的职责，不能通过修改这里来绕过或替代 `LoginInterceptor`。
- Do not touch when:
  - changing authentication requirement
  - changing authorization header handling
- Use instead:
  - `CON-GOODS-LIST`
  - `LoginInterceptor`
- Expected failure if missing: Agent 可能在 service 层补登录兼容逻辑，破坏统一认证边界。

## Test Anchors
### TST-001 Related Tests
- Claim: 当前只有 `GoodsControllerTest.list` 可作为基础链路锚点，尚未提供对 `queryPageGoods` 关键分支的可见自动化保护。
- Test anchors:
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:37`
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:42`
- Missing coverage risks:
  - `keyword` 与 `keyType` 联动未验证
  - 搜索历史写入未验证
  - 写历史与查结果条件分歧未验证

## Evidence
### EVD-001 Module Evidence
- Claim: 该方法同时控制历史写入、排序、上架过滤和查询调用。
- Source:
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:112`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:114`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:116`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:122`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:125`
