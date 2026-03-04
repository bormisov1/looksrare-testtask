import axios, { AxiosError } from 'axios';
import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { SolanaStrategy } from './solana.strategy';

jest.mock('axios', () => {
  const actual = jest.requireActual<typeof import('axios')>('axios');
  return {
    __esModule: true,
    ...actual,
    default: { ...actual.default, get: jest.fn(), isAxiosError: actual.default.isAxiosError },
  };
});

const MOCK_SOL_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const NETWORK = 'solana';

function makeSol(overrides: Record<string, unknown> = {}) {
  return {
    connection: {
      getBalance: jest.fn().mockResolvedValue(1500000000),
      getSignaturesForAddress: jest.fn().mockResolvedValue([]),
    },
    symbol: 'SOL',
    decimals: 9,
    ...overrides,
  };
}

function makeMoralis(overrides: Record<string, unknown> = {}) {
  return {
    isAvailable: jest.fn().mockReturnValue(false),
    sdk: {},
    ...overrides,
  };
}

function makeMetaplex(overrides: Record<string, unknown> = {}) {
  return {
    isAvailable: jest.fn().mockReturnValue(false),
    sdk: {},
    ...overrides,
  };
}


describe('SolanaStrategy.getBalance', () => {
  it('fetches from connection, converts lamports to SOL', async () => {
    const sol = makeSol();
    const strategy = new SolanaStrategy(NETWORK, sol as any, makeMoralis() as any, makeMetaplex() as any);

    const result = await strategy.getBalance(MOCK_SOL_ADDRESS);

    expect(sol.connection.getBalance).toHaveBeenCalled();
    expect(result).toEqual({ balance: '1.500000', symbol: 'SOL' });
  });

  it('throws BadGatewayException on connection failure', async () => {
    const sol = makeSol({ connection: { getBalance: jest.fn().mockRejectedValue(new Error('rpc error')), getSignaturesForAddress: jest.fn() } });
    const strategy = new SolanaStrategy(NETWORK, sol as any, makeMoralis() as any, makeMetaplex() as any);

    await expect(strategy.getBalance(MOCK_SOL_ADDRESS)).rejects.toThrow(BadGatewayException);
  });
});


describe('SolanaStrategy.getTransactions', () => {
  it('fetches signatures and maps them to transactions', async () => {
    const sol = makeSol();
    (sol.connection.getSignaturesForAddress as jest.Mock).mockResolvedValue([
      { signature: 'sig123abc', blockTime: 1700000000, err: null },
      { signature: 'sig456def', blockTime: 1700000001, err: { msg: 'error' } },
    ]);
    const strategy = new SolanaStrategy(NETWORK, sol as any, makeMoralis() as any, makeMetaplex() as any);

    const result = await strategy.getTransactions(MOCK_SOL_ADDRESS, 2);

    expect(sol.connection.getSignaturesForAddress).toHaveBeenCalledWith(expect.anything(), { limit: 2 });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hash: 'sig123abc', timestamp: 1700000000, status: 'success' });
    expect(result[1]).toMatchObject({ hash: 'sig456def', status: 'failed' });
  });
});


describe('SolanaStrategy.getTokenBalances', () => {
  it('returns empty array when Moralis is unavailable', async () => {
    const strategy = new SolanaStrategy(NETWORK, makeSol() as any, makeMoralis() as any, makeMetaplex() as any);

    expect(await strategy.getTokenBalances(MOCK_SOL_ADDRESS)).toEqual([]);
  });

  it('fetches SPL token balances from Moralis', async () => {
    const getSPL = jest.fn().mockResolvedValue({
      result: [
        { mint: { address: 'spl-mint' }, name: 'USD Coin', symbol: 'USDC', decimals: 6, amount: { toString: () => '3000000' } },
      ],
    });
    const moralis = makeMoralis({
      isAvailable: jest.fn().mockReturnValue(true),
      sdk: { SolApi: { account: { getSPL } } },
    });
    const strategy = new SolanaStrategy(NETWORK, makeSol() as any, moralis as any, makeMetaplex() as any);

    const result = await strategy.getTokenBalances(MOCK_SOL_ADDRESS);

    expect(getSPL).toHaveBeenCalledWith({ address: MOCK_SOL_ADDRESS, network: 'mainnet' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ contractAddress: 'spl-mint', symbol: 'USDC', balance: '3.000000', network: NETWORK });
  });

  it('throws GatewayTimeoutException on timeout', async () => {
    const getSPL = jest.fn().mockRejectedValue(new AxiosError('timeout', 'ECONNABORTED'));
    const moralis = makeMoralis({
      isAvailable: jest.fn().mockReturnValue(true),
      sdk: { SolApi: { account: { getSPL } } },
    });
    const strategy = new SolanaStrategy(NETWORK, makeSol() as any, moralis as any, makeMetaplex() as any);

    await expect(strategy.getTokenBalances(MOCK_SOL_ADDRESS)).rejects.toThrow(GatewayTimeoutException);
  });

  it('throws ServiceUnavailableException on 401/403', async () => {
    const getSPL = jest.fn().mockRejectedValue(new AxiosError('forbidden', 'ERR_BAD_REQUEST', undefined, undefined, { status: 403 } as any));
    const moralis = makeMoralis({
      isAvailable: jest.fn().mockReturnValue(true),
      sdk: { SolApi: { account: { getSPL } } },
    });
    const strategy = new SolanaStrategy(NETWORK, makeSol() as any, moralis as any, makeMetaplex() as any);

    await expect(strategy.getTokenBalances(MOCK_SOL_ADDRESS)).rejects.toThrow(ServiceUnavailableException);
  });
});


describe('SolanaStrategy.getNfts', () => {
  it('returns empty array when Metaplex is unavailable', async () => {
    const strategy = new SolanaStrategy(NETWORK, makeSol() as any, makeMoralis() as any, makeMetaplex() as any);

    expect(await strategy.getNfts(MOCK_SOL_ADDRESS)).toEqual([]);
  });

  it('fetches NFTs via Metaplex and maps mint address', async () => {
    const findAllByOwner = jest.fn().mockResolvedValue([
      { mintAddress: { toBase58: () => 'nft-mint-base58' }, name: 'My NFT', symbol: 'NFT' },
    ]);
    const metaplex = makeMetaplex({
      isAvailable: jest.fn().mockReturnValue(true),
      sdk: { nfts: () => ({ findAllByOwner }) },
    });
    const strategy = new SolanaStrategy(NETWORK, makeSol() as any, makeMoralis() as any, metaplex as any);

    const result = await strategy.getNfts(MOCK_SOL_ADDRESS);

    expect(findAllByOwner).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ mint: 'nft-mint-base58', name: 'My NFT', symbol: 'NFT', network: NETWORK });
  });
});
