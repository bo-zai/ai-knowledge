---
id: MOD-SEARCH-HISTORY-SERVICE-SAVE
type: MOD
status: fact
domain: mall
owner: knowledge-mvp
task_triggers:
  - 搜索历史落库逻辑修改
  - 时间戳处理修改
decision_points:
  - change_surface
evidence_primary:
  - music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:18
  - music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:20
  - music-education-app/src/main/resources/mappers/SearchHistoryMapper.xml:37
stale_if:
  - SearchHistoryService save changes
  - SearchHistoryMapper insertSelective changes
last_verified: 2026-05-19
---

# MOD-SEARCH-HISTORY-SERVICE-SAVE 搜索历史保存服务

## Responsibility
### RSP-001 Owned Responsibility
- Claim: `SearchHistoryService.save` 只负责给 `SearchHistoryDO` 补 `addTime`、`updateTime` 并调用 `insertSelective` 落库。
- Owns:
  - `addTime`
  - `updateTime`
  - `insertSelective`
- Does not own:
  - 是否应该写入历史
  - `keyword`、`userId`、`from` 的生成条件

## Entry Points
### ENT-001 Entry Anchors
- Claim: 当前可见调用方是 `GoodsService.queryPageGoods`。
- Entry points:
  - `GoodsService.queryPageGoods`
- Callers:
  - 商品列表搜索流程

## Change Guidance
### TCH-001 Touch When
- Claim: 只有当持久化字段、时间戳规则或 mapper 调用方式变化时，才应优先修改这个文件。
- Touch when:
  - change persistence timestamps
  - change insert method
  - change logical delete defaults
- Why: 这是搜索历史的窄持久化边界。

### NTC-001 Do Not Touch When
- Claim: 改搜索词触发条件时不应先改这个文件，应改 `GoodsService.queryPageGoods`。
- Do not touch when:
  - changing keyword gating
  - changing login gating
- Use instead:
  - `MOD-GOODS-SERVICE-QUERY-PAGE`
- Expected failure if missing: Agent 可能把业务条件变更错误地下沉到持久化服务，导致职责边界混乱。

## Test Anchors
### TST-001 Related Tests
- Claim: 当前没有可见的专门自动化测试覆盖这个保存服务。
- Test anchors:
  - none visible
- Missing coverage risks:
  - 时间戳规则变更无保护
  - 去重或更新策略变化无保护

## Evidence
### EVD-001 Module Evidence
- Claim: 该服务只补时间并调用 mapper。
- Source:
  - `music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:18`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:19`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:20`
  - `music-education-app/src/main/resources/mappers/SearchHistoryMapper.xml:37`
