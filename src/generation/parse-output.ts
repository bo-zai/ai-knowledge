import { AppError } from '../shared/errors.js';

export interface GeneratorOutput {
  objects: unknown[];
  warnings: unknown[];
}

// 尝试从文本中提取 JSON
function extractJson(text: string): string {
  // 1. 尝试直接解析
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  // 2. 尝试从 markdown 代码块提取
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 3. 尝试找到第一个 { 到最后一个 }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}

// 修复常见的 JSON 格式问题
function repairJson(text: string): string {
  let repaired = text;

  // 1. 移除尾部逗号
  repaired = repaired.replace(/,\s*}/g, '}');
  repaired = repaired.replace(/,\s*]/g, ']');

  // 2. 修复未闭合的引号（简化处理）
  // 这里不做复杂修复，因为可能导致更多问题

  // 3. 移除控制字符
  repaired = repaired.replace(/[\x00-\x1f]/g, '');

  return repaired;
}

export function parseGeneratorOutput(text: string): GeneratorOutput {
  // 1. 提取 JSON
  const jsonText = extractJson(text);

  // 2. 尝试解析
  try {
    const parsed = JSON.parse(jsonText);
    return validateOutput(parsed);
  } catch (parseError) {
    // 3. 尝试修复并重新解析
    const repaired = repairJson(jsonText);
    try {
      const parsed = JSON.parse(repaired);
      return validateOutput(parsed);
    } catch (repairError) {
      // 4. 失败时抛出详细错误
      throw new AppError(
        `Invalid generator output: JSON parse failed. Original: ${parseError instanceof Error ? parseError.message : String(parseError)}. Repair attempt: ${repairError instanceof Error ? repairError.message : String(repairError)}`,
        'INVALID_GENERATOR_OUTPUT',
      );
    }
  }
}

function validateOutput(parsed: unknown): GeneratorOutput {
  if (!parsed || typeof parsed !== 'object') {
    throw new AppError('Generator output must be an object', 'INVALID_GENERATOR_OUTPUT');
  }

  const obj = parsed as Record<string, unknown>;
  let objects: unknown[] | undefined;
  let warnings: unknown[] | undefined;

  // 确保有 objects 数组
  if (!Array.isArray(obj.objects)) {
    // 尝试兼容：如果输出直接是对象，将其包装成数组
    if (obj.object && typeof obj.object === 'object') {
      objects = [obj.object];
    } else if (obj.id && obj.type) {
      // 单个对象输出
      const { objects: _objects, warnings: _warnings, ...singleObject } = obj;
      objects = [singleObject];
    } else {
      throw new AppError('Generator output must have an objects array', 'INVALID_GENERATOR_OUTPUT');
    }
  } else {
    objects = obj.objects as unknown[];
  }

  // 确保有 warnings 数组
  if (!Array.isArray(obj.warnings)) {
    warnings = [];
  } else {
    warnings = obj.warnings as unknown[];
  }

  return {
    objects,
    warnings,
  };
}

// 类型化的解析器 - 用于特定对象类型
export function parseTypedOutput<T>(
  text: string,
  validator: (data: unknown) => T | null,
): { objects: T[]; warnings: unknown[] } {
  const rawOutput = parseGeneratorOutput(text);

  const validatedObjects: T[] = [];
  const validationWarnings: Array<{ message: string; object: unknown }> = [];

  for (const obj of rawOutput.objects) {
    const validated = validator(obj);
    if (validated !== null) {
      validatedObjects.push(validated);
    } else {
      validationWarnings.push({
        message: `Object validation failed for: ${JSON.stringify(obj).slice(0, 100)}`,
        object: obj,
      });
    }
  }

  return {
    objects: validatedObjects,
    warnings: [...rawOutput.warnings, ...validationWarnings],
  };
}
