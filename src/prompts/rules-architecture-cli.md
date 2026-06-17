# CLI 工具架构概览生成规则

## 任务说明

你需要为一个 CLI 工具项目生成架构概览知识。架构概览帮助 AI Agent 快速建立对项目的全局认知，并指导编码时的代码定位。

架构概览回答的问题：

- 这个项目是什么类型？使用什么技术栈？
- 命令组织方式是什么？（每个命令独立文件还是集中定义）
- 新命令应该放哪？
- 命令接口约定是什么？
- 哪些目录不需要浏览？
- 是否支持库化调用？

**核心原则**：架构概览必须提供可操作的编码定位信息，不能只给出宽泛的描述。

## 输出格式

输出一个 JSON 对象，包含以下字段：

```json
{
  "architecture_overview_name": "项目名称 + 架构概览",
  "summary_zh": "一句话定位",
  "project_type": "cli-tool",
  "tech_stack": ["技术栈列表"],
  "command_mode": "独立文件 | 集中定义 | 模块化",
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
  "export_structure": "导出结构说明（如支持库化调用）",
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

格式：`技术栈 + CLI 工具 + 主要功能`

示例：

- 正确："TypeScript CLI 工具，提供代码模板生成能力"
- 错误："TypeScript CLI 工具，采用 Commander.js 和模块化命令组织"（过于技术化）

### project_type

固定为 `cli-tool`。

### tech_stack

列出主要技术栈，不超过 5 个。

示例：`["TypeScript", "Commander.js", "Inquirer.js"]`

### command_mode（命令组织模式）—— **必填且必须准确**

从 src_dir_tree 证据中推断命令组织模式，有以下三种：

**独立文件模式**：

- 特征：commands/ 目录下每个命令一个独立文件
- 示例结构：
  ```
  src/
  ├── commands/
  │   ├── generate.ts
  │   ├── build.ts
  │   ├── deploy.ts
  ├── cli.ts
  ```

**集中定义模式**：

- 特征：所有命令在一个文件中定义（通常是 cli.ts 或 index.ts）
- 示例结构：
  ```
  src/
  ├── cli.ts      ← 所有命令定义在这
  ├── lib/
  ```

**模块化模式**：

- 特征：每个命令是一个模块/类，有统一的命令注册机制
- 示例结构：
  ```
  src/
  ├── commands/
  │   ├── generate/
  │   │   ├── index.ts
  │   │   ├── options.ts
  │   │   ├── handler.ts
  │   ├── build/
  │   │   ├── index.ts
  ├── cli.ts
  ```

**判断方法**：

1. 查看 src_dir_tree 中是否存在 commands/ 目录
2. 如果 commands/ 下有多个独立文件（generate.ts、build.ts）→ 独立文件模式
3. 如果没有 commands/ 目录，命令逻辑在 cli.ts 或单一文件 → 集中定义模式
4. 如果 commands/ 下每个命令是一个目录（generate/、build/）→ 模块化模式

**必须从实际目录结构推断，不能猜测或使用示例模板**。

### layer_directory_paths（分层目录路径）—— **核心字段，必填**

提供每个分层的具体目录路径，这是 Agent 定位代码的关键信息。

采用表格形式，每个条目包含三个字段：

| 字段           | 要求                                         |
| -------------- | -------------------------------------------- |
| layer          | 分层名称：Commands、CLI Entry、Utils、Lib 等 |
| directory_path | 完整目录路径，从证据中提取                   |
| coding_guide   | 编码时指导——新代码放哪                       |

**独立文件模式示例**：

```json
[
  {
    "layer": "Commands",
    "directory_path": "src/commands/",
    "coding_guide": "新命令在此创建独立文件，如 src/commands/publish.ts"
  },
  {
    "layer": "CLI Entry",
    "directory_path": "src/cli.ts",
    "coding_guide": "命令行解析和路由，注册新命令在这里引入"
  },
  {
    "layer": "Utils",
    "directory_path": "src/utils/",
    "coding_guide": "工具函数，如 file-utils.ts、logger.ts"
  }
]
```

**模块化模式示例**：

```json
[
  {
    "layer": "Commands",
    "directory_path": "src/commands/<command>/",
    "coding_guide": "新命令创建目录，如 src/commands/publish/"
  },
  {
    "layer": "Command Index",
    "directory_path": "src/commands/<command>/index.ts",
    "coding_guide": "命令入口，导出命令定义"
  },
  {
    "layer": "Command Handler",
    "directory_path": "src/commands/<command>/handler.ts",
    "coding_guide": "命令执行逻辑"
  },
  {
    "layer": "CLI Entry",
    "directory_path": "src/cli.ts",
    "coding_guide": "命令注册和路由"
  }
]
```

**必须从 src_dir_tree 证据中提取实际路径，不能使用 src/commands/<command> 这样的占位符（除非是模板路径说明）**。

### directory_structure（目录结构）

**必须采用表格形式**，每个条目包含三个字段。

**coding_guide 填写示例**：

- `"新命令在此创建独立文件"`
- `"模板生成核心逻辑"`
- `"内置模板文件"`

**必须包含的目录**（按实际存在选择）：

- src/commands/ 或 commands/（命令实现）
- src/lib/ 或 src/core/（核心逻辑）
- src/templates/ 或 templates/（模板文件）
- src/utils/（工具函数）

**最多列出 5 个目录**。

### ignore_directories（忽略目录）

**只写两类目录**：

1. **项目特定的构建产物目录**（根据 evidence 判断）
   - TypeScript CLI 通常是 `dist/`
   - Go CLI 可能是 `bin/`

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

**示例**（TypeScript CLI）：

```json
[
  { "path": "dist/", "reason": "构建产物" },
  { "path": "ai-knowledge/", "reason": "知识库生成产物" },
  { "path": ".codegraph/", "reason": "代码索引文件" }
]
```

### coding_conventions（编码约定）

描述通用的代码组织约定。

**必填约定**：

- 命令组织方式（每个命令独立文件 vs 集中定义）
- 命令命名约定
- 命令接口约定（如必须实现某个方法）

**示例**：

```json
[
  {
    "convention": "命令组织",
    "description": "每个命令独立文件，位于 src/commands/"
  },
  {
    "convention": "命名约定",
    "description": "命令文件以功能命名，如 generate.ts、build.ts"
  },
  {
    "convention": "命令接口",
    "description": "每个命令导出 name、description、execute 方法"
  }
]
```

### export_structure（导出结构）

如果项目支持库化调用（非 CLI 方式），说明导出结构和用途。

示例：`"dist/index.js 导出 Generator 类和 generate() 函数，支持程序化调用"`

如果不支持库化调用，省略此字段。

### debug_entrypoints（调试入口）

CLI 工具只有一个入口：

```json
[
  {
    "type": "CLI 入口",
    "location": "src/cli.ts",
    "description": "命令行解析和路由"
  }
]
```

### evidence

- package.json（依赖和 bin 配置）
- tsconfig.json 或类似配置
- README.md 使用方式章节

## 产物示例

```json
{
  "architecture_overview_name": "代码生成工具架构概览",
  "summary_zh": "TypeScript CLI 工具，提供代码模板生成能力",
  "project_type": "cli-tool",
  "tech_stack": ["TypeScript", "Commander.js", "Inquirer.js"],
  "command_mode": "独立文件模式",
  "layer_directory_paths": [
    {
      "layer": "Commands",
      "directory_path": "src/commands/",
      "coding_guide": "新命令在此创建独立文件，如 src/commands/publish.ts"
    },
    {
      "layer": "CLI Entry",
      "directory_path": "src/cli.ts",
      "coding_guide": "命令行解析和路由，注册新命令在这里引入"
    },
    {
      "layer": "Generators",
      "directory_path": "src/generators/",
      "coding_guide": "模板生成核心逻辑，如 Generator.ts"
    },
    {
      "layer": "Templates",
      "directory_path": "src/templates/",
      "coding_guide": "内置模板文件，使用 EJS 格式"
    }
  ],
  "directory_structure": [
    {
      "path": "src/commands/",
      "purpose": "CLI 命令实现",
      "coding_guide": "分层目录已在上方列出"
    },
    {
      "path": "src/generators/",
      "purpose": "模板生成核心逻辑",
      "coding_guide": "渲染引擎和模板组合"
    },
    {
      "path": "src/templates/",
      "purpose": "内置模板文件",
      "coding_guide": "模板文件使用 EJS 格式"
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
      "convention": "命令组织",
      "description": "每个命令独立文件，位于 src/commands/"
    },
    {
      "convention": "命名约定",
      "description": "命令文件以功能命名，如 generate.ts、build.ts"
    },
    {
      "convention": "命令接口",
      "description": "每个命令导出 name、description、execute 方法"
    }
  ],
  "export_structure": "dist/index.js 导出 Generator 类和 generate() 函数，支持程序化调用",
  "debug_entrypoints": [
    {
      "type": "CLI 入口",
      "location": "src/cli.ts",
      "description": "命令行解析和路由"
    }
  ],
  "evidence": ["package.json", "tsconfig.json", "src/commands/ 目录结构"]
}
```

## 禁止事项

1. **禁止模糊命令模式**：command_mode 必须明确 "独立文件模式"、"集中定义模式" 或 "模块化模式"，不能省略
2. **禁止占位符目录路径**：layer_directory_paths 必须使用实际目录名
3. **禁止遗漏分层目录路径**：layer_directory_paths 是核心字段，必须填写
4. **禁止虚构命令模式**：必须从 src_dir_tree 证据中推断，不能猜测
5. **禁止泛化描述**：不使用 "命令目录，包含命令实现" 这类废话
6. **禁止遗漏忽略目录**：`ai-knowledge/`、`.codegraph/`、`dist/`、`node_modules/` 必须在忽略目录列表中
7. **禁止遗漏编码指导**：所有表格必须有 coding_guide 字段
8. **禁止虚构导出结构**：只有 package.json 有 exports/main 配置时才说明导出结构

## 输入证据说明

你将收到以下证据：

- project_name：项目名称
- identified_type：已识别的项目类型
- identified_tech_stack：已识别的技术栈
- top_dir_tree：顶层目录结构（3层深度）
- src_dir_tree：src 目录完整结构（8层深度）—— **关键证据，用于推断命令模式和分层目录路径**
- ignore_dirs：已识别的忽略目录

**重点**：从 src_dir_tree 中：

1. 推断命令组织模式（独立文件 vs 集中定义 vs 模块化）
2. 提取分层目录的实际路径
3. 提取具体的命令文件名称

根据这些证据生成架构概览，不虚构不存在的信息。
