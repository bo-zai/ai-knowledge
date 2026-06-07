# 前端应用架构概览生成规则

## 任务说明

你需要为一个前端应用项目生成架构概览知识。架构概览帮助 AI Agent 快速建立对项目的全局认知，并指导编码时的代码定位。

架构概览回答的问题：
- 这个项目是什么类型？使用什么技术栈？
- 组件组织模式是什么？（feature-based 还是 type-based）
- 新组件/hooks/slice 放在哪？
- 哪些目录不需要浏览？
- 通用的编码约定是什么？

**核心原则**：架构概览必须提供可操作的编码定位信息，不能只给出宽泛的描述。

## 输出格式

输出一个 JSON 对象，包含以下字段：

```json
{
  "architecture_overview_name": "项目名称 + 架构概览",
  "summary_zh": "一句话定位",
  "project_type": "frontend-app",
  "tech_stack": ["技术栈列表"],
  "component_mode": "feature-based | type-based | 混合模式",
  "layer_directory_paths": [
    {
      "layer": "分层名称",
      "directory_path": "目录路径",
      "coding_guide": "编码时指导"
    }
  ],
  "directory_structure": [
    {
      "path": "目录路径",
      "purpose": "目录用途",
      "coding_guide": "编码时指导"
    }
  ],
  "ignore_directories": [
    {
      "path": "目录路径",
      "reason": "忽略原因"
    }
  ],
  "coding_conventions": [
    {
      "convention": "约定名称",
      "description": "约定描述"
    }
  ],
  "business_domains_navigation": "业务领域导航说明",
  "debug_entrypoints": [
    {
      "type": "入口类型",
      "location": "位置",
      "description": "说明"
    }
  ],
  "evidence": ["证据文件列表"]
}
```

## 字段填写要求

### architecture_overview_name

项目名称 + "架构概览"。

### summary_zh（一句话定位）

格式：`技术栈 + 应用类型 + 主要功能`

示例：
- 正确："React SPA 管理后台，提供用户管理、订单管理等功能"
- 错误："React SPA 管理后台，采用 feature-based 组件组织和 Redux 状态管理"（过于技术化）

### project_type

固定为 `frontend-app`。

### tech_stack

列出主要技术栈，不超过 5 个。按重要性排序。

示例：`["React 18", "Redux Toolkit", "Vite", "Ant Design"]`

### component_mode（组件组织模式）—— **必填且必须准确**

从 src_dir_tree 证据中推断组件组织模式，有以下三种：

**feature-based（按功能分包）**：
- 特征：src/ 下有 features/ 目录，每个 feature 包含独立的组件、hooks、slice
- 示例结构：
  ```
  src/
  ├── features/
  │   ├── user/
  │   │   ├── components/
  │   │   ├── hooks/
  │   │   ├── slice.ts
  │   ├── order/
  │   │   ├── components/
  │   │   ├── slice.ts
  ```

**type-based（按类型分包）**：
- 特征：src/ 下按类型组织，components/、hooks/、pages/ 等目录独立
- 示例结构：
  ```
  src/
  ├── components/
  ├── hooks/
  ├── pages/
  ├── store/
  ```

**混合模式（mixed）**：
- 特征：部分功能独立分包，部分公共代码按类型组织
- 示例结构：
  ```
  src/
  ├── features/       ← 业务功能（按功能）
  ├── components/     ← 通用组件（按类型）
  ├── hooks/          ← 通用 hooks（按类型）
  ```

**判断方法**：
1. 查看 src_dir_tree 中是否存在 features/ 目录
2. 如果存在 features/ 且每个 feature 有独立子目录 → feature-based
3. 如果存在 components/hooks/pages 等顶层目录 → type-based
4. 如果两者同时存在 → 混合模式

**必须从实际目录结构推断，不能猜测或使用示例模板**。

### layer_directory_paths（分层目录路径）—— **核心字段，必填**

提供每个分层的具体目录路径，这是 Agent 定位代码的关键信息。

采用表格形式，每个条目包含三个字段：

| 字段 | 要求 |
|------|------|
| layer | 分层名称：Components、Hooks、Pages、Store/Slice 等 |
| directory_path | 完整目录路径，从证据中提取 |
| coding_guide | 编码时指导——新代码放哪 |

**feature-based 示例**：
```json
[
  { "layer": "Feature", "directory_path": "src/features/<feature>/", "coding_guide": "新功能创建目录，如 src/features/order/" },
  { "layer": "Feature Components", "directory_path": "src/features/<feature>/components/", "coding_guide": "功能内组件，如 features/order/components/OrderList.tsx" },
  { "layer": "Feature Hooks", "directory_path": "src/features/<feature>/hooks/", "coding_guide": "功能内 hooks，如 features/order/hooks/useOrderList.ts" },
  { "layer": "Feature Slice", "directory_path": "src/features/<feature>/slice.ts", "coding_guide": "功能 Redux 状态定义" },
  { "layer": "通用组件", "directory_path": "src/components/", "coding_guide": "跨 feature 共享组件" }
]
```

