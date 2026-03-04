import { RpcThrottler } from './rpc-throttler';

describe('RpcThrottler', () => {
  describe('execute', () => {
    it('executes a function and returns its result', async () => {
      const throttler = new RpcThrottler(10);
      const result = await throttler.execute(() => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it('propagates errors from the executed function', async () => {
      const throttler = new RpcThrottler(10);
      await expect(
        throttler.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow('fail');
    });

    it('executes multiple calls within rate limit without delay', async () => {
      const throttler = new RpcThrottler(5);
      const start = Date.now();
      const results = await Promise.all([
        throttler.execute(() => Promise.resolve(1)),
        throttler.execute(() => Promise.resolve(2)),
        throttler.execute(() => Promise.resolve(3)),
      ]);
      const elapsed = Date.now() - start;
      expect(results).toEqual([1, 2, 3]);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('executeChunked', () => {
    it('executes all functions and returns results in order', async () => {
      const throttler = new RpcThrottler(10);
      const fns = [
        () => Promise.resolve('a'),
        () => Promise.resolve('b'),
        () => Promise.resolve('c'),
      ];
      const results = await throttler.executeChunked(fns, 2);
      expect(results).toEqual(['a', 'b', 'c']);
    });

    it('handles empty array', async () => {
      const throttler = new RpcThrottler(10);
      const results = await throttler.executeChunked([], 3);
      expect(results).toEqual([]);
    });

    it('pauses between chunks', async () => {
      const throttler = new RpcThrottler(10);
      const fns = [
        () => Promise.resolve(1),
        () => Promise.resolve(2),
        () => Promise.resolve(3),
      ];
      const start = Date.now();
      await throttler.executeChunked(fns, 1);
      const elapsed = Date.now() - start;
      // 2 pauses of 1.5s between 3 chunks of size 1
      expect(elapsed).toBeGreaterThanOrEqual(2500);
    }, 10000);
  });
});
