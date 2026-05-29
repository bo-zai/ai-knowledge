---
id: OWN-GOODS-SEARCH-HISTORY-WRITE
type: OWN
status: fact
domain: mall
owner: knowledge-mvp
task_triggers:
  - 搜索历史写入
  - 搜索词落库
  - keyType 修改
decision_points:
  - source_of_truth
  - write_boundary
evidence_primary:
  - music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:114
  - music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:122
  - music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:18
  - music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:20
evidence_secondary:
  - music-education-app/src/main/java/com/education/music/app/interceptor/LoginInterceptor.java:69
  - music-education-app/src/main/java/com/education/music/app/config/WebConfig.java:25
stale_if:
  - GoodsService queryPageGoods write path changes
  - SearchHistoryService save logic changes
  - LoginInterceptor behavior changes
last_verified: 2026-05-19
---

# OWN-GOODS-SEARCH-HISTORY-WRITE 搜索历史写入归属

## Ownership Statement
### OWN-001 Source Of Truth
- Claim: 是否创建搜索历史记录由 `GoodsService.queryPageGoods` 决定，`SearchHistoryService` 只负责补时间并持久化。
- Subject: `mall_search_history` 写入触发条件
- Source of truth: `GoodsService.queryPageGoods`
- Scope: `/goods/list` 调用路径

## Allowed Writes
### WRT-001 Internal Writable Fields
- Claim: `GoodsService` 负责写入 `keyword`、`userId`、`from`，`SearchHistoryService` 负责写入 `addTime`、`updateTime`。
- Writable fields:
  - `keyword`
  - `userId`
  - `from`
  - `addTime`
  - `updateTime`
- Preconditions: `userId != null` 且 `keyword` 非空白

## Forbidden Writes
### FRB-001 Forbidden Update
- Claim: 不能把“是否写历史”的判断下沉到 `SearchHistoryService` 或 SQL 层，因为当前业务条件由 `GoodsService.queryPageGoods` 持有。
- Forbidden updates:
  - 在 mapper 层自行判断是否写历史
  - 只改 `SearchHistoryService` 就试图改变写入触发条件
- Why: 当前写入条件与查询过滤条件并不一致，贸然下沉会隐藏业务语义差异。
- Expected failure if missing: Agent 可能把改动错误地局限在落库层，遗漏真正的触发条件文件。

## Precedence
### PRC-001 Conflict Resolution
- Claim: 对 `/goods/list` 来说，登录拦截先于业务服务执行；登录失败时不会进入写历史分支。
- Precedence rule: `LoginInterceptor -> GoodsController -> GoodsService -> SearchHistoryService`
- Example: 缺少 `authorization` header 时，返回 `NO_LOGIN`，不会创建任何搜索历史。

## Evidence
### EVD-001 Ownership Evidence
- Claim: `GoodsService` 设定字段并调用 `searchHistoryService.save`，`SearchHistoryService` 再执行时间戳与 `insertSelective`。
- Source:
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:114`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:119`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:120`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:121`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:122`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:18`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:20`
