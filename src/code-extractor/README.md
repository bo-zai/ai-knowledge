# src/code-extractor/ 目录架构规划

## 1. 核心问题

当前概念知识生成流程中，大部分候选类"无代码片段"，原因是：
- `src/shared/fs.ts` 的正则提取不支持 `implements`/`extends` 等复杂类声明
- 图数据库 `Property.content` 只存储字段声明 + 上下文几行，不是完整类代码

**需要一个新的代码提取模块**，专门为知识生成流程提供结构化代码片段。

## 2. 设计目标

1. **统一接口**：一套 API 适配所有语言
2. **双路径策略**：
   - 优先路径：从图数据库查询（快，利用已有 Tree-sitter 解析）
   - Fallback 路径：直接解析文件（当图数据不完整时）
3. **结构化输出**：返回类声明、字段列表、方法签名、原始片段
4. **可扩展**：每种语言可独立配置提取策略

## 3. 目录结构

```
src/code-extractor/
├── index.ts                    # 主入口，导出 extractClassCode 等函数
├── types.ts                    # 核心类型定义
├── extractor-base.ts           # 基础提取器抽象类
├── graph-querier.ts            # 图数据库查询器（优先路径）
├── file-parser.ts              # 文件解析器（Fallback 路径）
└── languages/
    ├── java.ts                 # Java 提取策略
    ├── typescript.ts           # TypeScript 提取策略
    ├── python.ts               # Python 提取策略
    ├── go.ts                   # Go 提取策略
    ├── rust.ts                 # Rust 提取策略
    └── ...                     # 其他语言
```

## 4. 核心类型定义 (types.ts)

```typescript
/**
 * 提取的类代码结构
 */
export interface ExtractedClassCode {
  /** 类名 */
  className: string;
  /** 文件路径 */
  filePath: string;
  /** 开始行号 */
  startLine: number;
  /** 结束行号 */
  endLine: number;
  
  /** 类声明片段（类头部，含 extends/implements） */
  classDeclaration: string;
  /** 类声明行号范围 */
  declarationLines: { start: number; end: number };
  
  /** 字段列表（含类型、修饰符） */
  fields: ExtractedField[];
  /** 方法签名列表（不含方法体） */
  methods: ExtractedMethod[];
  
  /** 原始代码片段（完整类代码，用于 LLM 分析） */
  fullSnippet: string;
  
  /** 精简代码片段（类声明 + 字段 + 方法签名，不含方法体） */
  compactSnippet: string;
}

export interface ExtractedField {
  name: string;
  type?: string;
  modifiers?: string[];  // public, private, static, final, etc.
  line: number;
  content: string;       // 字段声明原文
}

export interface ExtractedMethod {
  name: string;
  returnType?: string;
  parameters?: number;   // 参数数量
  modifiers?: string[];
  signature: string;     // 方法签名原文（不含方法体）
  line: number;
}

/**
 * 提取选项
 */
export interface ExtractOptions {
  /** 最大代码片段长度（字符） */
  maxSnippetLength?: number;
  /** 是否包含方法体 */
  includeMethodBody?: boolean;
  /** 是否包含注释 */
  includeComments?: boolean;
  /** 优先路径：图数据库连接 */
  graphConnection?: GraphConnection;
}

/**
 * 语言提取策略接口
 */
export interface LanguageExtractorStrategy {
  language: SupportedLanguages;
  
  /** 从图节点提取类结构 */
  extractFromGraphNode(node: GraphClassNode): ExtractedClassCode | null;
  
  /** 从 AST 节点提取类结构 */
  extractFromAstNode(node: SyntaxNode, sourceCode: string): ExtractedClassCode | null;
  
  /** 判断是否需要 Fallback（图数据不完整） */
  needsFallback?(node: GraphClassNode): boolean;
}
```

## 5. 主入口 API (index.ts)

```typescript
/**
 * 提取类代码片段
 * 
 * 双路径策略：
 * 1. 优先从图数据库查询 Class + Property + Method 节点
 * 2. 若图数据不完整，Fallback 到文件解析
 */
export async function extractClassCode(
  filePath: string,
  className: string,
  options?: ExtractOptions,
): Promise<ExtractedClassCode | null>;

/**
 * 批量提取多个类的代码片段
 */
export async function extractClassCodes(
  candidates: Array<{ filePath: string; className: string }>,
  options?: ExtractOptions,
): Promise<Map<string, ExtractedClassCode | null>>;

/**
 * 获取语言提取策略
 */
export function getExtractorStrategy(language: SupportedLanguages): LanguageExtractorStrategy;
```

