import { randomUUID } from 'node:crypto';

const ID_PREFIXES = {
  TERM: 'TERM-',
  CON: 'CON-',
  FLOW: 'FLOW-',
  MOD: 'MOD-',
  OPEN: 'OPEN-',
  OWN: 'OWN-',
  VER: 'VER-',
  DB: 'DB-',
} as const;

export type ObjectType = keyof typeof ID_PREFIXES;

// 生成稳定的对象 ID（基于输入值，不使用随机值）
export function generateObjectId(type: ObjectType, seed: string): string {
  const normalizedSeed = seed.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `${ID_PREFIXES[type]}${normalizedSeed}`;
}

// 生成唯一的临时 ID（用于需要唯一标识的场景）
export function generateUniqueId(): string {
  return randomUUID();
}