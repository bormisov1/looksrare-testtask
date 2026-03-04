export function makeEvmProvider(overrides: Record<string, unknown> = {}) {
  return {
    getBalance: jest.fn().mockResolvedValue(1500000000000000000n),
    explorerGet: jest.fn().mockResolvedValue({ status: '0', result: [] }),
    provider: { getBalance: jest.fn().mockResolvedValue(1500000000000000000n) },
    config: {
      symbol: 'ETH',
      decimals: 18,
      explorerApiUrl: 'https://api.etherscan.io/v2/api',
      chainId: 1,
    },
    explorerApiKey: 'test-key',
    ...overrides,
  };
}

export function makeSolProvider(overrides: Record<string, unknown> = {}) {
  return {
    getBalance: jest.fn().mockResolvedValue(1500000000),
    getSignaturesForAddress: jest.fn().mockResolvedValue([]),
    getParsedTransactions: jest.fn().mockResolvedValue([]),
    symbol: 'SOL',
    decimals: 9,
    ...overrides,
  };
}

export function makeTonProvider(overrides: Record<string, unknown> = {}) {
  return {
    getBalance: jest.fn().mockResolvedValue(1500000000n),
    getTransactions: jest.fn().mockResolvedValue([]),
    parseAddress: jest.fn().mockReturnValue('parsed-ton-addr'),
    symbol: 'TON',
    decimals: 9,
    ...overrides,
  };
}

export function makeMoralisProvider(overrides: Record<string, unknown> = {}) {
  return {
    isAvailable: jest.fn().mockReturnValue(false),
    evmChainId: '0x1',
    sdk: {},
    ...overrides,
  };
}

export function makeMetaplexProvider(overrides: Record<string, unknown> = {}) {
  return {
    isAvailable: jest.fn().mockReturnValue(false),
    sdk: {},
    ...overrides,
  };
}
