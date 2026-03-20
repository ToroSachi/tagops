export const DEFAULT_API_CONCURRENCY = 5;
const API_CONCURRENCY_ENV = "TAGOPS_CONCURRENCY";

export class Semaphore {
  private readonly queue: Array<() => void> = [];
  private current = 0;

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }

    await new Promise<void>((resolveNext) => this.queue.push(resolveNext));
    this.current++;
  }

  release(): void {
    this.current = Math.max(0, this.current - 1);
    const next = this.queue.shift();
    next?.();
  }

  async use<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }
}

function parseConcurrencyValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

export function parseConcurrencyOption(value: string): number {
  const parsed = parseConcurrencyValue(value);
  if (!parsed) {
    throw new Error("Concurrency must be a positive integer.");
  }

  return parsed;
}

export function resolveConcurrencyLimit(limit?: number): number {
  return (
    parseConcurrencyValue(limit) ??
    parseConcurrencyValue(process.env[API_CONCURRENCY_ENV]) ??
    DEFAULT_API_CONCURRENCY
  );
}

let apiConcurrencyLimit = resolveConcurrencyLimit();
let apiSemaphore = new Semaphore(apiConcurrencyLimit);

export function configureApiConcurrency(limit?: number): number {
  const nextLimit = resolveConcurrencyLimit(limit);
  if (nextLimit !== apiConcurrencyLimit) {
    apiConcurrencyLimit = nextLimit;
    apiSemaphore = new Semaphore(nextLimit);
  }

  return apiConcurrencyLimit;
}

export function getApiConcurrencyLimit(): number {
  return apiConcurrencyLimit;
}

export function getApiSemaphore(): Semaphore {
  return apiSemaphore;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number | undefined,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const semaphore = new Semaphore(resolveConcurrencyLimit(limit));
  return Promise.all(items.map((item, index) => semaphore.use(() => worker(item, index))));
}
