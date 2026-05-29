---
id: OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE
type: OPEN
status: open-question
domain: mall
owner: knowledge-mvp
task_triggers:
  - keyword 需求
  - 搜索历史需求
  - keyType 语义变更
decision_points:
  - escalation
evidence_primary:
  - music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:116
  - music-education-app/src/main/resources/mappers/GoodsMapper.xml:89
  - music-education-app/src/main/resources/mappers/GoodsMapper.xml:90
stale_if:
  - GoodsService queryPageGoods write condition changes
  - GoodsMapper keyword SQL changes
last_verified: 2026-05-19
---

# OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE 关键字写历史与查结果条件分歧

## Unknown
### UNK-001 Unknown Statement
- Claim: 当前代码会在 `keyword` 非空时写搜索历史，但只有 `keyType == 1` 时才按关键字过滤商品名；这是否是有意设计仍未知。
- Unknown statement: 搜索历史是否应该只记录“真正参与查询过滤”的搜索词
- Why unresolved: 仓库内没有正式需求说明解释这一分歧的业务意图

## Impact
### IMP-001 Blocked Decisions
- Claim: 任何关于新搜索模式、历史展示、历史去重或关键字语义统一的需求，都可能被这个未知点阻塞。
- Blocks:
  - search-history display design
  - keyword semantics refactor
  - new keyType introduction
- Risk if guessed: Agent 可能把现有分歧误判为 bug 或误判为规范，从而做出错误实现。

## Next Evidence
### NXT-001 Minimal Next Evidence
- Claim: 要关闭这个未知点，至少需要产品侧或历史变更记录说明“写历史”和“查结果”是否必须一致。
- Need one of:
  - 明确的产品说明
  - 历史 PR / issue 说明
  - 业务负责人确认
- Owner to ask:
  - 商品搜索需求负责人
- Deadline:
  - 在任何 `keyword` 语义改动前
