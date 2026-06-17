/**
 * Java 语言适配器
 *
 * 实现 Java 特有的 import 解析、点号访问提取和枚举发现逻辑。
 */

import type { LanguageAdapter, InternalEnum, NamingPatterns } from "./index.js";

/**
 * Java 命名模式配置
 *
 * 定义 Java/Spring 项目中常见的类命名约定和目录结构
 */
const JAVA_NAMING_PATTERNS: NamingPatterns = {
  entryPointSuffixes: ["Controller", "RestController", "Api", "Handler"],
  dataModelSuffixes: [
    "Entity",
    "DO",
    "VO",
    "DTO",
    "Config",
    "Property",
    "Model",
  ],
  enumPatterns: ["Enum", "Type", "Kind"],
  innerClassSeparator: "$",
  transmissionSuffixes: [
    "VO",
    "DTO",
    "Request",
    "Response",
    "Param",
    "Query",
    "Form",
    "Data",
  ],
  configSuffixes: ["Config", "Configuration", "Properties", "Settings"],
  // 架构证据收集配置
  layerNames: [
    "controller",
    "service",
    "repository",
    "dao",
    "domain",
    "application",
    "infrastructure",
    "web",
    "api",
  ],
  componentDirs: [], // Java 后端项目通常没有前端组件目录
  commandDirs: [], // Java 后端项目通常不是 CLI
  apiDirs: ["api", "facade", "external"],
  routingFiles: [], // Java 后端项目通常没有前端路由文件
  stateDirs: [], // Java 后端项目通常没有前端状态管理
  exportFiles: [], // Java 后端项目通常没有模块导出文件
};

/**
 * Java 点号访问表达式提取规则
 *
 * 匹配模式：
 * - SomeEnum.VALUE.method() - 枚举值调用方法
 * - SomeEnum.VALUE - 枚举值访问
 * - SomeUtil.CONSTANT - 常量访问
 * - SomeClass.staticField - 静态字段访问
 */
const JAVA_DOT_ACCESS_REGEX =
  /\b([A-Z][a-zA-Z0-9_]*)\.([A-Z_][A-Z0-9_]*)(?:\.[a-zA-Z]+)?\b/g;

/**
 * Java import 语句提取规则
 */
const JAVA_IMPORT_REGEX = /^import\s+([a-zA-Z0-9_.]+);\s*$/gm;

/**
 * Java 枚举定义提取规则
 *
 * 匹配模式：
 * - public enum RoleTypeEnum implements IEnum<Integer> { ... }
 * - public enum Status { ... }
 *
 * 注意：只匹配枚举头，枚举体通过 extractEnumBody 函数提取
 * 因为枚举体可能跨越多行并包含嵌套括号
 */
