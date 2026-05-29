# Starter Evaluation Scaffold

建议结构：

```text
evaluation/
├── cases/
│   └── CASE-000-TEMPLATE/
│       ├── request.md
│       ├── gold.yaml
│       ├── evidence.md
│       └── scoring.yaml
├── knowledge-matrix.yaml
└── experiment-runs/
```

用途：

- `cases/`
  - 真实需求评测样例
- `knowledge-matrix.yaml`
  - case 与关键对象之间的依赖关系
- `experiment-runs/`
  - 存放 `with / without / stale` 结果

