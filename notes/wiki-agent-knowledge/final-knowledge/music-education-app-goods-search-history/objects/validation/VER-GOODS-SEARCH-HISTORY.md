---
id: VER-GOODS-SEARCH-HISTORY
type: VER
status: fact
domain: mall
owner: knowledge-mvp
task_triggers:
  - 搜索相关需求完成
  - 搜索历史逻辑变更
decision_points:
  - validation_plan
evidence_primary:
  - music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:37
  - music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:42
evidence_secondary:
  - music-education-app/src/main/java/com/education/music/app/interceptor/LoginInterceptor.java:38
  - music-education-app/src/main/resources/mappers/GoodsMapper.xml:89
stale_if:
  - GoodsControllerTest changes
  - goods list request or SQL logic changes
last_verified: 2026-05-19
---

# VER-GOODS-SEARCH-HISTORY 商品搜索与搜索历史验证

## Verification Goal
### GOL-001 Done Definition
- Claim: 与商品搜索或搜索历史相关的改动，只有同时覆盖登录边界、关键字过滤语义和历史写入行为后，才算完成。
- Requirement is considered satisfied when:
  - `/goods/list` 登录边界保持正确
  - 关键字过滤行为与需求一致
  - 搜索历史写入行为与需求一致

## Required Checks
### CHK-001 Existing Coverage Baseline
- Claim: 当前可见自动化覆盖只有 `GoodsControllerTest.list` 的基础调用，不足以保护关键分支。
- Must cover:
  - 基础链路可调用
- Negative cases:
  - 尚未看到 `keyword`、`keyType`、历史写入的断言保护

### CHK-002 Required Future Checks
- Claim: 后续任何变更至少要补四类检查。
- Must verify:
  - 无 `authorization` 时返回 `NO_LOGIN`
  - `keyword` 非空且 `keyType == 1` 时关键字过滤生效
  - `keyword` 为空时不写搜索历史
  - `keyword` 非空但 `keyType != 1` 的行为被显式确认
- Cross-system paths:
  - none for this MVP slice

## Acceptance Oracle
### ORC-001 Oracle
- Claim: 这个能力的完成标准不是“接口能调通”，而是“关键字、登录边界、历史写入三者的关系被验证”。
- Observable outcomes:
  - 正确登录边界
  - 正确 SQL 过滤
  - 正确历史写入
- Not enough signals:
  - 仅有 controller smoke test

## Observability
### OBS-001 Runtime Signals
- Claim: 当前仓库里没有现成的专门搜索历史观测对象，本轮主要依赖代码和测试锚点。
- Metrics/logs/traces:
  - none visible for this slice
- Alert thresholds:
  - none visible for this slice

## Rollback
### RBK-001 Rollback Trigger
- Claim: 如果变更让 `/goods/list` 的登录边界、关键字过滤或历史写入关系发生未确认变化，应回滚。
- Rollback when:
  - `/goods/list` 变成匿名调用
  - `keyword` 语义与 `keyType` 不再可解释
  - 搜索历史开始在无明确规则下重复或缺失写入
