# DB Knowledge Accuracy Hardening Design

## Goal

提高 `DB` 知识对象的准确性，使其至少对 `music-education-admin` 中的代表性表达到“可作为可靠工程上下文”的水平，而不是仅作为宽松提示。

本次修复聚焦以下已验证问题：

- `auth_menu`
  - 字段类型错误地从弱证据推成 `Long`
  - 在没有 DDL 证据时把 `primary_key`、`nullable` 写成事实
- `mall_category`
  - `<include>` 展开后的 SQL 归一化错误，出现 `SELECTFROM` 这类畸形 SQL
  - 字段集合和 statement 语义受归一化质量影响
- `music_user`
  - `open_id` 被错误推成 `INTEGER`，但 Java `UserDO.openId` 是 `String`
  - `share_ratio` 被错误推成 `DECIMAL`，但 Java `UserDO.shareRatio` 是 `String`
  - `id` / `creator` 等字段类型没有正确从实体侧继承

## Non-Goals

- 不引入真实数据库连接
- 不要求恢复完整 DDL
- 不改整个知识包格式
- 不扩展到非 `DB` 对象类型

## Required Behavior

### 1. 类型推断必须有明确来源层级

字段类型不能再主要由 SQL 文本形状或 LLM 自由推断。

实现必须使用如下优先级：

1. `resultMap` 中 column -> property -> Java field type
2. `resultType` 对应 Java 类 field type
3. `insert/update` 参数对象中能稳定映射到的 Java field type
4. SQL 语句弱推断
5. 最后才允许 `unknown`

禁止在有 Java 类型证据时仍让 LLM 自行决定 `Long` / `Integer` / `String` / `BigDecimal`。

### 2. 约束信息必须降级

在没有 DDL / migration / 明确 schema 注释时：

- 不得把 `primary_key` 写成确定事实
- 不得把 `nullable: false` 写成确定事实
- 不得生成 `PRIMARY KEY` 约束

替代规则：

- 若只有命名习惯或实体字段名支持，最多记录为 `gaps` 或 `notes`
- `primary_key` 默认空数组
- `constraints` 默认空数组
- `nullable` 应允许保守值或 `unknown` 映射策略，但不能伪装成强事实

### 3. SQL include 展开后必须重新规范化

`<include refid="...">` 展开后，必须重新做 SQL 规范化，保证：

- `SELECT FROM` 之间有空格
- 逗号、别名、换行压缩后仍保留合法 token 边界
- `FROM/JOIN/WHERE/ORDER BY/SET/VALUES` 等关键字前后不会粘连

禁止继续生成 `SELECTFROM`、`WHEREid` 这类畸形 SQL。

### 4. 字段候选需要区分来源角色

字段候选不能再被平铺成“都是 schema 字段”。

每个字段候选至少应带：

- `source_clause`
  - `select`
  - `insert`
  - `update`
  - `where`
  - `join`
  - `order_by`
- `source_statement_id`
- `source_mapper`

渲染 `DB` 对象时：

- `select/insert/update` 来源字段可进入主字段列表
- 仅来自 `where/join/order_by` 的字段，除非有实体映射证据，否则不应直接进入主字段列表

这条规则直接约束 `auth_menu.index_no` 之类字段。

### 5. 读写使用要区分 direct 与 joined

`read_by` / `write_by` 不能把“直接表访问”和“通过 join 间接访问”混为一类。

至少需要区分：

- `read_by_direct`
- `read_by_joined`
- `write_by_direct`

若当前不想改最终 markdown 字段名，至少在内部 evidence 中要先分开，再决定如何渲染。

`music_user` 当前把 `ProfitMapper` / `OrderMapper` 这类 join 读取和主表自身 CRUD 混在一起，会显著降低知识可读性。

### 6. caller evidence 必须真正进入最终 DB 对象

当前 caller evidence 只停留在 bundle 阶段不够。

最终 `DB-*.md` 必须能体现：

- 主要直接调用该表相关 mapper 的 service / manager / facade
- 至少 1 层上游业务入口语义

否则 `read_by` 只有 mapper method，价值不够。

### 7. LLM 只能补解释，不能补结构事实

LLM 可负责：

- `table_name_zh`
- `description_zh`
- 表级摘要
- gaps 的中文表达

LLM 不可负责：

- 自行决定字段类型
- 自行决定主键
- 自行决定 nullable
- 自行决定 direct/joined 归属

## Evidence Contract Changes

`DbTableEvidenceBundle` 至少补充以下字段：

- `directStatements`
- `joinedStatements`
- `entityFieldEvidence`
- `callerEvidence`
- `fieldCandidates[*].sourceClause`
- `fieldCandidates[*].javaType`
- `fieldCandidates[*].javaProperty`
- `fieldCandidates[*].typeSource`

建议新增字段：

- `tableConstraintsConfidence`
- `fieldNullabilityConfidence`

## Rendering Rules

最终 `DB` 对象应遵守：

- 没有强证据时，不写 `primary_key`
- 没有强证据时，`constraints` 为空
- 类型优先采用 Java 证据
- 仅 `order_by` / `where` 命中的字段默认不进主字段列表
- joined reader 不要和 direct reader 混在一段里

## Validation Targets

必须对以下 3 张真实表重新验证：

### `auth_menu`

至少满足：

- 不再输出 `primary_key: [id]` 这类无证据断言
- `id/module_id/parent_id` 类型应与 `AuthDO` 保持一致
- `index_no` 不应仅因 `order by` 进入主字段列表

### `mall_category`

至少满足：

- include 展开后的 SQL 不再出现 token 粘连
- `sort_code/is_disable/pic_url/icon_url/pid/level` 能正确进入字段候选
- `GoodsMapper` 对该表的 join 访问不应污染 direct read 语义

### `music_user`

至少满足：

- `open_id` 类型不再是 `INTEGER`
- `share_ratio` 类型不再是 `DECIMAL`
- `id/creator` 类型要继承自 `UserDO`
- direct/joined reader 语义要分开

## Acceptance

本次修复完成后，应满足：

- `npm run typecheck`
- `npm run build`
- `npm test`
- 真实单表生成：
  - `database:auth_menu`
  - `database:mall_category`
  - `database:music_user`
- 三张表生成后的 `DB-*.md` 内容通过人工 spot check，不再出现本 spec 中列出的已知错误模式