**type-based 示例**：
```json
[
  { "layer": "Components", "directory_path": "src/components/", "coding_guide": "新组件在此创建，如 components/OrderList.tsx" },
  { "layer": "Pages", "directory_path": "src/pages/", "coding_guide": "页面组件，如 pages/OrderPage.tsx" },
  { "layer": "Hooks", "directory_path": "src/hooks/", "coding_guide": "新 hooks 在此创建，如 hooks/useOrder.ts" },
  { "layer": "Store", "directory_path": "src/store/", "coding_guide": "Redux 全局状态和 slices" }
]
```

**必须从 src_dir_tree 证据中提取实际路径，不能使用 src/features/<feature> 这样的占位符，除非是模板路径**。

### directory_structure（目录结构）

**必须采用表格形式**，每个条目包含三个字段。

**coding_guide 塋写示例**：
- `"分层目录已在上方列出"`（如果分层已在 layer_directory_paths 中详细说明）
- `"通用 hooks，跨功能共享"`
- `"应用样式和主题"`

**必须包含的目录**（按实际存在选择）：
- src/features/ 或 src/modules/（业务功能目录）
- src/components/（通用组件）
- src/hooks/ 或 src/utils/（工具/hooks）
- src/pages/ 或 src/views/（页面组件）
- src/store/ 或 src/state/（状态管理）

**最多列出 5 个目录**。

### ignore_directories（忽略目录）

**必须包含以下目录**：

```json
[
  { "path": "node_modules/", "reason": "npm 依赖" },
  { "path": "dist/", "reason": "构建产物" },
  { "path": "ai-knowledge/", "reason": "知识库生成产物" },
  { "path": ".codegraph/", "reason": "代码索引文件" }
]
```

如果有其他需要忽略的目录，追加到列表中：
- build/、out/（构建产物）
- .next/（Next.js 构建产物）
- coverage/（测试覆盖率报告）

### coding_conventions（编码约定）

描述通用的代码组织约定，从目录结构和文件命名推断。

**必填约定**：
- 组件命名约定（PascalCase 或其他）
- hooks 命名约定（useXxx 格式）
- 状态管理位置

**示例**：
```json
[
  { "convention": "组件命名", "description": "组件文件使用 PascalCase，如 OrderList.tsx" },
  { "convention": "Hooks 命名", "description": "Hooks 文件以 use 开头，如 useOrderList.ts" },
  { "convention": "状态管理", "description": "feature 状态在各 feature 的 slice.ts，全局状态在 src/store/" }
]
```

**禁止**：
- 不描述业务特定约定（如"订单列表必须分页"），业务约定属于约束知识。

### business_domains_navigation（业务领域导航）

固定格式：

```
参见能力目录 capabilities/_index.md 获取具体业务模块信息。
```

或如果已知主要业务领域：

```
参见能力目录 capabilities/_index.md：
- 用户管理
- 订单管理
- 商品管理

具体业务模块的页面路径和核心组件参见能力目录。
```

### debug_entrypoints（调试入口）

列出主要入口：

| 类型 | 必填 |
|------|------|
| 应用入口 | 是（src/main.tsx 或 src/index.tsx） |
| 路由入口 | 是（src/App.tsx 或路由配置文件） |

**示例**：
```json
[
  { "type": "应用入口", "location": "src/main.tsx", "description": "Vite 启动入口" },
  { "type": "路由入口", "location": "src/App.tsx", "description": "React Router 配置" }
]
```

### evidence

列出支撑架构判断的配置文件：

- package.json（依赖和构建配置）
- vite.config.ts 或 webpack.config.js（构建配置）
- tsconfig.json（TypeScript 配置）
- src/ 目录结构

## 产物示例

**feature-based 示例**：

```json
{
  "architecture_overview_name": "管理后台架构概览",
  "summary_zh": "React SPA 管理后台，提供用户管理、订单管理等功能",
  "project_type": "frontend-app",
  "tech_stack": ["React 18", "Redux Toolkit", "Vite", "Ant Design"],
  "component_mode": "feature-based",
  "layer_directory_paths": [
    { "layer": "Feature", "directory_path": "src/features/<feature>/", "coding_guide": "新功能创建目录，如 src/features/order/" },
    { "layer": "Feature Components", "directory_path": "src/features/<feature>/components/", "coding_guide": "功能内组件，如 features/order/components/OrderList.tsx" },
    { "layer": "Feature Hooks", "directory_path": "src/features/<feature>/hooks/", "coding_guide": "功能内 hooks，如 features/order/hooks/useOrderList.ts" },
    { "layer": "Feature Slice", "directory_path": "src/features/<feature>/slice.ts", "coding_guide": "功能 Redux 状态定义" },
    { "layer": "通用组件", "directory_path": "src/components/", "coding_guide": "跨 feature 共享组件" }
  ],
  "directory_structure": [
    { "path": "src/features/", "purpose": "业务功能模块", "coding_guide": "分层目录已在上方列出" },
    { "path": "src/components/", "purpose": "通用 UI 组件", "coding_guide": "跨 feature 共享的组件" },
    { "path": "src/hooks/", "purpose": "通用 hooks", "coding_guide": "跨 feature 共享的逻辑封装" }
  ],
  "ignore_directories": [
    { "path": "node_modules/", "reason": "npm 依赖" },
    { "path": "dist/", "reason": "构建产物" },
    { "path": "ai-knowledge/", "reason": "知识库生成产物" },
    { "path": ".codegraph/", "reason": "代码索引文件" }
  ],
  "coding_conventions": [
    { "convention": "组件命名", "description": "组件文件使用 PascalCase，如 OrderList.tsx" },
    { "convention": "Hooks 命名", "description": "Hooks 文件以 use 开头，如 useOrderList.ts" },
    { "convention": "状态管理", "description": "feature 状态在各 feature 的 slice.ts，全局状态在 src/store/" }
  ],
  "business_domains_navigation": "参见能力目录 capabilities/_index.md 获取用户管理、订单管理等业务领域的详细信息。",
  "debug_entrypoints": [
    { "type": "应用入口", "location": "src/main.tsx", "description": "Vite 启动入口" },
    { "type": "路由入口", "location": "src/App.tsx", "description": "React Router 配置" }
  ],
  "evidence": ["package.json", "vite.config.ts", "src/ 目录结构"]
}
```

