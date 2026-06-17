import fs from "fs/promises";
import os from "os";
import path from "path";
import { AIMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseKnowledgeReadAgentOutput,
  routeAfterBudgetCheck,
  buildForcedInsufficientOutput,
  validateFinalOutput,
  routeAfterValidation,
  runKnowledgeReadRuntime,
} from "../../../src/agent-read-runtime/graph-runtime.js";

describe("graph runtime output parsing", () => {
  it("parses valid JSON output", () => {
    const output = parseKnowledgeReadAgentOutput(
      JSON.stringify({
        answer: "The function trims the id.",
        evidence_refs: [
          {
            file: "src/sample.ts",
            start_line: 1,
            end_line: 2,
            note: "Function definition",
          },
        ],
        insufficient_evidence: false,
      }),
    );

    expect(output.answer).toBe("The function trims the id.");
    expect(output.evidenceRefs[0]?.file).toBe("src/sample.ts");
    expect(output.insufficientEvidence).toBe(false);
  });

  it("rejects non-json output", () => {
    expect(() => parseKnowledgeReadAgentOutput("plain text")).toThrow(
      "Agent output is not valid JSON",
    );
  });

  it("rejects invalid schema", () => {
    expect(() =>
      parseKnowledgeReadAgentOutput(JSON.stringify({ foo: "bar" })),
    ).toThrow();
  });
});

describe("budget check routing", () => {
  it("routes to force insufficient output when budget is exhausted and no final text", () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: true,
      finalText: undefined,
    });

    expect(next).toBe("force_insufficient_output");
  });

  it("routes to model decide when budget remains", () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: false,
      finalText: undefined,
    });

    expect(next).toBe("model_decide");
  });

  it("routes to output validation when final text exists", () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: false,
      finalText: "some text",
    });

    expect(next).toBe("output_validate");
  });

  it("routes to output validate when budget exhausted but final text exists", () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: true,
      finalText: "some text",
    });

    expect(next).toBe("output_validate");
  });
});

describe("forced insufficient output", () => {
  it("builds valid insufficient evidence output", () => {
    const parsed = parseKnowledgeReadAgentOutput(
      buildForcedInsufficientOutput(),
    );

    expect(parsed.insufficientEvidence).toBe(true);
    expect(parsed.evidenceRefs).toEqual([]);
  });
});

describe("output validation", () => {
  it("validates final output into parsed output", () => {
    const result = validateFinalOutput({
      finalText: JSON.stringify({
        answer: "ok",
        evidence_refs: [],
        insufficient_evidence: false,
      }),
      repairAttempts: 0,
    });

    expect(result.parsedOutput?.answer).toBe("ok");
    expect(result.validationError).toBeUndefined();
  });

  it("captures validation error for invalid final output", () => {
    const result = validateFinalOutput({
      finalText: "plain text",
      repairAttempts: 0,
    });

    expect(result.parsedOutput).toBeUndefined();
    expect(result.validationError).toContain("Agent output is not valid JSON");
  });
});

describe("validation routing", () => {
  it("routes validated output to end", () => {
    expect(
      routeAfterValidation({
        parsedOutput: {
          answer: "ok",
          evidence_refs: [],
          insufficient_evidence: false,
        },
        validationError: undefined,
        repairAttempts: 0,
      }),
    ).toBe("__end__");
  });

  it("routes first validation failure to repair", () => {
    expect(
      routeAfterValidation({
        parsedOutput: undefined,
        validationError: "bad json",
        repairAttempts: 0,
      }),
    ).toBe("repair_output");
  });

  it("routes second validation failure to failed", () => {
    expect(
      routeAfterValidation({
        parsedOutput: undefined,
        validationError: "bad json",
        repairAttempts: 1,
      }),
    ).toBe("failed");
  });
});

describe("graph-level integration", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "knowledge-read-graph-"),
    );
    await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, "src", "sample.ts"),
      'export function saveOrder() { return "ok"; }\n',
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

  it("runs graph from model tool call to valid final output", async () => {
    const result = await runKnowledgeReadRuntime(
      {
        repoPath,
        instruction: "Inspect saveOrder",
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
              answer: "saveOrder returns ok.",
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
    expect(result.evidenceRefs[0]?.file).toBe("src/sample.ts");
    expect(result.toolCallsUsed).toBe(1);
  });

  it("returns insufficient evidence when tool budget is exhausted", async () => {
    const result = await runKnowledgeReadRuntime(
      {
        repoPath,
        instruction: "Keep reading",
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

    expect(result.insufficientEvidence).toBe(true);
    expect(result.evidenceRefs).toEqual([]);
  });

  it("repairs invalid final JSON once", async () => {
    const result = await runKnowledgeReadRuntime(
      {
        repoPath,
        instruction: "Return final output",
        model: "unused",
        baseUrl: "http://unused",
        apiKey: "unused",
      },
      {
        model: createFakeModel([
          new AIMessage("not json"),
          new AIMessage(
            JSON.stringify({
              answer: "repaired",
              evidence_refs: [],
              insufficient_evidence: true,
            }),
          ),
        ]) as never,
      },
    );

    expect(result.answer).toBe("repaired");
    expect(result.insufficientEvidence).toBe(true);
  });

  it("does not retry the whole graph after repair validation fails", async () => {
    let calls = 0;
    const badModel = {
      async invoke() {
        calls += 1;
        return new AIMessage("still not json");
      },
    };

    await expect(
      runKnowledgeReadRuntime(
        {
          repoPath,
          instruction: "Return invalid output",
          model: "unused",
          baseUrl: "http://unused",
          apiKey: "unused",
        },
        {
          model: badModel as never,
        },
      ),
    ).rejects.toThrow("Agent output is not valid JSON");

    expect(calls).toBe(2);
  });

  it("counts and traces unknown tool calls", async () => {
    const result = await runKnowledgeReadRuntime(
      {
        repoPath,
        instruction: "Call an unknown tool first",
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
                id: "call-unknown",
                name: "read_everything",
                args: {},
              },
            ],
          }),
          new AIMessage(
            JSON.stringify({
              answer: "unknown tool was rejected",
              evidence_refs: [],
              insufficient_evidence: true,
            }),
          ),
        ]) as never,
      },
    );

    expect(result.toolCallsUsed).toBe(1);
    expect(result.trace.toolCalls[0]?.toolName).toBe("read_everything");
    expect(result.trace.toolCalls[0]?.error).toBe("unknown tool");
  });

  it("forces insufficient evidence after repeated unknown tools exhaust budget", async () => {
    const result = await runKnowledgeReadRuntime(
      {
        repoPath,
        instruction: "Keep calling unknown tools",
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
                id: "call-unknown",
                name: "read_everything",
                args: {},
              },
            ],
          }),
        ]) as never,
      },
    );

    expect(result.insufficientEvidence).toBe(true);
    expect(result.toolCallsUsed).toBe(1);
  });
});
