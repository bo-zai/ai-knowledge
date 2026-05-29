---
id: CON-GOODS-LIST
type: CON
status: fact
domain: mall
owner: knowledge-mvp
task_triggers:
  - /goods/list
  - 商品列表查询
  - 关键字搜索
decision_points:
  - boundary_decision
  - contract_mapping
evidence_primary:
  - music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:39
  - music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:41
  - music-education-app/src/main/resources/mappers/GoodsMapper.xml:81
  - music-education-app/src/main/resources/mappers/GoodsMapper.xml:89
  - music-education-app/src/main/resources/mappers/GoodsMapper.xml:99
evidence_secondary:
  - music-education-app/src/main/java/com/education/music/app/config/WebConfig.java:25
  - music-education-app/src/main/java/com/education/music/app/interceptor/LoginInterceptor.java:38
  - music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:36
  - music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:38
  - music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:40
stale_if:
  - GoodsController list endpoint changes
  - GoodsMapper selectByQuery conditions change
  - login interceptor or web config changes
last_verified: 2026-05-19
---

# CON-GOODS-LIST 商品列表接口契约

## Purpose
### PUR-001 Contract Purpose
- Claim: `/goods/list` 负责接收商品列表查询请求，并返回分页商品结果。
- Producer: 客户端
- Consumer: `GoodsController.list`

## Required Fields
### FLD-001 Supported Inputs
- Claim: 当前查询支持分页字段 `lastId`、`pageSize`，以及 `keyword`、`keyType`、`categoryId`、`categoryIds`、`isHot` 等筛选字段。
- Supported fields:
  - `lastId`
  - `pageSize`
  - `keyword`
  - `keyType`
  - `categoryId`
  - `categoryIds`
  - `isHot`
- Field semantics:
  - `keyword` 与 `keyType` 联动
  - `pageSize` 控制 `LIMIT`
  - `lastId` 控制向前翻页
- Validation rules: 请求模型存在最小值约束，但 `pageSize` 和 `lastId` 的 `@NotNull` 已被注释掉。

## Delivery Semantics
### DLV-001 Login And Query Behavior
- Claim: `/goods/list` 在运行时要求登录，且查询会强制附加 `p.on_sell = 1`、`p.deleted = 0`、`m.is_disable = 0`，默认按 `p.create_time desc` 排序。
- Idempotency key: none
- Ordering: `ORDER BY ${orderByClause}`，当前服务侧默认设为 `p.create_time desc`
- Retry: none
- Timeout: none

### DLV-002 Keyword Gate
- Claim: 只有在 `keyType == 1` 时，`keyword` 才会作用于 `p.name like CONCAT('%',#{keyword},'%')`。
- Idempotency key: none
- Ordering: not applicable
- Retry: not applicable
- Timeout: not applicable

## Error Semantics
### ERR-001 Login Boundary
- Claim: 缺少或无效 `authorization` header 时，请求在 `LoginInterceptor` 被拦截并返回 `NO_LOGIN`，不会进入 controller/service。
- Upstream status meanings: 空 token 或非法 token
- Internal mapping: `CommonResult.error(ErrorCode.NO_LOGIN)`
- Expected failure if missing: Agent 可能把 `/goods/list` 误当成匿名接口，进而误判 `userId` 和搜索历史的写入条件。

## Decision Use
### USE-001 Planning Impact
- Claim: 任何对关键字搜索、分页或搜索历史的需求变更，都必须同时检查接口登录边界和 SQL 条件。
- Affects decisions:
  - 是否要改 `WebConfig` / `LoginInterceptor`
  - 是否要改 `GoodsMapper.xml`
  - 是否需要补登录场景测试

## Evidence
### EVD-001 Contract Evidence
- Claim: 接口入口、登录边界和 SQL 条件分散在 controller、web config、interceptor 和 mapper。
- Source:
  - `music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:39`
  - `music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:41`
  - `music-education-app/src/main/java/com/education/music/app/config/WebConfig.java:25`
  - `music-education-app/src/main/java/com/education/music/app/interceptor/LoginInterceptor.java:38`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:81`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:89`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:90`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:99`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:102`
