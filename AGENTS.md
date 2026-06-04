## 代码规范

### 命名

- 目录名使用小写英文
- TypeScript 文件使用 `kebab-case`
- 变量和函数使用 `camelCase`
- 类型、接口、schema 常量使用 `PascalCase`
- 模块级常量使用 `UPPER_SNAKE_CASE`

### 类型与复杂度

- 项目必须保持 `strict` TypeScript
- 禁止无约束 `any`
- 函数参数建议不超过 `7`
- 圈复杂度建议不超过 `15`
- 重复字面量优先提取为常量或小型 helper

### 注释

- 注释统一使用简体中文
- 注释重点写"为什么这样做"
- 不写显而易见的注释
- `TODO`、`FIXME`、`HACK` 使用标准前缀


