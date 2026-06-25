/**
 * TypeScript/JavaScript higher-order component (HOC) utilities.
 *
 * Utilities for detecting and handling default-exported HOCs in React code.
 */

import type { SyntaxNode } from "./utils/ast-helpers.js";
import path from "node:path";

/** HOC factory names that should be blocked from default export analysis. */
const BLOCKED_HOC_FACTORY_NAMES = new Set([
  "memo",
  "forwardRef",
  "connect",
  "withRouter",
  "withStyles",
  "withTheme",
  "compose",
  "flowRight",
  "throttle",
  "debounce",
]);

/**
 * Tree-sitter query predicate to exclude array higher-order method callbacks.
 *
 * Matches `@callee` nodes that are NOT one of the known Array methods
 * (map, filter, reduce, etc.). This prevents false positives like:
 *   const x = arr.map(a => ...)
 * from being treated as function declarations.
 */
export const ARRAY_METHOD_NOT_ANY_OF_PREDICATE =
  "#not-any-of? @callee map filter reduce reduceRight find findIndex findLast findLastIndex some every flatMap forEach sort";

/**
 * Tree-sitter query predicate to exclude blocked HOC factory names.
 *
 * Matches `@callee` nodes that are NOT one of the blocked HOC factories
 * (memo, forwardRef, connect, etc.).
 */
export const DEFAULT_EXPORT_IDENTIFIER_NOT_ANY_OF_PREDICATE =
  "#not-any-of? @callee memo forwardRef connect withRouter withStyles withTheme compose flowRight throttle debounce";

/**
 * Check if a function node is a blocked default-exported HOC.
 *
 * Blocked HOCs are wrapper functions created by known HOC factories like
 * memo(), forwardRef(), connect(), etc. These should not be treated as
 * regular function declarations.
 */
export function isBlockedDefaultExportHoc(node: SyntaxNode): boolean {
  if (node.type !== "arrow_function" && node.type !== "function_expression") {
    return false;
  }

  // Walk up to find the parent export_statement or variable_declarator
  let parent = node.parent;
  while (parent !== null) {
    if (parent.type === "export_statement") {
      // Check if the exported value is a call_expression with a blocked HOC factory
      const exportedNode = parent.childForFieldName("value");
      if (exportedNode !== null && exportedNode.type === "call_expression") {
        const functionNode = exportedNode.childForFieldName("function");
        if (functionNode !== null) {
          if (functionNode.type === "identifier") {
            const factoryName = functionNode.text;
            return BLOCKED_HOC_FACTORY_NAMES.has(factoryName);
          }
          if (functionNode.type === "member_expression") {
            const propertyNode = functionNode.childForFieldName("property");
            if (propertyNode !== null) {
              const factoryName = propertyNode.text;
              return BLOCKED_HOC_FACTORY_NAMES.has(factoryName);
            }
          }
        }
      }
      break;
    }
    if (parent.type === "variable_declarator") {
      // Check const X = memo(Component)
      const valueNode = parent.childForFieldName("value");
      if (valueNode !== null && valueNode.type === "call_expression") {
        const functionNode = valueNode.childForFieldName("function");
        if (functionNode !== null) {
          if (functionNode.type === "identifier") {
            const factoryName = functionNode.text;
            return BLOCKED_HOC_FACTORY_NAMES.has(factoryName);
          }
          if (functionNode.type === "member_expression") {
            const propertyNode = functionNode.childForFieldName("property");
            if (propertyNode !== null) {
              const factoryName = propertyNode.text;
              return BLOCKED_HOC_FACTORY_NAMES.has(factoryName);
            }
          }
        }
      }
      break;
    }
    parent = parent.parent;
  }

  return false;
}

/**
 * Check if a function node is a default-exported HOC function.
 *
 * Matches patterns like:
 *   - export default function Component() {}
 *   - export default (props) => {}
 */
export function isDefaultExportHocFunctionNode(node: SyntaxNode): boolean {
  if (node.type !== "arrow_function" && node.type !== "function_expression") {
    return false;
  }

  // Walk up to find the export_statement
  let parent = node.parent;
  while (parent !== null) {
    if (parent.type === "export_statement") {
      // Check if this is a default export
      const exportKind = parent.childForFieldName("declaration_kind");
      if (exportKind !== null && exportKind.text === "default") {
        return true;
      }
      break;
    }
    parent = parent.parent;
  }

  return false;
}

/**
 * Derive a default-exported HOC's name from the file path.
 *
 * When a component is exported as default without a name, derive the name
 * from the file path (e.g., src/components/Button/index.tsx -> "Button").
 */
export function deriveDefaultExportHocName(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));

  // If the file is named "index", use the parent directory name
  if (basename === "index") {
    const dirName = path.basename(path.dirname(filePath));
    return dirName;
  }

  return basename;
}