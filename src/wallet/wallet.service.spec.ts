import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WalletService } from './wallet.service';
import { RedisService } from '../redis/redis.service';
import { BlockchainStrategy, BLOCKCHAIN_STRATEGY } from './strategies/blockchain-strategy.interface';
import { WALLET_BALANCE_CHANGED } from './events/wallet-balance-changed.event';

const MOCK_EVM_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

function makeRedis() {
  return {
    get: jest.fn<Promise<string | null>, [string]>(),
    set: jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined),
    hset: jest.fn().mockResolvedValue(undefined),
    hgetall: jest.fn(),
    lrange: jest.fn(),
    lpush: jest.fn().mockResolvedValue(undefined),
    ltrim: jest.fn().mockResolvedValue(undefined),
  };
}

type MockRedis = ReturnType<typeof makeRedis>;

function makeStrategy(overrides: Partial<BlockchainStrategy> = {}): jest.Mocked<BlockchainStrategy> {
  return {
    getBalance: jest.fn().mockResolvedValue({ balance: '1.500000', symbol: 'ETH' }),
    getTransactions: jest.fn().mockResolvedValue([]),
    getTokenBalances: jest.fn().mockResolvedValue([]),
    getNfts: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as jest.Mocked<BlockchainStrategy>;
}

interface BuildOptions {
  network?: string;
  strategy?: Partial<BlockchainStrategy>;
}

async function buildModule(opts: BuildOptions = {}): Promise<{
  service: WalletService;
  redis: MockRedis;
  eventEmitter: { emit: jest.Mock };
  strategy: jest.Mocked<BlockchainStrategy>;
}> {
  const redis = makeRedis();
  const eventEmitter = { emit: jest.fn() };
  const strategy = makeStrategy(opts.strategy);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WalletService,
      { provide: RedisService, useValue: redis },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === 'NETWORK') return opts.network ?? 'ethereum';
            return defaultValue;
          }),
        },
      },
      { provide: EventEmitter2, useValue: eventEmitter },
      { provide: BLOCKCHAIN_STRATEGY, useValue: strategy },
    ],
  }).compile();

  return {
    service: module.get(WalletService),
    redis,
    eventEmitter,
    strategy,
  };
}

const lowerAddress = MOCK_EVM_ADDRESS.toLowerCase();


describe('WalletService.getBalance', () => {
  it('returns cached result with cached: true on cache hit', async () => {
    const { service, redis } = await buildModule();
    const stored = { address: MOCK_EVM_ADDRESS, balance: '1.500000', symbol: 'ETH', network: 'ethereum', cached: false };
    redis.get.mockResolvedValue(JSON.stringify(stored));

    const result = await service.getBalance(MOCK_EVM_ADDRESS);

    expect(result.cached).toBe(true);
    expect(result.balance).toBe('1.500000');
  });

  it('skips strategy on cache hit', async () => {
    const { service, redis, strategy } = await buildModule();
    redis.get.mockResolvedValue(JSON.stringify({ address: MOCK_EVM_ADDRESS, balance: '1.500000', symbol: 'ETH', network: 'ethereum', cached: false }));

    await service.getBalance(MOCK_EVM_ADDRESS);

    expect(strategy.getBalance).not.toHaveBeenCalled();
  });

  it('delegates to strategy on cache miss, wraps with metadata, stores with 30s TTL', async () => {
    const { service, redis, strategy } = await buildModule({ network: 'ethereum' });
    redis.get.mockResolvedValue(null);
    strategy.getBalance.mockResolvedValue({ balance: '1.500000', symbol: 'ETH' });

    const result = await service.getBalance(MOCK_EVM_ADDRESS);

    expect(strategy.getBalance).toHaveBeenCalledWith(MOCK_EVM_ADDRESS);
    expect(result).toEqual({ address: MOCK_EVM_ADDRESS, balance: '1.500000', symbol: 'ETH', network: 'ethereum', cached: false });
    expect(redis.set).toHaveBeenCalledWith(`balance:${lowerAddress}`, expect.any(String), 30);
  });

  it('propagates errors from strategy', async () => {
    const { service, redis, strategy } = await buildModule();
    redis.get.mockResolvedValue(null);
    strategy.getBalance.mockRejectedValue(new Error('network down'));

    await expect(service.getBalance(MOCK_EVM_ADDRESS)).rejects.toThrow('network down');
  });
});


