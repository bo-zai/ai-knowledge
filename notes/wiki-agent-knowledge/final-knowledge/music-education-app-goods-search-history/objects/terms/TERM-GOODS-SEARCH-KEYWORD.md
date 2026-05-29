---
id: TERM-GOODS-SEARCH-KEYWORD
type: TERM
status: fact
domain: mall
owner: knowledge-mvp
task_triggers:
  - 商品搜索
  - keyword 搜索
  - 搜索历史
decision_points:
  - term_grounding
  - contract_mapping
evidence_primary:
  - music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:36
  - music-education-app/src/main/resources/mappers/GoodsMapper.xml:89
  - music-education-app/src/main/resources/mappers/GoodsMapper.xml:90
evidence_secondary:
  - music-education-core/src/main/java/com/education/music/core/DO/mall/GoodsDO.java:33
stale_if:
  - CommonPage keyword or keyType fields change
  - GoodsMapper keyword filter changes
last_verified: 2026-05-19
---

# TERM-GOODS-SEARCH-KEYWORD 商品搜索关键字

## Core Meaning
### DEF-001 Canonical Definition
- Claim: 在 `/goods/list` 中，`keyword` 是 `GoodsQuery` 继承自 `CommonPage` 的请求字段，只有当 `keyType == 1` 时才会参与商品名过滤。
- Business definition: 这是商品列表查询的运行时搜索词，不是任意商品元数据字段的别名。
- Applies in: `POST /goods/list`
- Not used for: 不能直接等同于商品表中的 `keywords` 字段。

## Distinctions
### DIF-001 Not Equal To
- Claim: 当前运行时搜索不会直接按 `GoodsDO.keywords` 过滤。
- Not equal to: `mall_goods.keywords`
- Why: SQL 只在 `keyType == 1` 时执行 `p.name like CONCAT('%',#{keyword},'%')`
- Counterexample: 仅修改商品 `keywords` 字段而不改 `name`，不会改变当前搜索结果。

### DIF-002 Boundary Example
- Claim: 提交 `keyword` 但未提供 `keyType == 1` 时，请求仍可成功，但不会触发商品名过滤。
- Positive example: `keyword=钢琴` 且 `keyType=1`
- Negative example: `keyword=钢琴` 且 `keyType=null`

## Decision Use
### USE-001 Requirement Interpretation
- Claim: 任何“关键字搜索”相关需求都必须同时检查 `keyword` 和 `keyType` 的联动语义。
- Affects decisions: 请求建模、SQL 修改、测试用例设计
- Expected failure if missing: Agent 可能误把 `keyword` 当成总会生效的过滤条件，或误把 `GoodsDO.keywords` 当成运行时过滤字段。

## Evidence
### EVD-001 Primary Evidence
- Claim: `keyType`、`keyword` 定义在 `CommonPage`，运行时 SQL 在 `keyType == 1` 时按 `p.name` 过滤。
- Source:
  - `music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:36`
  - `music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:38`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:89`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:90`

## Freshness
### STL-001 Refresh Trigger
- Claim: 只要搜索请求模型或 `GoodsMapper.xml` 的关键字过滤分支变化，就必须复核这条术语定义。
- Must recheck when:
  - `CommonPage.java`
  - `GoodsQuery.java`
  - `GoodsMapper.xml`
