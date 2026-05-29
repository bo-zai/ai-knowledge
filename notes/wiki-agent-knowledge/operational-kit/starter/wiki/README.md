# Starter Wiki Scaffold

这个目录是一个最小可工作的 wiki scaffold。

## 结构

```text
wiki/
├── catalog.yaml
├── objects/
│   ├── terms/
│   ├── capabilities/
│   ├── systems/
│   ├── ownership/
│   ├── contracts/
│   ├── modules/
│   ├── validation/
│   ├── decisions/
│   ├── invariants/
│   ├── states/
│   └── open/
└── pages/
    ├── capabilities/
    ├── external-systems/
    ├── entities/
    ├── modules/
    └── runbooks/
```

## 使用原则

- `objects/` 下是一文件一对象的权威文件
- `pages/` 下是组合页，只做编排和导航
- `catalog.yaml` 是 Agent 的检索路由表

