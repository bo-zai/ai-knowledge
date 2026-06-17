import type { SliceEvidenceBundle } from "./types.js";
import { getRepoBasename } from "../shared/path-utils.js";

export function buildRouteEvidence(input: {
  route: string;
  handler_file: string;
  response_keys: string[];
  error_keys: string[];
  middleware: string[];
}): SliceEvidenceBundle {
  // 解析路由方法和路径
  const [method, path] = input.route.split(" ");

  return {
    slice: {
      id: `route:${input.route}`,
      kind: "route",
      title: input.route,
      scope: input.handler_file,
      seed: input.route,
    },
    facts: [
      {
        id: "F-001",
        claim: `路由 ${input.route} 由 ${input.handler_file} 处理`,
        source_kind: "analysis-runtime",
        refs: [{ file: input.handler_file }],
      },
      {
        id: "F-002",
        claim: `响应字段: ${input.response_keys.join(", ")}`,
        source_kind: "analysis-runtime",
        refs: [{ file: input.handler_file }],
      },
      {
        id: "F-003",
        claim: `错误字段: ${input.error_keys.join(", ")}`,
        source_kind: "analysis-runtime",
        refs: [{ file: input.handler_file }],
      },
      ...(input.middleware.length > 0
        ? [
            {
              id: "F-004",
              claim: `中间件: ${input.middleware.join(" -> ")}`,
              source_kind: "analysis-runtime",
              refs: [{ file: input.handler_file }],
            },
          ]
        : []),
    ],
    symbols: [
      {
        id: `S-${input.route}-handler`,
        name: getRepoBasename(input.handler_file),
        kind: "function",
        file: input.handler_file,
        role: "handler",
      },
      ...(input.middleware.length > 0
        ? input.middleware.map((mw, idx) => ({
            id: `S-${input.route}-MW-${idx}`,
            name: mw,
            kind: "middleware",
            file: input.handler_file,
            role: "middleware",
          }))
        : []),
    ],
    relations: [],
    snippets: [],
    tables: [],
    tests: [],
    gaps:
      input.response_keys.length === 0
        ? [
            {
              id: "G-001",
              kind: "missing-response-shape",
              question: `路由 ${input.route} 的响应结构是什么？`,
              reason: "无法提取响应结构",
            },
          ]
        : [],
  };
}
