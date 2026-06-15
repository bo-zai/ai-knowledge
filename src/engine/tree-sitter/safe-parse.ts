/**
 * Safe tree-sitter parse with Windows crash workaround and timeout budget.
 *
 * Ported from GitNexus, adapted for ai-wiki logger signature.
 */

import type Parser from 'tree-sitter';
import { logger } from '../../shared/logger.js';

/**
 * tree-sitter 0.21.x's Node native binding crashes (SIGSEGV) on Windows when
 * `parser.parse(string, …)` is handed a JS string longer than 32 767 chars.
 * The callback overload bypasses that conversion path.
 */
const SAFE_PARSE_CHUNK_CHARS = 16 * 1024;

/**
 * Files at or below this length skip the callback machinery.
 */
const DIRECT_PARSE_LIMIT_CHARS = 16 * 1024;

/**
 * Default per-parse wall-clock budget in milliseconds.
 */
const DEFAULT_PARSE_TIMEOUT_MS = 15_000;

/**
 * Resolve the per-parse budget from environment.
 */
function resolveParseTimeoutMs(): number {
  const raw = process.env.GITNEXUS_PARSE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_PARSE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PARSE_TIMEOUT_MS;
  return Math.floor(parsed);
}

interface TimeoutCapableParser {
  setTimeoutMicros?: (micros: number) => void;
  reset?: () => void;
}

function armParseBudget(parser: Parser, budgetMs: number): boolean {
  if (budgetMs <= 0) return false;
  const cap = parser as unknown as TimeoutCapableParser;
  if (typeof cap.setTimeoutMicros !== 'function') return false;
  cap.setTimeoutMicros(Math.floor(budgetMs * 1000));
  return true;
}

function clearParseBudget(parser: Parser): void {
  const cap = parser as unknown as TimeoutCapableParser;
  cap.setTimeoutMicros?.(0);
}

function resetParser(parser: Parser): void {
  (parser as unknown as TimeoutCapableParser).reset?.();
}

/**
 * Thrown when a parse exceeds its wall-clock budget.
 */
export class ParseTimeoutError extends Error {
  readonly budgetMs: number;
  readonly label?: string;

  constructor(budgetMs: number, label?: string) {
    super(
      `tree-sitter parse exceeded its ${budgetMs}ms budget` +
        (label ? ` while parsing ${label}` : '') +
        ' (set GITNEXUS_PARSE_TIMEOUT_MS=0 to disable)',
    );
    this.name = 'ParseTimeoutError';
    this.budgetMs = budgetMs;
    this.label = label;
  }
}

let degradedParseCount = 0;
const DEGRADED_PARSE_LOG_LIMIT = 20;

export function resetDegradedParseCounter(): void {
  degradedParseCount = 0;
}

export function parseHadErrors(tree: Parser.Tree): boolean {
  const root = tree.rootNode;
  if (root == null) return false;
  return root.hasError || root.isMissing;
}

export function getParseDiagnostics(tree: Parser.Tree): {
  hasError: boolean;
  isMissing: boolean;
} {
  const root = tree.rootNode;
  if (root == null) return { hasError: false, isMissing: false };
  return { hasError: root.hasError, isMissing: root.isMissing };
}

/**
 * Parse `sourceText` safely on every platform.
 */
export function parseSourceSafe(
  parser: Parser,
  sourceText: string,
  oldTree?: Parser.Tree,
  options?: Parser.Options,
  label?: string,
): Parser.Tree {
  const budgetMs = resolveParseTimeoutMs();
  const armed = armParseBudget(parser, budgetMs);

  let tree: Parser.Tree | null;
  try {
    if (sourceText.length <= DIRECT_PARSE_LIMIT_CHARS) {
      tree = parser.parse(sourceText, oldTree, options);
    } else {
      const input: Parser.Input = (index) => {
        if (index >= sourceText.length) return null;
        return sourceText.slice(index, index + SAFE_PARSE_CHUNK_CHARS);
      };
      tree = parser.parse(input, oldTree, options);
    }
  } finally {
    if (armed) clearParseBudget(parser);
  }

  if (tree === null) {
    if (armed) resetParser(parser);
    throw new ParseTimeoutError(budgetMs, label);
  }

  if (tree.rootNode != null && parseHadErrors(tree)) {
    degradedParseCount += 1;
    if (degradedParseCount <= DEGRADED_PARSE_LOG_LIMIT) {
      const logData = label ? { file: label, rootType: tree.rootNode.type, degradedParseCount } : { rootType: tree.rootNode.type, degradedParseCount };
      logger.debug('tree-sitter parsed with errors (degraded tree)', logData);
    }
  }

  return tree;
}