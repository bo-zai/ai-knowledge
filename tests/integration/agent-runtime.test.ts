import fs from "fs/promises";
import os from "os";
import path from "path";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBudgetState,
  createLocalReadToolHandlers,
  createLocalReadTools,
  createTraceCollector,
  parseKnowledgeReadAgentOutput,
  resolveKnowledgeReadLimits,
  routeAfterBudgetCheck,
  routeAfterValidation,
  runKnowledgeReadRuntime,
  buildForcedInsufficientOutput,
  validateFinalOutput,
} from "../../src/agent-read-runtime/index.js";
import type { LocalReadToolHandlers } from "../../src/agent-read-runtime/local-read-tools.js";
import type { BudgetState } from "../../src/agent-read-runtime/context-budget.js";
import type { KnowledgeReadLimits } from "../../src/agent-read-runtime/types.js";

/**
 * Agent Runtime 集成测试
 *
 * 测试完整的调用流程，包括：
 * - Agent Runtime 创建和配置
 * - 路由系统决策逻辑
 * - 文件操作能力
 * - 预算控制和追踪
 */
describe("Agent Runtime Integration", () => {
  describe("Runtime Creation and Configuration", () => {
    it("creates local read tools with correct schema", () => {
      const budget = createBudgetState(resolveKnowledgeReadLimits());
      const trace = createTraceCollector();
      const tools = createLocalReadTools({
        repoPath: "/dummy/path",
        budget,
        trace,
      });

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("read_file_window");
      expect(toolNames).toContain("search_repo_text");
      expect(toolNames).toContain("read_symbol_definition");
      expect(toolNames).toContain("read_symbol_references");
      expect(toolNames).toContain("read_related_tests");
    });

    it("resolves knowledge read limits with defaults", () => {
      const limits = resolveKnowledgeReadLimits();
      expect(limits.maxToolCalls).toBe(8);
      expect(limits.maxToolResultChars).toBe(12_000);
      expect(limits.maxTotalToolResultChars).toBe(40_000);
      expect(limits.maxFileWindowLines).toBe(240);
      expect(limits.searchResultLimit).toBe(30);
      expect(limits.maxSearchFileBytes).toBe(512_000);
    });

    it("allows custom limits to override defaults", () => {
      const limits = resolveKnowledgeReadLimits({
        maxToolCalls: 3,
        maxToolResultChars: 5_000,
      });
      expect(limits.maxToolCalls).toBe(3);
      expect(limits.maxToolResultChars).toBe(5_000);
      // 其他值保持默认
      expect(limits.maxTotalToolResultChars).toBe(40_000);
    });

    it("creates budget state with correct initial values", () => {
      const limits: KnowledgeReadLimits = {
        maxToolCalls: 5,
        maxToolResultChars: 10_000,
        maxTotalToolResultChars: 30_000,
        maxFileWindowLines: 100,
        searchResultLimit: 20,
        maxSearchFileBytes: 100_000,
      };
      const budget = createBudgetState(limits);
      expect(budget.limits).toEqual(limits);
      expect(budget.toolCallsUsed).toBe(0);
      expect(budget.totalToolResultChars).toBe(0);
    });

    it("creates trace collector with correct initial state", () => {
      const trace = createTraceCollector();
      const finalized = trace.finalize();
      expect(finalized.toolCalls).toEqual([]);
      expect(finalized.totalToolResultChars).toBe(0);
      expect(typeof finalized.startedAt).toBe("string");
      expect(typeof finalized.finishedAt).toBe("string");
      expect(finalized.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Routing System Integration", () => {
    describe("routeAfterBudgetCheck", () => {
      it("routes to model_decide when budget is available and no final text", () => {
        const route = routeAfterBudgetCheck({
          budgetExceeded: false,
          finalText: undefined,
        });
        expect(route).toBe("model_decide");
      });

      it("routes to force_insufficient_output when budget is exhausted and no final text", () => {
        const route = routeAfterBudgetCheck({
          budgetExceeded: true,
          finalText: undefined,
        });
        expect(route).toBe("force_insufficient_output");
      });

      it("routes to output_validate when final text exists regardless of budget", () => {
        // 有 finalText 时，优先验证
        expect(
          routeAfterBudgetCheck({
            budgetExceeded: false,
            finalText: "some result",
          }),
        ).toBe("output_validate");

        expect(
          routeAfterBudgetCheck({
            budgetExceeded: true,
            finalText: "some result",
          }),
        ).toBe("output_validate");
      });
    });

    describe("routeAfterValidation", () => {
      it("routes to END when output is successfully parsed", () => {
        const route = routeAfterValidation({
          parsedOutput: {
            answer: "test answer",
            evidence_refs: [],
            insufficient_evidence: false,
          },
          validationError: undefined,
          repairAttempts: 0,
        });
        expect(route).toBe("__end__");
      });

      it("routes to repair_output on first validation failure", () => {
        const route = routeAfterValidation({
          parsedOutput: undefined,
          validationError: "Invalid JSON",
          repairAttempts: 0,
        });
        expect(route).toBe("repair_output");
      });

      it("routes to failed when repair attempts are exhausted", () => {
        const route = routeAfterValidation({
          parsedOutput: undefined,
          validationError: "Invalid JSON",
          repairAttempts: 1,
        });
        expect(route).toBe("failed");
      });

      it("routes to failed when validation error without repair", () => {
        const route = routeAfterValidation({
          parsedOutput: undefined,
          validationError: "Schema validation failed",
          repairAttempts: 2,
        });
        expect(route).toBe("failed");
      });
    });

    describe("validateFinalOutput", () => {
      it("parses valid JSON output into correct structure", () => {
        const result = validateFinalOutput({
          finalText: JSON.stringify({
            answer: "The function processes orders.",
            evidence_refs: [
              {
                file: "src/order.ts",
                start_line: 10,
                end_line: 20,
                note: "Main logic",
              },
            ],
            insufficient_evidence: false,
          }),
          repairAttempts: 0,
        });

        expect(result.parsedOutput).toBeDefined();
        expect(result.parsedOutput?.answer).toBe(
          "The function processes orders.",
        );
        expect(result.parsedOutput?.evidence_refs).toHaveLength(1);
        expect(result.parsedOutput?.evidence_refs[0]?.file).toBe(
          "src/order.ts",
        );
        expect(result.validationError).toBeUndefined();
      });

      it("handles multiple evidence refs correctly", () => {
        const result = validateFinalOutput({
          finalText: JSON.stringify({
            answer: "Multiple sources found.",
            evidence_refs: [
              {
                file: "src/a.ts",
                start_line: 1,
                end_line: 5,
                note: "Source A",
              },
              {
                file: "src/b.ts",
                start_line: 10,
                end_line: 15,
                note: "Source B",
              },
              {
                file: "src/c.ts",
                start_line: 20,
                end_line: 25,
                note: "Source C",
              },
            ],
            insufficient_evidence: false,
          }),
          repairAttempts: 0,
        });

        expect(result.parsedOutput?.evidence_refs).toHaveLength(3);
      });

      it("captures validation error for malformed JSON", () => {
        const result = validateFinalOutput({
          finalText: "not valid json at all",
          repairAttempts: 0,
        });

        expect(result.parsedOutput).toBeUndefined();
        expect(result.validationError).toContain(
          "Agent output is not valid JSON",
        );
      });

      it("captures validation error for missing required fields", () => {
        const result = validateFinalOutput({
          finalText: JSON.stringify({
            answer: "Missing evidence refs",
            // evidence_refs 缺失
            insufficient_evidence: false,
          }),
          repairAttempts: 0,
        });

        expect(result.parsedOutput).toBeUndefined();
        expect(result.validationError).toBeDefined();
      });
    });
  });

  describe("File Operations Integration", () => {
    let tempDir: string;
    let handlers: LocalReadToolHandlers;
    let budget: BudgetState;

    beforeEach(async () => {
      // 创建临时测试目录结构
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "agent-runtime-integration-"),
      );

      // 创建测试文件
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.mkdir(path.join(tempDir, "tests"), { recursive: true });

      await fs.writeFile(
        path.join(tempDir, "src", "service.ts"),
        [
          "export class UserService {",
          "  private users: Map<string, User> = new Map();",
          "",
          "  async findById(id: string): Promise<User | undefined> {",
          "    return this.users.get(id);",
          "  }",
          "",
          "  async create(data: CreateUserDto): Promise<User> {",
          "    const user = { id: uuid(), ...data };",
          "    this.users.set(user.id, user);",
          "    return user;",
          "  }",
          "}",
        ].join("\n"),
      );

      await fs.writeFile(
        path.join(tempDir, "src", "utils.ts"),
        [
          "export function formatUser(user: User): string {",
          "  return `${user.name} <${user.email}>`;",
          "}",
          "",
          "export function validateEmail(email: string): boolean {",
          "  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);",
          "}",
        ].join("\n"),
      );

      await fs.writeFile(
        path.join(tempDir, "tests", "service.test.ts"),
        [
          "import { UserService } from '../src/service';",
          "",
          'describe("UserService", () => {',
          '  it("finds user by id", async () => {',
          "    const service = new UserService();",
          '    const user = await service.findById("test-id");',
          "    expect(user).toBeUndefined();",
          "  });",
          "",
          '  it("creates a new user", async () => {',
          "    const service = new UserService();",
          '    const user = await service.create({ name: "Test", email: "test@example.com" });',
          "    expect(user.id).toBeDefined();",
          "  });",
          "});",
        ].join("\n"),
      );

      // 创建 handlers
      budget = createBudgetState(resolveKnowledgeReadLimits());
      const trace = createTraceCollector();
      handlers = createLocalReadToolHandlers({
        repoPath: tempDir,
        budget,
        trace,
      });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe("readFileWindow", () => {
      it("reads file window with correct line numbers", async () => {
        const result = await handlers.readFileWindow({
          path: "src/service.ts",
          startLine: 1,
          endLine: 3,
        });

        expect(result).toContain("1 | export class UserService {");
        expect(result).toContain(
          "2 |   private users: Map<string, User> = new Map();",
        );
        expect(result).toContain("3 |");
      });

      it("reads middle section of a file", async () => {
        const result = await handlers.readFileWindow({
          path: "src/service.ts",
          startLine: 4,
          endLine: 6,
        });

        expect(result).toContain(
          "4 |   async findById(id: string): Promise<User | undefined> {",
        );
        expect(result).toContain("5 |     return this.users.get(id);");
        expect(result).toContain("6 |   }");
      });

      it("returns error for path outside repository", async () => {
        const result = await handlers.readFileWindow({
          path: "../outside-repo.ts",
          startLine: 1,
          endLine: 1,
        });
        expect(result).toContain("tool error: path is outside repo");
      });

      it("returns error for invalid line ranges", async () => {
        const result1 = await handlers.readFileWindow({
          path: "src/service.ts",
          startLine: 0,
          endLine: 5,
        });
        expect(result1).toContain("tool error: invalid line window");

        const result2 = await handlers.readFileWindow({
          path: "src/service.ts",
          startLine: 10,
          endLine: 5,
        });
        expect(result2).toContain("tool error: invalid line window");
      });

      it("returns error for line window exceeding limit", async () => {
        const result = await handlers.readFileWindow({
          path: "src/service.ts",
          startLine: 1,
          endLine: 300, // 超过默认限制 240 行
        });
        expect(result).toContain("tool error: line window exceeds limit");
      });
    });

    describe("searchRepoText", () => {
      it("finds matching lines across files", async () => {
        const result = await handlers.searchRepoText({
          query: "UserService",
          limit: 10,
        });

        expect(result).toContain("src/service.ts:1:");
        expect(result).toContain("tests/service.test.ts:1:");
        expect(result).toContain("UserService");
      });

      it("respects result limit", async () => {
        const result = await handlers.searchRepoText({
          query: "service",
          limit: 2,
        });

        const lines = result.split("\n");
        expect(lines.length).toBeLessThanOrEqual(2);
      });

      it("returns message when no matches found", async () => {
        const result = await handlers.searchRepoText({
          query: "nonexistent_function_xyz",
        });

        expect(result).toContain("no matches for");
      });

      it("returns error for empty query", async () => {
        const result = await handlers.searchRepoText({
          query: "",
        });
        expect(result).toContain("tool error: query is required");
      });
    });

    describe("readSymbolDefinition", () => {
      it("finds function definitions", async () => {
        const result = await handlers.readSymbolDefinition({
          symbol: "formatUser",
        });

        expect(result).toContain("src/utils.ts");
        expect(result).toContain("function formatUser");
      });

      it("searches for class name with function keyword", async () => {
        // 注意: readSymbolDefinition 使用 "function ${symbol}" 搜索
        // 所以对于 UserService，它会搜索 "function UserService"，不会找到 "class UserService"
        const result = await handlers.readSymbolDefinition({
          symbol: "UserService",
        });

        // 由于搜索模式是 "function UserService"，不会匹配 "class UserService"
        expect(result).toContain('no matches for "function UserService"');
      });
    });

    describe("readSymbolReferences", () => {
      it("finds symbol references across files", async () => {
        const result = await handlers.readSymbolReferences({
          symbol: "UserService",
        });

        expect(result).toContain("src/service.ts");
        expect(result).toContain("tests/service.test.ts");
      });

      it("finds function references", async () => {
        const result = await handlers.readSymbolReferences({
          symbol: "findById",
        });

        expect(result).toContain("src/service.ts");
        expect(result).toContain("tests/service.test.ts");
      });
    });

    describe("readRelatedTests", () => {
      it("finds tests containing search term", async () => {
        const result = await handlers.readRelatedTests({
          symbol: "UserService",
        });

        // UserService 出现在测试文件中
        expect(result).toContain("UserService");
      });

      it("finds tests related to a symbol", async () => {
        const result = await handlers.readRelatedTests({
          symbol: "findById",
        });

        expect(result).toContain("findById");
      });
    });

    describe("Budget Enforcement", () => {
      it("tracks tool call count correctly", async () => {
        const initialCount = budget.toolCallsUsed;

        await handlers.readFileWindow({
          path: "src/service.ts",
          startLine: 1,
          endLine: 3,
        });

        expect(budget.toolCallsUsed).toBe(initialCount + 1);
      });

      it("enforces tool call budget limit", async () => {
        // 创建一个严格限制的预算
        const strictBudget = createBudgetState({
          ...resolveKnowledgeReadLimits(),
          maxToolCalls: 1,
        });
        const trace = createTraceCollector();
        const strictHandlers = createLocalReadToolHandlers({
          repoPath: tempDir,
          budget: strictBudget,
          trace,
        });

        // 第一次调用应该成功
        const result1 = await strictHandlers.readFileWindow({
          path: "src/service.ts",
          startLine: 1,
          endLine: 3,
        });
        expect(result1).toContain("UserService");

        // 第二次调用应该被拒绝
        const result2 = await strictHandlers.readFileWindow({
          path: "src/service.ts",
          startLine: 1,
          endLine: 3,
        });
        expect(result2).toContain("tool call budget exceeded");
      });

      it("enforces total result character budget", async () => {
        const strictBudget = createBudgetState({
          ...resolveKnowledgeReadLimits(),
          maxToolCalls: 10,
          maxTotalToolResultChars: 100, // 非常小的限制
        });
        const trace = createTraceCollector();
        const strictHandlers = createLocalReadToolHandlers({
          repoPath: tempDir,
          budget: strictBudget,
          trace,
        });

        // 第一次调用消耗预算
        await strictHandlers.readFileWindow({
          path: "src/service.ts",
          startLine: 1,
          endLine: 5,
        });

        // 后续调用应该因总字符预算不足被拒绝
        const result = await strictHandlers.readFileWindow({
          path: "src/service.ts",
          startLine: 1,
          endLine: 5,
        });
        expect(result).toContain("budget");
      });
    });
  });

  describe("JSON Output Parsing Integration", () => {
    describe("parseKnowledgeReadAgentOutput", () => {
      it("parses standard JSON output", () => {
        const output = JSON.stringify({
          answer: "Test answer",
          evidence_refs: [
            { file: "test.ts", start_line: 1, end_line: 5, note: "test note" },
          ],
          insufficient_evidence: false,
        });

        const result = parseKnowledgeReadAgentOutput(output);

        expect(result.answer).toBe("Test answer");
        expect(result.evidenceRefs).toHaveLength(1);
        expect(result.evidenceRefs[0]?.file).toBe("test.ts");
        expect(result.insufficientEvidence).toBe(false);
      });

      it("parses JSON from markdown code block", () => {
        const output = [
          "Here is my analysis:",
          "```json",
          JSON.stringify({
            answer: "From code block",
            evidence_refs: [],
            insufficient_evidence: true,
          }),
          "```",
        ].join("\n");

        const result = parseKnowledgeReadAgentOutput(output);

        expect(result.answer).toBe("From code block");
        expect(result.insufficientEvidence).toBe(true);
      });

      it("repairs trailing commas in JSON", () => {
        const output = JSON.stringify({
          answer: "Test",
          evidence_refs: [
            { file: "a.ts", start_line: 1, end_line: 2, note: "note" },
          ],
          insufficient_evidence: false,
        }).replace("}", ",}");

        // 即使有尾部逗号，也应该能解析
        const result = parseKnowledgeReadAgentOutput(output);
        expect(result.answer).toBe("Test");
      });

      it("handles think tags in output", () => {
        const output = [
          "<think>",
          "Let me analyze this...",
          "</think>",
          JSON.stringify({
            answer: "After thinking",
            evidence_refs: [],
            insufficient_evidence: false,
          }),
        ].join("\n");

        const result = parseKnowledgeReadAgentOutput(output);
        expect(result.answer).toBe("After thinking");
      });

      it("throws error for completely invalid output", () => {
        expect(() =>
          parseKnowledgeReadAgentOutput("random text without json"),
        ).toThrow("Agent output is not valid JSON");
      });

      it("throws error for missing required fields", () => {
        expect(() =>
          parseKnowledgeReadAgentOutput(
            JSON.stringify({ answer: "only answer" }),
          ),
        ).toThrow();
      });
    });

    describe("buildForcedInsufficientOutput", () => {
      it("produces valid insufficient evidence output", () => {
        const json = buildForcedInsufficientOutput();
        const parsed = parseKnowledgeReadAgentOutput(json);

        expect(parsed.insufficientEvidence).toBe(true);
        expect(parsed.evidenceRefs).toEqual([]);
        expect(parsed.answer).toContain("budget");
      });
    });
  });

  describe("Full Graph Execution Integration", () => {
    let repoPath: string;

    beforeEach(async () => {
      repoPath = await fs.mkdtemp(
        path.join(os.tmpdir(), "agent-graph-integration-"),
      );
      await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
      await fs.writeFile(
        path.join(repoPath, "src", "sample.ts"),
        'export function hello() { return "world"; }\nexport function add(a: number, b: number) { return a + b; }\n',
      );
    });

    afterEach(async () => {
      await fs.rm(repoPath, { recursive: true, force: true });
    });

    function createFakeModel(responses: AIMessage[]) {
      let index = 0;
      return {
        async invoke() {
          const response = responses[index];
          index += 1;
          if (!response) {
            throw new Error("fake model exhausted");
          }
          return response;
        },
      };
    }

    it("executes complete flow: tool call -> validation -> output", async () => {
      const result = await runKnowledgeReadRuntime(
        {
          repoPath,
          instruction: "Find the hello function",
          model: "unused",
          baseUrl: "http://unused",
          apiKey: "unused",
        },
        {
          model: createFakeModel([
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  name: "read_file_window",
                  args: { path: "src/sample.ts", startLine: 1, endLine: 1 },
                },
              ],
            }),
            new AIMessage({
              content: JSON.stringify({
                answer: "Found hello function",
                evidence_refs: [
                  {
                    file: "src/sample.ts",
                    start_line: 1,
                    end_line: 1,
                    note: "Function definition",
                  },
                ],
                insufficient_evidence: false,
              }),
            }),
          ]) as never,
        },
      );

      expect(result.insufficientEvidence).toBe(false);
      expect(result.answer).toBe("Found hello function");
      expect(result.evidenceRefs).toHaveLength(1);
      expect(result.toolCallsUsed).toBe(1);
      expect(result.trace.toolCalls).toHaveLength(1);
      expect(result.trace.toolCalls[0]?.toolName).toBe("read_file_window");
    });

    it("handles multiple sequential tool calls", async () => {
      const result = await runKnowledgeReadRuntime(
        {
          repoPath,
          instruction: "Analyze both functions",
          model: "unused",
          baseUrl: "http://unused",
          apiKey: "unused",
        },
        {
          model: createFakeModel([
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  name: "read_file_window",
                  args: { path: "src/sample.ts", startLine: 1, endLine: 1 },
                },
              ],
            }),
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "call-2",
                  name: "read_file_window",
                  args: { path: "src/sample.ts", startLine: 2, endLine: 2 },
                },
              ],
            }),
            new AIMessage({
              content: JSON.stringify({
                answer: "Both functions analyzed",
                evidence_refs: [
                  {
                    file: "src/sample.ts",
                    start_line: 1,
                    end_line: 1,
                    note: "hello function",
                  },
                  {
                    file: "src/sample.ts",
                    start_line: 2,
                    end_line: 2,
                    note: "add function",
                  },
                ],
                insufficient_evidence: false,
              }),
            }),
          ]) as never,
        },
      );

      expect(result.toolCallsUsed).toBe(2);
      expect(result.evidenceRefs).toHaveLength(2);
    });

    it("repairs malformed JSON output", async () => {
      const result = await runKnowledgeReadRuntime(
        {
          repoPath,
          instruction: "Return result",
          model: "unused",
          baseUrl: "http://unused",
          apiKey: "unused",
        },
        {
          model: createFakeModel([
            new AIMessage("This is not JSON at all"),
            new AIMessage(
              JSON.stringify({
                answer: "Repaired output",
                evidence_refs: [],
                insufficient_evidence: true,
              }),
            ),
          ]) as never,
        },
      );

      expect(result.answer).toBe("Repaired output");
      expect(result.insufficientEvidence).toBe(true);
    });

    it("enforces budget and returns forced insufficient output", async () => {
      const result = await runKnowledgeReadRuntime(
        {
          repoPath,
          instruction: "Exhaust budget",
          model: "unused",
          baseUrl: "http://unused",
          apiKey: "unused",
          limits: { maxToolCalls: 1 },
        },
        {
          model: createFakeModel([
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  name: "read_file_window",
                  args: { path: "src/sample.ts", startLine: 1, endLine: 1 },
                },
              ],
            }),
          ]) as never,
        },
      );

      // 预算耗尽后应返回 forced insufficient output
      expect(result.insufficientEvidence).toBe(true);
      expect(result.evidenceRefs).toEqual([]);
      expect(result.toolCallsUsed).toBe(1);
    });

    it("tracks timing in trace", async () => {
      const result = await runKnowledgeReadRuntime(
        {
          repoPath,
          instruction: "Simple query",
          model: "unused",
          baseUrl: "http://unused",
          apiKey: "unused",
        },
        {
          model: createFakeModel([
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  name: "search_repo_text",
                  args: { query: "hello" },
                },
              ],
            }),
            new AIMessage({
              content: JSON.stringify({
                answer: "Search completed",
                evidence_refs: [],
                insufficient_evidence: false,
              }),
            }),
          ]) as never,
        },
      );

      expect(result.trace.startedAt).toBeDefined();
      expect(result.trace.finishedAt).toBeDefined();
      expect(result.trace.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.trace.toolCalls).toHaveLength(1);
      expect(result.trace.toolCalls[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Error Handling Integration", () => {
    let repoPath: string;
    let handlers: LocalReadToolHandlers;
    let budget: BudgetState;
    let trace: ReturnType<typeof createTraceCollector>;

    beforeEach(async () => {
      repoPath = await fs.mkdtemp(
        path.join(os.tmpdir(), "agent-error-handling-"),
      );
      budget = createBudgetState(resolveKnowledgeReadLimits());
      trace = createTraceCollector();
      handlers = createLocalReadToolHandlers({
        repoPath,
        budget,
        trace,
      });
    });

    afterEach(async () => {
      await fs.rm(repoPath, { recursive: true, force: true });
    });

    it("handles missing file gracefully", async () => {
      const result = await handlers.readFileWindow({
        path: "nonexistent.ts",
        startLine: 1,
        endLine: 5,
      });

      expect(result).toContain("tool error");
    });

    it("handles directory path instead of file", async () => {
      await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
      const result = await handlers.readFileWindow({
        path: "src",
        startLine: 1,
        endLine: 5,
      });

      expect(result).toContain("tool error");
    });

    it("handles search in empty repository", async () => {
      const result = await handlers.searchRepoText({
        query: "anything",
      });

      expect(result).toContain("no matches");
    });

    it("records error in trace", async () => {
      await handlers.readFileWindow({
        path: "missing.ts",
        startLine: 1,
        endLine: 5,
      });

      const finalized = trace.finalize();
      expect(finalized.toolCalls).toHaveLength(1);
      expect(finalized.toolCalls[0]?.error).toBeDefined();
    });
  });
});