describe('WalletService.getTransactions', () => {
  it('returns cached result with cached: true on cache hit', async () => {
    const { service, redis } = await buildModule();
    const stored = { address: MOCK_EVM_ADDRESS, transactions: [], network: 'ethereum', cached: false };
    redis.get.mockResolvedValue(JSON.stringify(stored));

    const result = await service.getTransactions(MOCK_EVM_ADDRESS, 10);

    expect(result.cached).toBe(true);
    expect(result.address).toBe(MOCK_EVM_ADDRESS);
  });

  it('skips strategy on cache hit', async () => {
    const { service, redis, strategy } = await buildModule();
    redis.get.mockResolvedValue(JSON.stringify({ address: MOCK_EVM_ADDRESS, transactions: [], network: 'ethereum', cached: false }));

    await service.getTransactions(MOCK_EVM_ADDRESS, 10);

    expect(strategy.getTransactions).not.toHaveBeenCalled();
  });

  it('delegates to strategy on cache miss, wraps into TransactionList, stores with 60s TTL', async () => {
    const tx = { hash: '0xabc', from: '0xfrom', to: '0xto', value: '1.000000', timestamp: 1700000000, status: 'success' as const };
    const { service, redis, strategy } = await buildModule({ network: 'ethereum' });
    redis.get.mockResolvedValue(null);
    strategy.getTransactions.mockResolvedValue([tx]);

    const result = await service.getTransactions(MOCK_EVM_ADDRESS, 5);

    expect(strategy.getTransactions).toHaveBeenCalledWith(MOCK_EVM_ADDRESS, 5);
    expect(result).toEqual({ address: MOCK_EVM_ADDRESS, transactions: [tx], network: 'ethereum', cached: false });
    expect(redis.set).toHaveBeenCalledWith(`txs:${lowerAddress}:5`, expect.any(String), 60);
  });
});


describe('WalletService.watchWallet', () => {
  it('stores wallet with label in Redis hash and returns success', async () => {
    const { service, redis } = await buildModule();

    const result = await service.watchWallet({ address: MOCK_EVM_ADDRESS, label: 'Vitalik' });

    expect(result).toEqual({ success: true, address: MOCK_EVM_ADDRESS });
    const stored = JSON.parse((redis.hset.mock.calls[0] as string[])[2]);
    expect(stored).toMatchObject({ address: MOCK_EVM_ADDRESS, label: 'Vitalik' });
    expect(stored.addedAt).toBeGreaterThan(0);
  });

  it('stores wallet without label and records addedAt timestamp', async () => {
    const { service, redis } = await buildModule();

    await service.watchWallet({ address: MOCK_EVM_ADDRESS });

    const stored = JSON.parse((redis.hset.mock.calls[0] as string[])[2]);
    expect(stored.label).toBeUndefined();
    expect(stored.addedAt).toBeGreaterThan(0);
  });
});


describe('WalletService.getWatchedWallets', () => {
  it('returns empty array when watchlist is empty', async () => {
    const { service, redis } = await buildModule();
    redis.hgetall.mockResolvedValue({});

    expect(await service.getWatchedWallets()).toEqual([]);
  });

  it('returns watched wallets with current balance and symbol', async () => {
    const { service, redis, strategy } = await buildModule({ network: 'ethereum' });
    const wallet = { address: MOCK_EVM_ADDRESS, label: 'Vitalik', addedAt: 1700000000000 };
    redis.hgetall.mockResolvedValue({ [MOCK_EVM_ADDRESS]: JSON.stringify(wallet) });
    redis.get.mockResolvedValue(null);
    strategy.getBalance.mockResolvedValue({ balance: '1.500000', symbol: 'ETH' });

    const result = await service.getWatchedWallets();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ address: MOCK_EVM_ADDRESS, label: 'Vitalik', balance: '1.500000', symbol: 'ETH' });
  });

  it('emits wallet.balance.changed event when balance differs from last stored value', async () => {
    const { service, redis, eventEmitter, strategy } = await buildModule({ network: 'ethereum' });
    redis.hgetall.mockResolvedValue({ [MOCK_EVM_ADDRESS]: JSON.stringify({ address: MOCK_EVM_ADDRESS, addedAt: 0 }) });
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('0.500000');
    strategy.getBalance.mockResolvedValue({ balance: '1.500000', symbol: 'ETH' });

    await service.getWatchedWallets();

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WALLET_BALANCE_CHANGED,
      expect.objectContaining({ address: MOCK_EVM_ADDRESS, previousBalance: '0.500000', currentBalance: '1.500000' }),
    );
  });

  it('does not emit event when balance is unchanged', async () => {
    const { service, redis, eventEmitter, strategy } = await buildModule();
    redis.hgetall.mockResolvedValue({ [MOCK_EVM_ADDRESS]: JSON.stringify({ address: MOCK_EVM_ADDRESS, addedAt: 0 }) });
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('1.500000');
    strategy.getBalance.mockResolvedValue({ balance: '1.500000', symbol: 'ETH' });

    await service.getWatchedWallets();

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('persists current balance as lastBalance after polling', async () => {
    const { service, redis, strategy } = await buildModule();
    redis.hgetall.mockResolvedValue({ [MOCK_EVM_ADDRESS]: JSON.stringify({ address: MOCK_EVM_ADDRESS, addedAt: 0 }) });
    redis.get.mockResolvedValue(null);
    strategy.getBalance.mockResolvedValue({ balance: '1.500000', symbol: 'ETH' });

    await service.getWatchedWallets();

    expect(redis.set).toHaveBeenCalledWith(`last_balance:${lowerAddress}`, '1.500000');
  });

  it('returns balance: null for wallets that fail, without affecting others', async () => {
    const addr2 = '0x1234567890abcdef1234567890abcdef12345678';
    const { service, redis, strategy } = await buildModule({ network: 'ethereum' });
    redis.hgetall.mockResolvedValue({
      [MOCK_EVM_ADDRESS]: JSON.stringify({ address: MOCK_EVM_ADDRESS, addedAt: 0 }),
      [addr2]: JSON.stringify({ address: addr2, addedAt: 0 }),
    });
    redis.get.mockResolvedValue(null);
    strategy.getBalance
      .mockResolvedValueOnce({ balance: '1.500000', symbol: 'ETH' })
      .mockRejectedValueOnce(new Error('network down'));

    const result = await service.getWatchedWallets();

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ address: MOCK_EVM_ADDRESS, balance: '1.500000', symbol: 'ETH' });
    expect(result[1]).toMatchObject({ address: addr2, balance: null, symbol: '' });
  });
});