const JAVA_ENUM_DEF_REGEX =
  /public\s+enum\s+(\w+)\s*(?:implements\s+[^\{]+)?\s*\{/g;

/**
 * 技术库包路径模式（不应作为业务概念）
 */
const TECH_PACKAGE_PATTERNS = [
  /^java\./, // Java 标准库
  /^javax\./, // Java 扩展库
  /^org\.apache\./, // Apache 库
  /^org\.springframework\./, // Spring 框架
  /^com\.fasterxml\./, // Jackson/FastXML
  /^org\.slf4j\./, // 日志框架
  /^lombok\./, // Lombok
  /^org\.projectlombok\./,
  /^com\.google\./, // Google 库（Guava 等）
  /^org\.json\./, // JSON 库
  /^com\.alibaba\.fastjson\./, // Fastjson
];

/**
 * 业务包路径模式（可能是业务概念）
 */
const BUSINESS_PACKAGE_PATTERNS = [
  /enums/i, // 包含 enums 的包路径
  /constant/i, // 包含 constant 的包路径
  /\.core\./, // 核心业务包（如 com.company.core.enums）
  /\.domain\./, // 领域模型包
  /\.model\./, // 模型包
];

/**
 * 简单枚举值模式（命名自解释，不值得生成知识）
 */
const SELF_EXPLAINING_ENUM_VALUES = [
  ["MALE", "FEMALE"],
  ["TRUE", "FALSE"],
  ["YES", "NO"],
  ["ON", "OFF"],
  ["ENABLE", "DISABLE"],
  ["ACTIVE", "INACTIVE"],
];

/**
 * Java 语言适配器实现
 */
export const javaAdapter: LanguageAdapter = {
  language: "java",
  namingPatterns: JAVA_NAMING_PATTERNS,

  /**
   * 提取 Java 代码中的点号访问表达式
   */
  extractDotAccesses(codeSnippet: string): string[] {
    const matches: string[] = [];
    const regex = new RegExp(JAVA_DOT_ACCESS_REGEX);

    let match;
    while ((match = regex.exec(codeSnippet)) !== null) {
      // match[0] 是完整匹配（如 OrderStatusEnum.PROCESSING）
      // match[1] 是根符号（如 OrderStatusEnum）
      // match[2] 是二级符号（如 PROCESSING）

      // 至少两级访问才可能是枚举/常量
      if (match[0].includes(".")) {
        matches.push(match[0]);
      }
    }

    return matches;
  },

  /**
   * 提取 Java 代码中的外部 import 语句
   */
  extractExternalImports(codeSnippet: string): string[] {
    const imports: string[] = [];
    const regex = new RegExp(JAVA_IMPORT_REGEX);

    let match;
    while ((match = regex.exec(codeSnippet)) !== null) {
      const importPath = match[1];
      // 排除技术库
      if (!isTechPackage(importPath)) {
        imports.push(importPath);
      }
    }

    return imports;
  },

  /**
   * 判断引用是否可能是业务枚举/常量
   */
  isBusinessRef(refExpression: string, externalImports: string[]): boolean {
    const rootSymbol = refExpression.split(".")[0];

    // 1. 检查是否有对应的 import 语句
    const matchingImport = externalImports.find(
      (imp) =>
        imp.endsWith("." + rootSymbol) || imp.includes("." + rootSymbol + "."),
    );

    if (matchingImport) {
      // 有 import，检查是否是业务包路径
      return isBusinessPackage(matchingImport);
    }

    // 2. 无 import，检查符号命名特征
    // Enum 后缀通常是业务枚举
    if (rootSymbol.endsWith("Enum") || rootSymbol.endsWith("Type")) {
      return true;
    }

    // Util + 大写常量可能是业务常量
    if (rootSymbol.endsWith("Util") || rootSymbol.endsWith("Constants")) {
      const secondPart = refExpression.split(".")[1];
      if (secondPart && /^[A-Z_]+$/.test(secondPart)) {
        return true;
      }
    }

    return false;
  },

  /**
   * 发现 Java 代码中的内部枚举定义
   *
   * 使用两步匹配：
   * 1. 匹配枚举声明头（public enum Name {）
   * 2. 提取枚举体直到闭合括号（处理多行和嵌套）
   */
  discoverInternalEnums(code: string): InternalEnum[] {
    const enums: InternalEnum[] = [];
    const regex = new RegExp(JAVA_ENUM_DEF_REGEX);

    let match;
    while ((match = regex.exec(code)) !== null) {
      const enumName = match[1];
      const startIndex = regex.lastIndex;

      // 从当前位置提取枚举体（直到闭合括号）
      const enumBody = extractEnumBody(code, startIndex);

      if (enumBody) {
        // 提取枚举值（排除方法定义）
        const values = extractJavaEnumValues(enumBody);

        enums.push({
          name: enumName,
          values,
          contextSnippet: `public enum ${enumName} { ${values.slice(0, 5).join(", ")}...`,
        });
      }
    }

    return enums;
  },

  /**
   * 判断 Java 内部枚举是否值得生成知识
   */
  isInternalEnumWorthGenerating(enumInfo: InternalEnum): boolean {
    const { values } = enumInfo;

    // 值少于 3 个的枚举通常不值得生成
    if (values.length < 3) {
      return false;
    }

    // 命名自解释的枚举不值得生成（如 MALE/FEMALE）
    if (isSelfExplainingEnum(values)) {
      return false;
    }

    return true;
  },
};

/**
 * 判断包路径是否是技术库
 */
function isTechPackage(packagePath: string): boolean {
  return TECH_PACKAGE_PATTERNS.some((pattern) => pattern.test(packagePath));
}

/**
 * 判断包路径是否可能是业务包
 */
function isBusinessPackage(packagePath: string): boolean {
  return BUSINESS_PACKAGE_PATTERNS.some((pattern) => pattern.test(packagePath));
}

/**
 * 提取枚举体（从当前位置到闭合括号）
 *
 * 处理多行枚举体和嵌套括号（如方法定义）
 */
function extractEnumBody(code: string, startIndex: number): string | null {
  let depth = 1;
  let i = startIndex;
  let body = "";

  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return body;
      }
    }
    body += ch;
    i++;
  }

  return null;
}

/**
 * 提取 Java 枚举体中的枚举值
 */
function extractJavaEnumValues(enumBody: string): string[] {
  const values: string[] = [];

  // Java 枚举值模式：大写字母开头，可能后跟括号
  // 如 SUPER_ADMIN(1), STUDENT(5), ACTIVE
  const VALUE_REGEX = /^[A-Z_][A-Z0-9_]*(\s*[;(,]|$)/;

  const lines = enumBody.split(/[;\n,]/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*"))
      continue;

    // 匹配枚举值
    if (VALUE_REGEX.test(trimmed)) {
      const valueName = trimmed.split(/[;(,\s]/)[0];
      if (valueName && valueName.length > 1) {
        values.push(valueName);
      }
    }
  }

  return values;
}

/**
 * 判断枚举值是否命名自解释
 */
function isSelfExplainingEnum(values: string[]): boolean {
  const upperValues = values.map((v) => v.toUpperCase());
  return SELF_EXPLAINING_ENUM_VALUES.some((pattern) => {
    return pattern.every((v) => upperValues.includes(v));
  });
}
