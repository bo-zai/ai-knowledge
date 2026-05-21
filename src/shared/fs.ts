import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8');
}

export async function appendText(path: string, content: string): Promise<void> {
  await appendFile(path, content, 'utf8');
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

export async function removeDir(path: string): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      if (!isRetriableRemoveError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(150 * attempt);
    }
  }
}

function isRetriableRemoveError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const withCode = error as Error & { code?: string };
  return withCode.code === 'EBUSY' || withCode.code === 'EPERM' || withCode.code === 'ENOTEMPTY';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
