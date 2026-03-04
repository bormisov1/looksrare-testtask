/**
 * Generic RPC rate limiter using a sliding-window approach.
 * Tracks timestamps of recent calls and delays if the limit would be exceeded.
 */
export class RpcThrottler {
  private readonly timestamps: number[] = [];
  private mutex: Promise<void> = Promise.resolve();

  constructor(private readonly maxPerSecond: number) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Serialize access to timestamps via mutex
    let release!: () => void;
    const prev = this.mutex;
    this.mutex = new Promise<void>((resolve) => { release = resolve; });

    await prev;

    try {
      const now = Date.now();
      // Remove timestamps older than 1 second
      while (this.timestamps.length > 0 && this.timestamps[0] <= now - 1000) {
        this.timestamps.shift();
      }

      if (this.timestamps.length >= this.maxPerSecond) {
        const oldest = this.timestamps[0];
        const waitMs = 1000 - (now - oldest);
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        // Clean up again after waiting
        const after = Date.now();
        while (this.timestamps.length > 0 && this.timestamps[0] <= after - 1000) {
          this.timestamps.shift();
        }
      }

      this.timestamps.push(Date.now());
    } finally {
      release();
    }

    return fn();
  }

  async executeChunked<T>(
    fns: (() => Promise<T>)[],
    chunkSize: number,
  ): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < fns.length; i += chunkSize) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      const chunk = fns.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(
        chunk.map((fn) => this.execute(fn)),
      );
      results.push(...chunkResults);
    }
    return results;
  }
}