**type-based 示例**：

```json
{
  "architecture_overview_name": "用户中心架构概览",
  "summary_zh": "Vue 3 SPA 应用，提供用户注册、登录、个人中心等功能",
  "project_type": "frontend-app",
  "tech_stack": ["Vue 3", "Pinia", "Vite", "Element Plus"],
  "component_mode": "type-based",
  "layer_directory_paths": [
    { "layer": "Components", "directory_path": "src/components/", "coding_guide": "新组件在此创建，如 components/UserProfile.vue" },
    { "layer": "Pages", "directory_path": "src/pages/", "coding_guide": "页面组件，如 pages/LoginPage.vue" },
    { "layer": "Hooks", "directory_path": "src/composables/", "coding_guide": "新 composables 在此创建，如 composables/useAuth.ts" },
    { "layer": "Store", "directory_path": "src/stores/", "coding_guide": "Pinia 状态定义，如 stores/user.ts" }
  ],
  "directory_structure": [
    { "path": "src/components/", "purpose": "UI 组件", "coding_guide": "分层目录已在上方列出" },
    { "path": "src/pages/", "purpose": "页面组件", "coding_guide": "路由页面" },
    { "path": "src/composables/", "purpose": "组合式函数", "coding_guide": "可复用逻辑" }
  ],
  "ignore_directories": [
    { "path": "node_modules/", "reason": "npm 依赖" },
    { "path": "dist/", "reason": "构建产物" },
    { "path": "ai-knowledge/", "reason": "知识库生成产物" },
    { "path": ".codegraph/", "reason": "代码索引文件" }
  ],
  "coding_conventions": [
    { "convention": "组件命名", "description": "组件文件使用 PascalCase 或 camelCase，如 UserProfile.vue" },
    { "convention": "Composables 命名", "description": "Composables 文件以 use 开头，如 useAuth.ts" },
    { "convention": "状态管理", "description": "使用 Pinia，状态定义在 src/stores/" }
  ],
  "business_domains_navigation": "参见能力目录 capabilities/_index.md 获取用户注册、登录、个人中心等业务领域的详细信息。",
  "debug_entrypoints": [
    { "type": "应用入口", "location": "src/main.ts", "description": "Vite 启动入口" },
    { "type": "路由入口", "location": "src/router/index.ts", "description": "Vue Router 配置" }
  ],
  "evidence": ["package.json", "vite.config.ts", "src/ 目录结构"]
}
```

## 禁止事项

1. **禁止模糊组件模式**：component_mode 必须明确 "feature-based"、"type-based" 或 "混合模式"，不能省略
2. **禁止占位符目录路径**：layer_directory_paths 必须使用实际目录名（如 src/features/order/），不能用 src/features/<feature> 占位（除非是模板路径说明）
3. **禁止遗漏分层目录路径**：layer_directory_paths 是核心字段，必须填写
4. **禁止虚构组件模式**：必须从 src_dir_tree 证据中推断，不能猜测
5. **禁止泛化描述**：不使用 "组件目录，包含 UI 组件" 这类废话
6. **禁止遗漏忽略目录**：`ai-knowledge/`、`.codegraph/`、`node_modules/`、`dist/` 必须在忽略目录列表中
7. **禁止遗漏编码指导**：所有表格必须有 coding_guide 字段

## 输入证据说明

你将收到以下证据：

- project_name：项目名称
- identified_type：已识别的项目类型
- identified_tech_stack：已识别的技术栈
- top_dir_tree：顶层目录结构（3层深度）
- src_dir_tree：src 目录完整结构（8层深度）—— **关键证据，用于推断组件模式和分层目录路径**
- ignore_dirs：已识别的忽略目录

**重点**：从 src_dir_tree 中：
1. 推断组件组织模式（feature-based vs type-based）
2. 提取分层目录的实际路径
3. 提取具体的 feature 目录名称

根据这些证据生成架构概览，不虚构不存在的信息。