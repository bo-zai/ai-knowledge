# DB Knowledge Accuracy Hardening Plan

## Goal

修复 `DB` 知识对象在真实表上的准确性问题，重点收紧：

- 字段类型来源
- include 展开后 SQL 规范化
- direct / joined 读写语义
- 约束信息降级
- caller evidence 进入最终对象

## Task 1: Fix include-expanded SQL normalization

### Work

- 检查 MyBatis `<include>` 展开后的 SQL 拼接逻辑
- 在展开后重新做 token-safe normalization
- 保证关键字、字段列表、逗号、别名、子句边界之间保留正确空格

### Expected Result

- `mall_category` 相关 SQL 不再出现 `SELECTFROM`、`WHEREid` 等错误
- 字段提取前拿到的是可解析 SQL

## Task 2: Rebuild field candidate classification

### Work

- 为字段候选增加 `sourceClause`
- 将字段区分为：
  - `select`
  - `insert`
  - `update`
  - `where`
  - `join`
  - `order_by`
- 更新 DB bundle 聚合逻辑
- 渲染时默认只让强字段来源进入主字段列表

### Expected Result

- `auth_menu.index_no` 不会仅因 `order by` 被当作主字段写入
- 仅 join / where 命中的字段不会无条件进入最终字段列表

## Task 3: Make Java entity evidence authoritative for field types

### Work

- 强化 `resultMap` / `resultType` 到 Java field 的映射
- 在 `fieldCandidates` 中补：
  - `javaProperty`
  - `javaType`
  - `typeSource`
- DB object 生成前先由程序确定字段类型
- LLM 不再负责数值/字符串类型判断

### Expected Result

- `music_user.open_id` 基于 `UserDO.openId` 变为字符串类型
- `music_user.share_ratio` 不再是 `DECIMAL`
- `auth_menu.id/module_id/parent_id` 与 `AuthDO` 类型一致

## Task 4: Downgrade unsupported constraints

### Work

- 修改 DB 渲染/生成逻辑
- 在无 DDL / migration 证据时：
  - 不输出 `primary_key`
  - 不输出 `PRIMARY KEY`
  - 不把 `nullable: false` 写成强事实
- 必要时改成 gap / note

### Expected Result

- `auth_menu` 不再宣称 `id` 是已确认主键
- 没有真实 schema 时约束信息保持保守

## Task 5: Split direct and joined usage

### Work

- statement 归类时区分：
  - direct table statements
  - joined table statements
- DB bundle 中分开记录
- 最终对象中至少要分出 direct / joined 语义

### Expected Result

- `music_user` 中 `ProfitMapper` / `OrderMapper` 不再和主表直接 CRUD 混成一类
- `mall_category` 中 `GoodsMapper` 的 join 访问不会污染 direct usage

## Task 6: Surface caller evidence in final DB objects

### Work

- 将已有 caller evidence 从 bundle 带入渲染层
- 最终对象至少展示主要上游 service / manager 调用者
- 保留 mapper method，但不止停留在 mapper 层

### Expected Result

- `auth_menu` 可看到 `AuthService` 级使用语义
- `mall_category` 可看到 `CategoryService`
- `music_user` 可看到 `UserService` 或其它主业务调用者

## Task 7: Re-validate three real tables

### Work

对以下 3 张表做真实单表生成和人工断言：

- `auth_menu`
- `mall_category`
- `music_user`

建议命令：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:mall_category --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:music_user --llm-config llm.config.json
```

### Required Assertions

#### `auth_menu`

- `id/module_id/parent_id` 类型与 `AuthDO` 一致
- 无证据时不再写主键事实
- `index_no` 不在主字段列表中，除非新增强证据

#### `mall_category`

- SQL 展开后格式正常
- `sort_code/is_disable/pic_url/icon_url/pid/level` 被正确识别
- `GoodsMapper` 若出现，应被归为 joined usage

#### `music_user`

- `open_id` 不是 `INTEGER`
- `share_ratio` 不是 `DECIMAL`
- `id/creator` 类型与 `UserDO` 一致
- direct / joined usage 分开

## Verification

提交前至少执行：

```powershell
npm run typecheck
npm run build
npm test
```

并补充：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:mall_category --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:music_user --llm-config llm.config.json
```
