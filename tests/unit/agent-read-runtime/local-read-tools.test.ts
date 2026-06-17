import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBudgetState,
  DEFAULT_KNOWLEDGE_READ_LIMITS,
} from "../../../src/agent-read-runtime/context-budget.js";
import { createLocalReadToolHandlers } from "../../../src/agent-read-runtime/local-read-tools.js";
import { createTraceCollector } from "../../../src/agent-read-runtime/trace.js";

let repoPath: string;

beforeEach(async () => {
  repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-read-tools-"));
  await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "tests"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "src", "sample.ts"),
    [
      "export function saveOrder(id: string) {",
      "  return id.trim();",
      "}",
      "",
      "export function loadOrder(id: string) {",
      "  return saveOrder(id);",
      "}",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(repoPath, "tests", "sample.test.ts"),
    'import { saveOrder } from "../src/sample";\n',
  );
});

afterEach(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

describe("local read tool handlers", () => {
  it("reads a file window with line numbers", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readFileWindow({
      path: "src/sample.ts",
      startLine: 1,
      endLine: 2,
    });

    expect(result).toContain("1 | export function saveOrder");
    expect(result).toContain("2 |   return id.trim();");
  });

  it("rejects path traversal outside the repo", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readFileWindow({
      path: "../outside.ts",
      startLine: 1,
      endLine: 1,
    });

    expect(result).toContain("tool error");
    expect(result).toContain("outside repo");
  });

  it("rejects absolute path outside repo", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readFileWindow({
      path: "/etc/passwd",
      startLine: 1,
      endLine: 1,
    });

    expect(result).toContain("tool error");
  });

  it("searches repo text without returning whole files", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.searchRepoText({
      query: "saveOrder",
      limit: 10,
    });

    expect(result).toContain("src/sample.ts:1");
    expect(result).toContain("tests/sample.test.ts:1");
  });

  it("returns no matches for non-existent text", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.searchRepoText({
      query: "nonexistent",
      limit: 10,
    });

    expect(result).toContain("no matches");
  });

  it("finds related tests by symbol name", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readRelatedTests({
      symbol: "saveOrder",
      limit: 10,
    });

    expect(result).toContain("tests/sample.test.ts:1");
  });

  it("reads symbol definition by searching for function keyword", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readSymbolDefinition({
      symbol: "saveOrder",
      limit: 10,
    });

    expect(result).toContain("src/sample.ts:1");
  });

  it("reads symbol references", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readSymbolReferences({
      symbol: "saveOrder",
      limit: 10,
    });

    expect(result).toContain("src/sample.ts");
  });

  it("rejects invalid line window", async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readFileWindow({
      path: "src/sample.ts",
      startLine: 5,
      endLine: 3,
    });

    expect(result).toContain("tool error");
    expect(result).toContain("invalid line window");
  });

  it("rejects line window exceeding limit", async () => {
    const limits = { ...DEFAULT_KNOWLEDGE_READ_LIMITS, maxFileWindowLines: 2 };
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(limits),
      trace: createTraceCollector(),
    });

    const result = await handlers.readFileWindow({
      path: "src/sample.ts",
      startLine: 1,
      endLine: 10,
    });

    expect(result).toContain("tool error");
    expect(result).toContain("exceeds limit");
  });

  it("skips files larger than the search file byte limit", async () => {
    await fs.writeFile(
      path.join(repoPath, "src", "large.ts"),
      "needle".repeat(100),
    );

    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState({
        ...DEFAULT_KNOWLEDGE_READ_LIMITS,
        maxSearchFileBytes: 10,
      }),
      trace: createTraceCollector(),
    });

    const result = await handlers.searchRepoText({
      query: "needle",
      limit: 10,
    });

    expect(result).toContain("no matches");
  });

  it("skips obvious binary files during search", async () => {
    await fs.writeFile(
      path.join(repoPath, "src", "image.png"),
      Buffer.from([0, 1, 2, 3]),
    );

    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.searchRepoText({ query: "", limit: 10 });

    expect(result).toContain("no matches");
  });
});
