---
id: MOD-GOODS-CONTROLLER-LIST
type: MOD
status: fact
domain: mall
owner: knowledge-mvp
task_triggers:
  - /goods/list controller 改动
  - 商品列表入参变更
decision_points:
  - change_surface
evidence_primary:
  - music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:39
  - music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:41
stale_if:
  - GoodsController list method changes
last_verified: 2026-05-19
---

# MOD-GOODS-CONTROLLER-LIST 商品列表控制器入口

## Responsibility
### RSP-001 Owned Responsibility
- Claim: `GoodsController.list` 的职责是接收 `/goods/list` 请求并把 `GoodsQuery` 转交给 `goodsService.queryPageGoods`。
- Owns:
  - HTTP 路由 `/goods/list`
  - 请求体绑定
  - `CommonResult.success` 包装
- Does not own:
  - 登录认证
  - 搜索历史写入条件
  - SQL 过滤逻辑

## Entry Points
### ENT-001 Entry Anchors
- Claim: 该方法是商品列表能力的唯一直接 HTTP 入口。
- Entry points:
  - `POST /goods/list`
- Callers:
  - app 客户端

## Change Guidance
### TCH-001 Touch When
- Claim: 只有当路由、入参校验或返回包装变化时，才应优先修改这个文件。
- Touch when:
  - endpoint path changes
  - request body type changes
  - response envelope changes
- Why: controller 只承载接口入口，不应吸收业务语义。

### NTC-001 Do Not Touch When
- Claim: 搜索条件、历史写入和排序变化不应首先改 controller，应优先改 `GoodsService` 或 `GoodsMapper.xml`。
- Do not touch when:
  - changing keyword semantics
  - changing search-history trigger
  - changing SQL filter or sorting
- Use instead:
  - `MOD-GOODS-SERVICE-QUERY-PAGE`
  - `CON-GOODS-LIST`
- Expected failure if missing: Agent 容易把“改入口”和“改业务”混在一起，导致 controller 膨胀。

## Test Anchors
### TST-001 Related Tests
- Claim: `GoodsControllerTest.list` 是当前可见的基础调用测试锚点。
- Test anchors:
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:37`
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:42`
- Missing coverage risks:
  - 没有覆盖关键字语义
  - 没有覆盖搜索历史写入

## Evidence
### EVD-001 Module Evidence
- Claim: controller 方法只做转发。
- Source:
  - `music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:39`
  - `music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:41`
