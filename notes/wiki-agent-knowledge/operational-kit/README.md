# Knowledge Ops Kit

这是一套把本轮设计落到真实项目的操作包。

注意：

- 这套内容属于 `方案设计 / 实施工具`
- **不属于最终知识文档**

它面向两个场景：

1. 在当前仓库继续讨论和演进方法论
2. 后续切换到真实业务项目时，直接复制这套结构开始落地

## 包含内容

- [bootstrap-playbook.md](./bootstrap-playbook.md)
  - 首轮落地流程，解决“先做什么、后做什么”
- [templates/need-ledger.template.yaml](./templates/need-ledger.template.yaml)
  - 记录真实知识缺口的台账模板
- [templates/evidence-ledger.template.yaml](./templates/evidence-ledger.template.yaml)
  - 记录候选知识证据的台账模板
- [templates/claim-candidate.template.yaml](./templates/claim-candidate.template.yaml)
  - 候选知识断言模板
- [templates/gold-case.template.yaml](./templates/gold-case.template.yaml)
  - 真实需求评测样例模板
- [templates/object-review-checklist.md](./templates/object-review-checklist.md)
  - 单个知识对象在进入稳定层前的审查清单
- [starter/wiki/](./starter/wiki)
  - 首版 wiki scaffold
- [starter/evaluation/](./starter/evaluation)
  - 首版评测目录骨架

## 使用顺序

1. 先建 `Need Ledger`
2. 再建 `Evidence Ledger`
3. 从两本台账抽出 `Claim Candidates`
4. 选 3 个高价值历史需求做 `gold cases`
5. 创建首批对象文件
6. 建立 `catalog.yaml`
7. 跑 `requirement -> plan` 评测
8. 删除无效对象，补齐缺失对象

## 不要一开始做的事

- 不要先写一整套大而全 wiki
- 不要先自动生成几十页文档
- 不要把没有证据的知识当事实落盘
- 不要在没有评测的情况下保留“看起来有用”的对象
