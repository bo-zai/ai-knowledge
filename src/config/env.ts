import { AppError } from '../shared/errors.js';

export function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AppError(`Missing environment variable: ${name}`, 'MISSING_ENV_VAR');
  }
  return value;
}

export function getEnvVarOptional(name: string): string | undefined {
  return process.env[name];
}