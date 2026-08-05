## 业务域 Agent 协作规则：{{domainName}}（{{domain}}）

本项目已配置 {{domainName}} 业务域 Claude Code subagents：

- `{{domain}}-pm`：负责产品意图、需求演进、用户场景、业务规则和验收口径。
- `{{domain}}-tech-lead`：负责技术架构、模块边界、实现方案、接口依赖、数据模型和技术风险。
- `{{domain}}-qa`：负责测试策略、核心用例、回归范围、边界场景、缺陷风险和发布风险。

命中条件：

- 用户显式 `@{{domain}}-pm`、`@{{domain}}-tech-lead` 或 `@{{domain}}-qa`。
- 用户提到以下关键词：{{keywords}}
- 用户修改或询问以下路径：{{paths}}
- 用户询问 {{domainName}} 的需求、规则、实现、测试或上线风险。

角色选择规则：

- 需求、业务规则、验收口径：调用 `{{domain}}-pm`。
- 架构、实现、接口、数据模型、迁移、性能、技术风险：调用 `{{domain}}-tech-lead`。
- 测试策略、回归范围、缺陷复现、发布风险：调用 `{{domain}}-qa`。

多角色协作规则：

- 需求澄清：先 PM，再 QA，必要时 Tech Lead。
- 技术设计或代码修改：先 PM，再 Tech Lead，再 QA。
- 缺陷分析：先 QA，再 Tech Lead，再 PM。
- 上线评审：PM、Tech Lead、QA 必须全部参与。

主会话负责整合 agent 输出：

- 合并一致结论。
- 标出冲突意见。
- 标出缺失信息。
- 给出下一步行动。
- 不得把缺少来源的 agent 判断当作事实。
