# mall-* 仓库试点评估

## 1. 已识别仓库

`D:\workspace` 下当前识别到三个相关仓库：

- `mall-admin-web`
- `mall-app-web`
- `mall-swarm`

## 2. 仓库角色判断

### mall-admin-web

- 角色：后台管理前端
- 技术形态：独立前端仓库
- 价值：
  - 适合做前端交互、登录态、页面恢复、后台业务流程等需求的前端落点
  - 可作为跨系统需求中的前端边界对象

### mall-app-web

- 角色：前台商城前端
- 技术形态：独立前端仓库
- 价值：
  - 适合做搜索、下单、商品详情、购物车等前台能力需求的前端落点
  - 在跨系统需求中常与 `mall-portal`、`mall-search` 形成前台链路

### mall-swarm

- 角色：后端微服务聚合仓库
- 技术形态：Spring Cloud 微服务系统
- 包含模块：
  - `mall-admin`
  - `mall-auth`
  - `mall-common`
  - `mall-demo`
  - `mall-gateway`
  - `mall-mbg`
  - `mall-monitor`
  - `mall-portal`
  - `mall-search`
  - `config`
- 价值：
  - 是系统边界、source of truth、契约、模块落点、验证路径最密集的仓库
  - 最适合作为知识系统对象化的主锚点

## 3. 参考源约束

用户已明确约束：

- `mall-swarm/ai-knowledge/wiki` **不作为参考源**

因此，后续进行对象化与评测时，事实依据只应来自：

- 源码
- 配置
- SQL / schema
- README / 正式项目文档
- API / 契约定义
- 测试
- 必要时的运行脚本和部署配置

以下内容最多只能作为“线索”，不能作为事实来源：

- `ai-knowledge/wiki`
- 任何 AI 生成的系统总览、分析页、计划页

## 4. 现有 AI 知识沉淀情况

`mall-swarm` 已存在一些 AI 生成产物，但不能直接作为事实来源：

- `ai-knowledge/wiki/systems/index.md`
  - 当前是系统总览页
  - 仅可作为“可能值得核验的线索”，不应作为事实依据

- `ai-knowledge/validation/requirements/`
  - 已有 `REQ-001`、`REQ-002`、`REQ-003`

- `ai-knowledge/validation/plans/`
  - 已有对应需求 plan

因此，`mall-swarm` 仍适合作为试点，但需要强调：

- 后续对象化应回到代码和正式文档重新取证
- 现有 AI 产物只能帮助发现候选问题，不可直接沉淀为知识对象

## 5. 现有 validation case 快速评估

### REQ-001 前台商品搜索增强

涉及：

- `mall-app-web`
- `mall-portal`
- `mall-search`
- `mall-gateway`

特点：

- 典型跨前端/后端/搜索服务需求
- 边界明显
- 有外部技术边界：Elasticsearch
- 有明确非目标：不改后台、不新增搜索引擎、不改商品主数据维护
- 很适合验证：
  - `TERM`
  - `SYS`
  - `OWN`
  - `CON`
  - `MOD`
  - `VER`
  - `OPEN`

判断：

- 这是当前最适合的首批主试点 case

### REQ-002 后台登录态优化

涉及：

- `mall-admin-web`
- `mall-admin`
- `mall-auth`
- 可能涉及 `mall-gateway`

特点：

- 典型认证边界和 source of truth 问题
- 涉及 token 过期机制、前端状态恢复、部署路径判断
- 很适合验证：
  - `OWN`
  - `CON`
  - `MOD`
  - `OPEN`

风险：

- 当前 plan 中提到“单体 vs 微服务部署路径待确认”，说明对象化前需要更多架构事实

判断：

- 适合作为第二个试点 case

### REQ-003 搜索服务监控看板

涉及：

- `mall-search`
- `mall-monitor`
- 可能涉及 `mall-gateway`

特点：

- 偏运维/监控视角
- 验证重点不是业务流，而是观测、指标定义、技术栈边界
- 适合验证：
  - `SYS`
  - `VER`
  - `OPEN`
  - 部分 `CON`

风险：

- 业务价值相对间接
- 首轮试点时不如搜索增强或登录态优化那样能全面覆盖需求理解链路

判断：

- 更适合作为第三批或补充 case

## 6. 首轮试点建议

### 主锚仓库

- `mall-swarm`

原因：

1. 它承载真正的业务边界与后端 source of truth
2. 已存在 `ai-knowledge/wiki` 与 `validation`
3. 跨系统需求都能回落到它的模块与契约
4. 前端仓库可以作为配套系统对象，而不是单独主试点

### 推荐试点顺序

1. `REQ-001 前台商品搜索增强`
2. `REQ-002 后台登录态优化`
3. `REQ-003 搜索服务监控看板`

## 7. 基于当前材料的对象化切入点

建议先从 `REQ-001` 抽第一批对象：

- `TERM-SEARCH-KEYWORD`
- `TERM-BRAND-FILTER`
- `SYS-MALL-APP-WEB`
- `SYS-MALL-PORTAL`
- `SYS-MALL-SEARCH`
- `OWN-SEARCH-RESULT-SOURCE`
- `CON-PORTAL-SEARCH-API`
- `CON-SEARCH-ES-QUERY`
- `MOD-APP-SEARCH-PAGE`
- `MOD-PORTAL-SEARCH-ENDPOINT`
- `MOD-SEARCH-QUERY-SERVICE`
- `VER-SEARCH-ENHANCEMENT`
- `OPEN-SUGGESTION-DATA-SOURCE`
- `OPEN-PORTAL-SEARCH-CALL-CHAIN`

## 8. 对现有 mall-swarm 知识沉淀的判断

现有 `REQ-xxx-plan.md` 这类材料可以作为需求样例，但不能作为权威知识对象。真正缺的仍然是：

1. 对象级唯一事实来源
2. source of truth 的显式对象
3. 契约对象与错误语义对象
4. 代码落点对象
5. 验证对象
6. 未知升级对象
7. 评测所需的 `gold` 结构

因此，推荐的改造方向是：

- 不使用 `ai-knowledge/wiki` 作为参考依据
- 如需保留 `REQ-xxx-plan.md`，仅把它当作历史需求分析样例
- 真正的对象层与评测层必须重新基于一手证据构建

## 9. 下一步最合理的动作

如果进入真实落地，建议按这个顺序推进：

1. 基于 `REQ-001` 这类真实需求样例，回到代码和配置重新取证
2. 在一手证据基础上建立首批 `gold case`
3. 为 `REQ-001` 创建第一批对象文件
4. 建立 `catalog.yaml` 与 capability 组合页
5. 用 `REQ-001` 跑第一次 `requirement -> plan` 评测
6. 再引入 `REQ-002` 检验认证边界类知识
