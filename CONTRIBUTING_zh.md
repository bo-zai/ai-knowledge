# 为 Bootstrap Knowledge Generator 贡献代码

## 提交信息

统一使用 Conventional Commits：

```text
<type>(<scope>): <subject>
```

常用类型：

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`

示例：

```bash
feat(cli): scaffold generate command
fix(generation): reject invalid db field output
docs(readme): clarify bootstrap knowledge package layout
```

## 代码质量要求

提交前至少执行：

```bash
npm run typecheck
npm run build
npm test
pre-commit run --all-files
```

如果 `pre-commit` 自动修改了文件，重新执行直到全部通过。

## 开发原则

- 先遵守 `AGENTS.md`
- 结构稳定优先于文案丰富
- 外部输入全部先校验
- 对象 schema、证据合并规则、DB 描述来源规则必须补测试
- 修改命令面、schema、目录结构时同步更新 README 或设计文档