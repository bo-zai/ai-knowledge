# Unified Domain Discovery Design

## 背景

当前业务域发现主要依赖代码结构、调用关系和命名，由模型从实现侧推测业务能力。这会导致生成的 `ai-knowledge` 偏技术视角：代码模块边界不一定等于真实业务边界，历史需求、产品口径和业务迭代信息也无法参与业务域命名与归并。

引入需求文档后，文档不应作为 PM role knowledge 的后处理输入，而应进入业务域发现的前置阶段。业务域应由文档证据、代码证据和 Git 演进证据共同归纳生成，并成为后续 `ai-knowledge` 与 PM、Tech Lead、QA 三类 role knowledge 的共同基础。

## 目标

- 将业务域发现升级为统一 evidence-driven domain discovery。
- 用同一个 `domain-registry` 承载文档、代码和 Git 三类证据的融合结果。
- 让 `ai-knowledge` 和 role knowledge 都基于统一业务域生成。
- 支持多份历史需求文档、多业务域混合文档、低质量文档和代码文档不一致场景。
- 明确标记 `confirmed`、`doc_only`、`code_only`、`candidate`、`conflict` 等状态，避免低置信信息被 agent 当作事实使用。

## 非目标

- 不在本阶段实现完整 RAG 问答系统。
- 不要求需求文档直接匹配代码文件或代码符号。
- 不用规则枚举所有业务语义。
- 不把文档域和代码域分别生成后再简单拼接。
- 不要求所有 `.doc` 文件在无外部依赖时都能高质量解析。

## 总体流程

```text
collect document evidence
  + collect code evidence
  + collect git evidence
  -> build evidence package
  -> LLM unified domain discovery
  -> write domain-registry
  -> generate ai-knowledge by domain
  -> generate role knowledge by domain
```

业务域发现是 `ai-knowledge` 生成前置步骤，而不是 role knowledge pipeline 的附属步骤。

## 证据来源

### Document Evidence

文档证据来自项目中的需求文档、产品方案、变更记录、验收说明等。支持的输入类型分阶段接入：

- `.md`：优先支持，直接解析标题层级和正文。
- `.docx`：通过可插拔 parser 转为结构化 Markdown 或文档元素。
- `.doc`：通过外部 provider 支持，例如 LibreOffice + Docling/Tika。

文档解析输出 chunk，而不是直接输出业务域。每个 chunk 保留：

- document id
- file path
- title path
- chunk text
- chunk kind
- position
- document modified time
- optional version markers

### Code Evidence

代码证据来自现有代码分析与 `ai-knowledge` 生成链路，包括：

- capability candidates
- routes / commands / events
- workflow / service / handler clusters
- data objects / enum / status signals
- tests
- package / module path signals
- existing knowledge objects

代码证据提供实现侧能力形态，但不单独决定业务域。

### Git Evidence

Git 证据用于增强演进判断和文档代码对齐，包括：

- commit hash
- commit message
- commit time
- touched files
- diff summary
- changed symbols if available

Git 证据不作为唯一判定依据，主要用于解释某个业务域如何迭代，以及辅助识别文档与代码之间的时间关联。

## Unified Domain Discovery

统一业务域发现由 LLM 主导。输入是整理后的 evidence package，不是裸文档和裸源码全文。LLM 的职责是：

- 识别候选业务域。
- 合并同义 domain 和 alias。
- 判断文档证据与代码证据是否描述同一业务能力。
- 识别 doc-only、code-only 和 conflict。
- 给出证据引用、置信度和归并理由。

LLM 输出必须经过 schema 校验。校验失败时进行一次 repair；仍失败则写入 review，不覆盖已有 registry。

## Domain Registry

`domain-registry.json` 是业务域的唯一事实入口。建议记录结构：

```ts
type DomainRecord = {
  domainKey: string;
  domainName: string;
  aliases: string[];
  description: string;
  status: "confirmed" | "doc_only" | "code_only" | "candidate" | "conflict";
  confidence: number;
  sources: {
    docs: DocumentEvidenceRef[];
    code: CodeEvidenceRef[];
    commits: CommitEvidenceRef[];
  };
  conflicts: DomainConflict[];
  updatedAt: string;
};
```

状态语义：