## 6. 图数据库查询器 (graph-querier.ts)

**优先路径**：利用已有的 Tree-sitter 解析结果，从图数据库查询。

```typescript
/**
 * 从图数据库查询类节点及其成员
 */
export async function queryClassFromGraph(
  conn: Connection,
  filePath: string,
  className: string,
): Promise<GraphClassNode | null>;

/**
 * 查询类的字段列表（Property 节点）
 */
export async function queryClassProperties(
  conn: Connection,
  classId: string,
): Promise<GraphPropertyNode[]>;

/**
 * 查询类的方法列表（Method 节点）
 */
export async function queryClassMethods(
  conn: Connection,
  classId: string,
): Promise<GraphMethodNode[]>;
```

**关键 Cypher 查询**：

```cypher
// 查询类节点（含完整 content）
MATCH (c:Class {name: $className, filePath: $filePath})
RETURN c.id, c.name, c.filePath, c.startLine, c.endLine, c.content

// 查询类的字段
MATCH (c:Class {id: $classId})-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:`Property`)
RETURN p.name, p.content, p.startLine

// 查询类的方法
MATCH (c:Class {id: $classId})-[r:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
RETURN m.name, m.returnType, m.parameterCount, m.startLine, m.endLine, m.content
```

## 7. 文件解析器 (file-parser.ts)

**Fallback 路径**：当图数据不完整时，直接解析文件。

```typescript
/**
 * 解析文件并提取类结构
 * 
 * 使用 Tree-sitter 解析文件，提取类声明、字段、方法。
 */
export async function parseFileAndExtractClass(
  filePath: string,
  className: string,
  language: SupportedLanguages,
): Promise<ExtractedClassCode | null>;
```

**实现要点**：
- 使用现有的 Tree-sitter 解析器（复用 `src/engine/ingestion/` 的逻辑）
- 提取类声明节点，遍历其子节点提取字段和方法
- 构建完整片段和精简片段

## 8. Java 提取策略 (languages/java.ts)

```typescript
import type { LanguageExtractorStrategy } from '../types.js';
import { SupportedLanguages } from '../../engine/shared/index.js';

export const javaExtractorStrategy: LanguageExtractorStrategy = {
  language: SupportedLanguages.Java,

  extractFromGraphNode(node): ExtractedClassCode | null {
    // 从 Class.content 提取类声明（第一行到第一个 {）
    // 从 Property 节点提取字段
    // 从 Method 节点提取方法签名（从 content 中截取签名部分）
    ...
  },

  extractFromAstNode(node, sourceCode): ExtractedClassCode | null {
    // 使用 Tree-sitter 解析：
    // - class_declaration 节点
    // - class_body 子节点
    // - field_declaration 和 method_declaration
    ...
  },

  needsFallback(node): boolean {
    // 若 Class.content 缺失或 Property 节点缺失，需要 Fallback
    return !node.content || node.content.length < 50;
  },
};
```

## 9. 数据流

```
知识生成流程
    ↓
extractClassCode(filePath, className)
    ↓
[图数据库查询]
    ↓
Class 节点存在？ → [提取类结构]
    ↓ 否
[文件解析 Fallback]
    ↓
返回 ExtractedClassCode
    ↓
生成 evidence 字段 + 代码片段
```

## 10. 与现有代码的集成

| 现有模块 | 集成方式 |
|---------|---------|
| `src/evidence/type-evidence-builder.ts` | 调用 `extractClassCode` 替代现有正则提取 |
| `src/engine/lbug/lbug-adapter.ts` | 复用图查询逻辑 |
| `src/engine/ingestion/class-extractors/` | 复用 Tree-sitter 解析配置 |
| `src/engine/ingestion/field-extractors/` | 复用字段提取逻辑 |

## 11. 实施步骤

| 步骤 | 工作量 | 输出 |
|------|--------|------|
| 1. 创建目录和类型定义 | 0.5h | `types.ts` |
| 2. 实现图查询器 | 1h | `graph-querier.ts` |
| 3. 实现 Java 提取策略 | 1h | `languages/java.ts` |
| 4. 实现文件解析器 | 1h | `file-parser.ts` |
| 5. 实现主入口 API | 0.5h | `index.ts` |
| 6. 集成到知识生成流程 | 1h | `type-evidence-builder.ts` |
| 7. 添加 TypeScript 策略 | 0.5h | `languages/typescript.ts` |

**总计：约 5.5h**