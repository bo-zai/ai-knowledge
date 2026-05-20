import { AppError } from '../shared/errors.js';

export interface GeneratorOutput {
  objects: unknown[];
  warnings: unknown[];
}

export function parseGeneratorOutput(text: string): GeneratorOutput {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new AppError('Generator output must be an object', 'INVALID_GENERATOR_OUTPUT');
    }
    if (!Array.isArray(parsed.objects)) {
      throw new AppError('Generator output must have an objects array', 'INVALID_GENERATOR_OUTPUT');
    }
    if (!Array.isArray(parsed.warnings)) {
      throw new AppError('Generator output must have a warnings array', 'INVALID_GENERATOR_OUTPUT');
    }
    return {
      objects: parsed.objects,
      warnings: parsed.warnings,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(`Invalid generator output: ${String(error)}`, 'INVALID_GENERATOR_OUTPUT');
  }
}