- `confirmed`：文档和代码都有支撑。
- `doc_only`：文档中存在，但暂未找到实现侧证据。
- `code_only`：代码中存在，但暂未找到文档证据。
- `candidate`：证据不足，需要人工确认。
- `conflict`：文档口径和代码知识明显不一致。

## 文档和代码的关联方式

主路径不是“文档 chunk 直接匹配代码文件”，而是：

```text
document chunk
  -> product/business evidence
  -> unified domain
  -> ai-knowledge capability/concept/workflow
  -> code evidence
```

需求文档通常不会描述接口、类名、表字段或方法名，因此直接从文档向代码做字符串或向量匹配会不稳定。统一 domain discovery 要在业务域级别关联文档与代码，再由已有 `ai-knowledge` 连接到实现证据。

## 与 ai-knowledge 的关系

`ai-knowledge` 生成应读取统一 `domain-registry`：

- `confirmed` domain：作为优先生成对象。
- `doc_only` domain：生成文档侧知识和 review 项，不强行声称已有实现。
- `code_only` domain：生成实现侧知识，同时标记缺少需求文档支撑。
- `candidate` domain：进入人工审核区。
- `conflict` domain：输出冲突报告，不自动合并为稳定知识。

这使 `ai-knowledge` 不再只是代码推测出的能力文档，而是项目业务边界的证据融合结果。

## 与 Role Knowledge 的关系

PM、Tech Lead、QA 三类 role knowledge 共享同一个 domain registry：

- PM：读取文档证据、产品规则、需求演进、验收口径、冲突和未决问题。
- Tech Lead：读取代码证据、架构边界、实现路径、技术演进和技术风险。
- QA：读取验收点、边界流、异常流、测试覆盖和缺失用例。

三类 agent 不各自生成业务域，只在同一业务域下生成不同视角的知识。

## 文件结构

```text
ai-knowledge/
  .internal/
    domain-registry.json
    domain-candidates.md
    domain-conflicts.md
  evidence/
    documents/
      chunks.jsonl
      parse-report.json
    git/
      commits.jsonl
    code/
      domain-signals.jsonl
  roles/
    pm/
      domains/{domain}/
    tech-lead/
      domains/{domain}/
    qa/
      domains/{domain}/
```

`evidence/` 目录保存可追溯中间产物，便于调试和证明业务域来源。

## CLI 影响

建议扩展现有命令：

```text
rkg generate --with-docs --with-git
rkg role-knowledge discover-domains --with-docs --with-git
```

后续可补充独立命令：

```text
rkg documents scan
rkg documents parse
rkg domains discover
rkg domains status
```

短期可以先在 `role-knowledge discover-domains` 中接入统一发现能力，长期应提升为通用 `domains discover`。

## 失败与降级

- 文档解析失败：记录到 `parse-report.json`，不中断代码侧生成。
- LLM 融合失败：保留旧 registry，写入 review 报告。
- 低置信匹配：标为 `candidate`，不进入 confirmed。
- 文档与代码冲突：标为 `conflict`，PM/Tech/QA 均可读取冲突说明。
- 缺少 `.doc` parser 运行时：跳过 `.doc` 并提示安装外部 provider。

## 测试策略

- 单元测试：文档 chunk schema、domain schema、状态语义、registry merge。
- 集成测试：用小型 fixture 同时包含 `.md` 需求文档、代码 capability、Git-like evidence，验证生成 `confirmed/doc_only/code_only/conflict`。
- 回归测试：无文档输入时保持现有代码侧业务域发现可运行。
- CLI 测试：验证 `--with-docs`、`--with-git` 对 registry 输出的影响。

## 分阶段实施

### Phase 1: 统一模型与 evidence 存储

- 增加 document/code/git evidence 数据模型。
- 扩展 domain registry schema。
- 保留现有代码侧 discovery 作为 fallback。

### Phase 2: 文档 evidence 接入

- 支持 `.md` 文档扫描与 chunk。
- 引入可插拔 document parser provider。
- 为 `.docx/.doc` 预留 provider 接口。

### Phase 3: LLM 统一业务域发现

- 构建 evidence package。
- 增加 LLM domain discovery provider。
- 输出 confirmed/doc_only/code_only/candidate/conflict。

### Phase 4: ai-knowledge 与 role knowledge 融合

- `ai-knowledge` 生成读取统一 registry。
- PM/Tech Lead/QA role knowledge 使用统一 domain。
- 输出冲突、未映射需求和缺文档实现报告。