describe('WalletService.getAlerts', () => {
  it('returns parsed alerts from Redis list', async () => {
    const { service, redis } = await buildModule();
    const alert = { address: MOCK_EVM_ADDRESS, network: 'ethereum', symbol: 'ETH', previousBalance: '1.000000', currentBalance: '1.500000', detectedAt: 1700001000000 };
    redis.lrange.mockResolvedValue([JSON.stringify(alert)]);

    const result = await service.getAlerts();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(alert);
  });

  it('returns empty array when no alerts exist', async () => {
    const { service, redis } = await buildModule();
    redis.lrange.mockResolvedValue([]);

    expect(await service.getAlerts()).toEqual([]);
  });
});


describe('WalletService.getTokenBalances', () => {
  it('returns parsed cache when cache hit', async () => {
    const { service, redis } = await buildModule();
    const tokens = [{ contractAddress: '0xtoken', name: 'USDC', symbol: 'USDC', decimals: 6, balance: '1.000000', network: 'ethereum' }];
    redis.get.mockResolvedValue(JSON.stringify(tokens));

    const result = await service.getTokenBalances(MOCK_EVM_ADDRESS);

    expect(result).toEqual(tokens);
  });

  it('delegates to strategy on cache miss and stores with 120s TTL', async () => {
    const tokens = [{ contractAddress: '0xusdc', name: 'USD Coin', symbol: 'USDC', decimals: 6, balance: '2.000000', network: 'ethereum' }];
    const { service, redis, strategy } = await buildModule({ network: 'ethereum' });
    redis.get.mockResolvedValue(null);
    strategy.getTokenBalances.mockResolvedValue(tokens);

    const result = await service.getTokenBalances(MOCK_EVM_ADDRESS);

    expect(strategy.getTokenBalances).toHaveBeenCalledWith(MOCK_EVM_ADDRESS);
    expect(result).toEqual(tokens);
    expect(redis.set).toHaveBeenCalledWith(`tokens:${lowerAddress}`, expect.any(String), 120);
  });

  it('caches empty array returned by strategy', async () => {
    const { service, redis, strategy } = await buildModule();
    redis.get.mockResolvedValue(null);
    strategy.getTokenBalances.mockResolvedValue([]);

    const result = await service.getTokenBalances(MOCK_EVM_ADDRESS);

    expect(result).toEqual([]);
    expect(redis.set).toHaveBeenCalledWith(`tokens:${lowerAddress}`, '[]', 120);
  });
});


describe('WalletService.getNfts', () => {
  it('returns parsed cache when cache hit', async () => {
    const { service, redis } = await buildModule();
    const nfts = [{ contractAddress: '0xnft', tokenId: '1', name: 'Punk', symbol: 'PUNK', network: 'ethereum' }];
    redis.get.mockResolvedValue(JSON.stringify(nfts));

    expect(await service.getNfts(MOCK_EVM_ADDRESS)).toEqual(nfts);
  });

  it('delegates to strategy on cache miss and stores with 300s TTL', async () => {
    const nfts = [{ contractAddress: '0xpunks', tokenId: '1234', name: 'CryptoPunks', symbol: 'PUNK', network: 'ethereum' }];
    const { service, redis, strategy } = await buildModule({ network: 'ethereum' });
    redis.get.mockResolvedValue(null);
    strategy.getNfts.mockResolvedValue(nfts);

    const result = await service.getNfts(MOCK_EVM_ADDRESS);

    expect(strategy.getNfts).toHaveBeenCalledWith(MOCK_EVM_ADDRESS);
    expect(result).toEqual(nfts);
    expect(redis.set).toHaveBeenCalledWith(`nfts:${lowerAddress}`, expect.any(String), 300);
  });

  it('caches empty array returned by strategy', async () => {
    const { service, redis, strategy } = await buildModule();
    redis.get.mockResolvedValue(null);
    strategy.getNfts.mockResolvedValue([]);

    const result = await service.getNfts(MOCK_EVM_ADDRESS);

    expect(result).toEqual([]);
    expect(redis.set).toHaveBeenCalledWith(`nfts:${lowerAddress}`, '[]', 300);
  });
});
