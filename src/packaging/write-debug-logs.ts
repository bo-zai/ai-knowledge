import { homedir } from "node:os";

import { appendText, ensureDir } from "../shared/fs.js";
import type { LlmGenerationResult } from "../generation/llm-client.js";

export interface SliceDebugTrace {
  sliceId: string;
  sliceKind: string;
  sliceTitle: string;
  objectType: string;
  mode: "mock" | "llm";
  status: "success" | "empty" | "validation_failed" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  request: {
    systemPrompt: string;
    userPrompt: string;
  };
  response: {
    rawText?: string;
    parsedOutput?: unknown;
    warnings?: unknown[];
    llm?: LlmGenerationResult;
  };
  validation?: {
    passed: boolean;
    error?: string;
  };
  error?: string;
}

export async function writeDebugLogs(input: {
  repoId: string;
  repoPath: string;
  runId: string;
  model: string;
  traces: SliceDebugTrace[];
}): Promise<void> {
  const basePath = `${homedir()}\\.knowledge\\${input.repoId}`;
  const logDate = input.runId.slice(0, 10);
  const logPath = `${basePath}\\${logDate}.log`;

  await ensureDir(basePath);

  const sections: string[] = [];
  sections.push("");
  sections.push(
    "================================================================",
  );
  sections.push(`[RUN] ${new Date().toISOString()}`);
  sections.push(`run_id: ${input.runId}`);
  sections.push(`repo_id: ${input.repoId}`);
  sections.push(`repo_path: ${input.repoPath}`);
  sections.push(`model: ${input.model}`);
  sections.push(`total_slices: ${input.traces.length}`);

  for (const trace of input.traces) {
    sections.push(
      "----------------------------------------------------------------",
    );
    sections.push(`[SLICE] ${trace.sliceId}`);
    sections.push(`kind: ${trace.sliceKind}`);
    sections.push(`title: ${trace.sliceTitle}`);
    sections.push(`object_type: ${trace.objectType}`);
    sections.push(`mode: ${trace.mode}`);
    sections.push(`status: ${trace.status}`);
    sections.push(`started_at: ${trace.startedAt}`);
    sections.push(`finished_at: ${trace.finishedAt}`);
    sections.push(`duration_ms: ${trace.durationMs}`);
    if (trace.validation) {
      sections.push(`validation_passed: ${trace.validation.passed}`);
      if (trace.validation.error) {
        sections.push(`validation_error: ${trace.validation.error}`);
      }
    }
    if (trace.error) {
      sections.push(`error: ${trace.error}`);
    }
    sections.push("[REQUEST.SYSTEM]");
    sections.push(trace.request.systemPrompt);
    sections.push("[REQUEST.USER]");
    sections.push(prettyValue(tryParseJson(trace.request.userPrompt)));
    sections.push("[RESPONSE.RAW]");
    sections.push(trace.response.rawText ?? "");
    sections.push("[RESPONSE.PARSED]");
    sections.push(prettyValue(trace.response.parsedOutput ?? null));
    sections.push("[RESPONSE.WARNINGS]");
    sections.push(prettyValue(trace.response.warnings ?? []));
  }
  sections.push(
    "================================================================",
  );

  await appendText(logPath, `${sections.join("\n")}\n`);
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function prettyValue(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, currentValue) => {
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }
      return currentValue;
    },
    2,
  );
}
