# 库/SDK 架构概览生成规则

## 任务说明

你需要为一个库/SDK 项目生成架构概览知识。架构概览帮助 AI Agent 快速建立对项目的全局认知，并指导编码时的代码定位。

架构概览回答的问题：

- 这个项目是什么类型？使用什么技术栈？
- 模块组织模式是什么？（按功能模块还是按类型）
- 新 API 应该放哪？
- 导出结构是什么？
- 哪些目录不需要浏览？

**核心原则**：架构概览必须提供可操作的编码定位信息，不能只给出宽泛的描述。

## 输出格式

输出一个 JSON 对象，包含以下字段：

```json
{
  "architecture_overview_name": "项目名称 + 架构概览",
  "summary_zh": "一句话定位",
  "project_type": "library",
  "tech_stack": ["技术栈列表"],
  "module_mode": "按功能模块 | 按类型组织 | 单文件",
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
  "export_structure": "导出结构说明",
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

格式：`技术栈 + SDK/库类型 + 主要功能`

示例：

- 正确："TypeScript HTTP 客户端 SDK，提供请求封装和拦截器支持"
- 错误："TypeScript SDK，采用模块化组织和 TypeScript 类型定义"（过于技术化）

### project_type

固定为 `library`。

### tech_stack

列出主要技术栈，不超过 5 个。

示例：`["TypeScript", "Axios", "Rollup"]`

### module_mode（模块组织模式）—— **必填且必须准确**

从 src_dir_tree 证据中推断模块组织模式，有以下三种：

**按功能模块（feature-based）**：

- 特征：src/ 下按功能模块组织，每个模块独立目录
- 示例结构：
  ```
  src/
  ├── core/           ← 核心功能
  │   ├── client.ts
  │   ├── request.ts
  ├── interceptors/   ← 拦截器模块
  │   ├── auth.ts
  │   ├── logging.ts
  ├── utils/          ← 工具模块
  ```

**按类型组织（type-based）**：

- 特征：src/ 下按类型组织，功能分散在不同类型目录
- 示例结构：
  ```
  src/
  ├── classes/
  ├── functions/
  ├── types/
  ├── constants/
  ```

**单文件模式**：

- 特征：主要逻辑在单一文件中，如 src/index.ts 或 src/main.ts
- 示例结构：
  ```
  src/
  ├── index.ts        ← 主入口，包含所有 API
  ├── types.ts        ← 类型定义（可选）
  ```

**判断方法**：

1. 查看 src_dir_tree 中目录组织方式
2. 如果有 core/、interceptors/、utils/ 等功能目录 → 按功能模块
3. 如果有 classes/、functions/、types/ 等类型目录 → 按类型组织
4. 如果只有 index.ts 或少数几个文件 → 单文件模式

**必须从实际目录结构推断，不能猜测或使用示例模板**。

### layer_directory_paths（分层目录路径）—— **核心字段，必填**

提供每个模块层的具体目录路径，这是 Agent 定位代码的关键信息。

采用表格形式，每个条目包含三个字段：

| 字段           | 要求                                                 |
| -------------- | ---------------------------------------------------- |
| layer          | 分层名称：Core、Interceptors、Utils、Types、Entry 等 |
| directory_path | 完整目录路径，从证据中提取                           |
| coding_guide   | 编码时指导——新代码放哪                               |

**按功能模块示例**：

```json
[
  {
    "layer": "Entry",
    "directory_path": "src/index.ts",
    "coding_guide": "主入口，导出所有公开 API，新 API 在此导出"
  },
  {
    "layer": "Core",
    "directory_path": "src/core/",
    "coding_guide": "核心功能实现，如 client.ts、request.ts"
  },
  {
    "layer": "Interceptors",
    "directory_path": "src/interceptors/",
    "coding_guide": "新拦截器在此实现，必须实现 Interceptor 接口"
  },
  {
    "layer": "Types",
    "directory_path": "src/types/",
    "coding_guide": "公开 API 的类型定义，所有公开接口在此声明"
  }
]
```

**单文件模式示例**：

```json
[
  {
    "layer": "Entry",
    "directory_path": "src/index.ts",
    "coding_guide": "主入口，包含所有 API 实现和导出"
  },
  {
    "layer": "Types",
    "directory_path": "src/types.ts",
    "coding_guide": "类型定义文件（如存在）"
  }
]
```

**必须从 src_dir_tree 证据中提取实际路径**。

### directory_structure（目录结构）

**必须采用表格形式**，每个条目包含三个字段。

**coding_guide 填写示例**：

- `"新 API 在此添加核心实现"`
- `"公开 API 的类型定义"`
- `"使用示例和集成指南"`

**必须包含的目录**（按实际存在选择）：

- src/core/ 或 src/lib/（核心 API 实现）
- src/types/ 或 types/（类型定义）
- src/utils/（辅助函数）
- examples/ 或 docs/（使用示例）

**最多列出 5 个目录**。

### ignore_directories（忽略目录）

**只写两类目录**：

1. **项目特定的构建产物目录**（根据 evidence 判断）
   - TypeScript 库通常是 `dist/`
   - Java 库可能是 `target/`

2. **工具生成目录**（必须包含）
   ```json
   [
     { "path": "ai-knowledge/", "reason": "知识库生成产物" },
     { "path": ".codegraph/", "reason": "代码索引文件" }
   ]
   ```

**不要写通用目录**（Agent 已知这些）：

- `.git/`、`.svn/` — 版本控制目录（Agent 已知）
- `.idea/`、`.vscode/` — IDE 配置（Agent 已知）
- `node_modules/` — npm 依赖（Agent 已知）

**示例**（TypeScript 库）：

```json
[
  { "path": "dist/", "reason": "构建产物" },
  { "path": "ai-knowledge/", "reason": "知识库生成产物" },
  { "path": ".codegraph/", "reason": "代码索引文件" }
]
```

### coding_conventions（编码约定）

描述通用的 API 设计约定。

**必填约定**：

- API 组织方式（按功能模块组织或按类型组织）
- 命名约定（导出函数/类的命名规则）
- 类型约定（如所有公开 API 必须有类型）

**示例**：

```json
[
  {
    "convention": "API 组织",
    "description": "按功能模块组织，每个模块独立目录"
  },
  {
    "convention": "命名约定",
    "description": "导出函数使用 camelCase，类使用 PascalCase"
  },
  {
    "convention": "类型约定",
    "description": "所有公开 API 必须有 TypeScript 类型定义"
  }
]
```

### export_structure（导出结构）—— **库项目必填**

**库项目必须填写此字段**。

说明 package.json 的 exports 或 main 配置，以及导出的核心 API。

示例：`"dist/index.js 导出 HttpClient 类、Interceptor 接口、RequestConfig 类型"`

### debug_entrypoints（调试入口）

库项目只有一个入口：

```json
[
  {
    "type": "API 导出",
    "location": "src/index.ts",
    "description": "主入口，导出所有公开 API"
  }
]
```

### evidence

- package.json（exports/main 配置）
- tsconfig.json 或类似配置
- README.md 使用方式章节

## 产物示例

```json
{
  "architecture_overview_name": "HTTP 客户端 SDK 架构概览",
  "summary_zh": "TypeScript HTTP 客户端 SDK，提供请求封装和拦截器支持",
  "project_type": "library",
  "tech_stack": ["TypeScript", "Axios", "Rollup"],
  "module_mode": "按功能模块",
  "layer_directory_paths": [
    {
      "layer": "Entry",
      "directory_path": "src/index.ts",
      "coding_guide": "主入口，导出所有公开 API，新 API 在此导出"
    },
    {
      "layer": "Core",
      "directory_path": "src/core/",
      "coding_guide": "核心 HTTP 客户端实现，如 client.ts、request.ts"
    },
    {
      "layer": "Interceptors",
      "directory_path": "src/interceptors/",
      "coding_guide": "新拦截器在此实现，必须实现 Interceptor 接口，如 auth-interceptor.ts"
    },
    {
      "layer": "Types",
      "directory_path": "src/types/",
      "coding_guide": "公开 API 的类型定义，如 request.types.ts、response.types.ts"
    }
  ],
  "directory_structure": [
    {
      "path": "src/core/",
      "purpose": "核心 HTTP 客户端实现",
      "coding_guide": "分层目录已在上方列出"
    },
    {
      "path": "src/interceptors/",
      "purpose": "拦截器实现",
      "coding_guide": "新拦截器在此实现"
    },
    {
      "path": "src/types/",
      "purpose": "TypeScript 类型定义",
      "coding_guide": "公开 API 的类型定义"
    },
    {
      "path": "examples/",
      "purpose": "使用示例",
      "coding_guide": "集成示例和高级用法演示"
    }
  ],
  "ignore_directories": [
    { "path": "dist/", "reason": "构建产物" },
    { "path": "node_modules/", "reason": "npm 依赖" },
    { "path": "ai-knowledge/", "reason": "知识库生成产物" },
    { "path": ".codegraph/", "reason": "代码索引文件" }
  ],
  "coding_conventions": [
    {
      "convention": "API 组织",
      "description": "按功能模块组织，每个模块独立目录"
    },
    {
      "convention": "命名约定",
      "description": "导出函数使用 camelCase，类使用 PascalCase"
    },
    {
      "convention": "类型约定",
      "description": "所有公开 API 必须有 TypeScript 类型定义"
    }
  ],
  "export_structure": "dist/index.js 导出 HttpClient 类、createClient() 函数、Interceptor 接口、RequestConfig 类型",
  "debug_entrypoints": [
    {
      "type": "API 导出",
      "location": "src/index.ts",
      "description": "主入口，导出所有公开 API"
    }
  ],
  "evidence": ["package.json", "tsconfig.json", "src/core/ 目录结构"]
}
```

## 禁止事项

1. **禁止模糊模块模式**：module_mode 必须明确 "按功能模块"、"按类型组织" 或 "单文件模式"，不能省略
2. **禁止占位符目录路径**：layer_directory_paths 必须使用实际目录名
3. **禁止遗漏分层目录路径**：layer_directory_paths 是核心字段，必须填写
4. **禁止虚构模块模式**：必须从 src_dir_tree 证据中推断，不能猜测
5. **禁止泛化描述**：不使用 "类型定义目录，包含类型" 这类废话
6. **禁止遗漏忽略目录**：`ai-knowledge/`、`.codegraph/`、`dist/`、`node_modules/` 必须在忽略目录列表中
7. **禁止遗漏编码指导**：所有表格必须有 coding_guide 字段
8. **禁止遗漏导出结构**：库项目必须说明导出结构

## 输入证据说明

你将收到以下证据：

- project_name：项目名称
- identified_type：已识别的项目类型
- identified_tech_stack：已识别的技术栈
- top_dir_tree：顶层目录结构（3层深度）
- src_dir_tree：src 目录完整结构（8层深度）—— **关键证据，用于推断模块模式和分层目录路径**
- ignore_dirs：已识别的忽略目录

**重点**：从 src_dir_tree 中：

1. 推断模块组织模式（按功能模块 vs 按类型组织 vs 单文件）
2. 提取分层目录的实际路径
3. 提取 package.json 的 exports 或 main 配置

根据这些证据生成架构概览，不虚构不存在的信息。
