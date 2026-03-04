import axios, { AxiosError } from 'axios';
import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { EvmStrategy } from './evm.strategy';

jest.mock('axios', () => {
  const actual = jest.requireActual<typeof import('axios')>('axios');
  return {
    __esModule: true,
    ...actual,
    default: { ...actual.default, get: jest.fn(), isAxiosError: actual.default.isAxiosError },
  };
});

const MOCK_EVM_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const NETWORK = 'ethereum';

function makeEvm(overrides: Record<string, unknown> = {}) {
  return {
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

function makeMoralis(overrides: Record<string, unknown> = {}) {
  return {
    isAvailable: jest.fn().mockReturnValue(false),
    evmChainId: '0x1',
    sdk: {},
    ...overrides,
  };
}

describe('EvmStrategy.getBalance', () => {
  it('fetches from provider, formats wei to ETH', async () => {
    const evm = makeEvm();
    const strategy = new EvmStrategy(NETWORK, evm as any, makeMoralis() as any);

    const result = await strategy.getBalance(MOCK_EVM_ADDRESS);

    expect(evm.provider.getBalance).toHaveBeenCalledWith(MOCK_EVM_ADDRESS);
    expect(result).toEqual({ balance: '1.500000', symbol: 'ETH' });
  });

  it('throws BadGatewayException on provider failure', async () => {
    const evm = makeEvm({ provider: { getBalance: jest.fn().mockRejectedValue(new Error('rpc error')) } });
    const strategy = new EvmStrategy(NETWORK, evm as any, makeMoralis() as any);

    await expect(strategy.getBalance(MOCK_EVM_ADDRESS)).rejects.toThrow(BadGatewayException);
  });
});

describe('EvmStrategy.getTransactions', () => {
  it('calls explorer API and maps transactions with correct fields', async () => {
    const evm = makeEvm();
    const strategy = new EvmStrategy(NETWORK, evm as any, makeMoralis() as any);
    jest.mocked(axios.get).mockResolvedValue({
      data: {
        status: '1',
        result: [
          { hash: '0xabc', from: '0xfrom', to: '0xto', value: '1000000000000000000', timeStamp: '1700000000', isError: '0' },
          { hash: '0xfail', from: '0xfrom', to: '0xto', value: '0', timeStamp: '1700000001', isError: '1' },
        ],
      },
    } as any);

    const result = await strategy.getTransactions(MOCK_EVM_ADDRESS, 5);

    expect(jest.mocked(axios.get)).toHaveBeenCalledWith(
      'https://api.etherscan.io/v2/api',
      expect.objectContaining({ params: expect.objectContaining({ address: MOCK_EVM_ADDRESS, offset: 5, chainid: 1 }) }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ hash: '0xabc', from: '0xfrom', to: '0xto', value: '1.000000', timestamp: 1700000000, status: 'success' });
    expect(result[1].status).toBe('failed');
  });

  it('returns empty array when explorer API status is not "1"', async () => {
    const strategy = new EvmStrategy(NETWORK, makeEvm() as any, makeMoralis() as any);
    jest.mocked(axios.get).mockResolvedValue({ data: { status: '0', result: [] } } as any);

    const result = await strategy.getTransactions(MOCK_EVM_ADDRESS, 10);

    expect(result).toEqual([]);
  });

  it('throws BadGatewayException on network error', async () => {
    const strategy = new EvmStrategy(NETWORK, makeEvm() as any, makeMoralis() as any);
    jest.mocked(axios.get).mockRejectedValue(new Error('timeout'));

    await expect(strategy.getTransactions(MOCK_EVM_ADDRESS, 10)).rejects.toThrow(BadGatewayException);
  });

  it('throws GatewayTimeoutException on timeout', async () => {
    const strategy = new EvmStrategy(NETWORK, makeEvm() as any, makeMoralis() as any);
    const err = new AxiosError('timeout', 'ECONNABORTED');
    jest.mocked(axios.get).mockRejectedValue(err);

    await expect(strategy.getTransactions(MOCK_EVM_ADDRESS, 10)).rejects.toThrow(GatewayTimeoutException);
  });

  it('throws ServiceUnavailableException on 401/403', async () => {
    const strategy = new EvmStrategy(NETWORK, makeEvm() as any, makeMoralis() as any);
    const err = new AxiosError('unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, { status: 401 } as any);
    jest.mocked(axios.get).mockRejectedValue(err);

    await expect(strategy.getTransactions(MOCK_EVM_ADDRESS, 10)).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('EvmStrategy.getTokenBalances', () => {
  it('returns empty array when Moralis is unavailable', async () => {
    const strategy = new EvmStrategy(NETWORK, makeEvm() as any, makeMoralis() as any);

    expect(await strategy.getTokenBalances(MOCK_EVM_ADDRESS)).toEqual([]);
  });

  it('fetches token balances from Moralis and formats amounts', async () => {
    const getWalletTokenBalances = jest.fn().mockResolvedValue({
      result: [
        { token: { contractAddress: { lowercase: '0xusdc' }, name: 'USD Coin', symbol: 'USDC', decimals: 6 }, value: '2000000' },
      ],
    });
    const moralis = makeMoralis({
      isAvailable: jest.fn().mockReturnValue(true),
      sdk: { EvmApi: { token: { getWalletTokenBalances } } },
    });
    const strategy = new EvmStrategy(NETWORK, makeEvm() as any, moralis as any);

    const result = await strategy.getTokenBalances(MOCK_EVM_ADDRESS);

    expect(getWalletTokenBalances).toHaveBeenCalledWith({ address: MOCK_EVM_ADDRESS, chain: '0x1' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ contractAddress: '0xusdc', symbol: 'USDC', decimals: 6, balance: '2.000000', network: NETWORK });
  });
});

describe('EvmStrategy.getNfts', () => {
  it('returns empty array when Moralis is unavailable', async () => {
    const strategy = new EvmStrategy(NETWORK, makeEvm() as any, makeMoralis() as any);

    expect(await strategy.getNfts(MOCK_EVM_ADDRESS)).toEqual([]);
  });

  it('fetches NFTs from Moralis and maps fields', async () => {
    const getWalletNFTs = jest.fn().mockResolvedValue({
      result: [
        { tokenAddress: { lowercase: '0xpunks' }, name: 'CryptoPunks', symbol: 'PUNK', tokenId: '1234' },
      ],
    });
    const moralis = makeMoralis({
      isAvailable: jest.fn().mockReturnValue(true),
      sdk: { EvmApi: { nft: { getWalletNFTs } } },
    });
    const strategy = new EvmStrategy(NETWORK, makeEvm() as any, moralis as any);

    const result = await strategy.getNfts(MOCK_EVM_ADDRESS);

    expect(getWalletNFTs).toHaveBeenCalledWith({ address: MOCK_EVM_ADDRESS, chain: '0x1' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ contractAddress: '0xpunks', tokenId: '1234', name: 'CryptoPunks', symbol: 'PUNK', network: NETWORK });
  });
});
