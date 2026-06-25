export interface ConcurrencyProgressEvent<TItem> {
  item: TItem;
  index: number;
  total: number;
  completedCount: number;
  type: "started" | "completed";
}

export interface RunWithConcurrencyOptions<TItem> {
  items: TItem[];
  concurrency: number;
  worker: (item: TItem, index: number) => Promise<void>;
  onProgress?: (event: ConcurrencyProgressEvent<TItem>) => void;
}

export async function runWithConcurrency<TItem>(
  options: RunWithConcurrencyOptions<TItem>,
): Promise<void> {
  const total = options.items.length;
  if (total === 0) {
    return;
  }

  const normalizedConcurrency = normalizeConcurrency(options.concurrency);
  let nextIndex = 0;
  let completedCount = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= total) {
        return;
      }

      const item = options.items[currentIndex];
      options.onProgress?.({
        item,
        index: currentIndex,
        total,
        completedCount,
        type: "started",
      });
      await options.worker(item, currentIndex);
      completedCount += 1;
      options.onProgress?.({
        item,
        index: currentIndex,
        total,
        completedCount,
        type: "completed",
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(normalizedConcurrency, total) }, () =>
      runWorker(),
    ),
  );
}

function normalizeConcurrency(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}
