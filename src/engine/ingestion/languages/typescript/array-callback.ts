/**
 * Array method callback detection utilities.
 *
 * Identifies arrow functions used as callbacks to Array higher-order methods
 * (map, filter, reduce, etc.) to exclude them from function declaration scope
 * analysis.
 */

import type { SyntaxNode } from "../../utils/ast-helpers.js";

/** Array methods that take function callbacks. */
const ARRAY_HIGHER_ORDER_METHODS = new Set([
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "flatMap",
  "forEach",
  "sort",
]);

/**
 * Check if an arrow_function node is a callback to an Array higher-order method.
 *
 * Matches patterns like:
 *   - arr.map(x => ...)
 *   - arr.filter(x => ...)
 *   - [1,2,3].reduce((a,b) => ...)
 *
 * Returns true if the arrow function is the callee of a call_expression whose
 * function is a member_expression with a known Array method property.
 */
export function isArrayMethodCallbackArrow(node: SyntaxNode): boolean {
  if (node.type !== "arrow_function") {
    return false;
  }

  // Walk up to find the parent call_expression
  let parent = node.parent;
  while (parent !== null) {
    if (parent.type === "call_expression") {
      // Check if this arrow function is the function (callee) of the call
      const functionNode = parent.childForFieldName("function");
      if (functionNode === node) {
        // Check if the function is a member_expression with a known Array method
        if (functionNode.type === "member_expression") {
          const propertyNode = functionNode.childForFieldName("property");
          if (propertyNode !== null) {
            const methodName = propertyNode.text;
            return ARRAY_HIGHER_ORDER_METHODS.has(methodName);
          }
        }
      }
      // Not the callee of a call_expression, stop searching
      break;
    }
    parent = parent.parent;
  }

  return false;
}