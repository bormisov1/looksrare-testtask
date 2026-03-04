import { BadGatewayException } from '@nestjs/common';
import { SolanaStrategy } from './solana.strategy';
import { makeSolProvider as makeSol, makeMoralisProvider as makeMoralis, makeMetaplexProvider as makeMetaplex } from './test-helpers';

const MOCK_SOL_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const NETWORK = 'solana';


describe('SolanaStrategy.getBalance', () => {
  it('fetches from provider, converts lamports to SOL', async () => {
    const sol = makeSol();
    const strategy = new SolanaStrategy(NETWORK, sol as any, makeMoralis() as any, makeMetaplex() as any);

    const result = await strategy.getBalance(MOCK_SOL_ADDRESS);

    expect(sol.getBalance).toHaveBeenCalled();
    expect(result).toEqual({ balance: '1.500000', symbol: 'SOL' });
  });

  it('throws BadGatewayException on connection failure', async () => {
    const sol = makeSol({ getBalance: jest.fn().mockRejectedValue(new Error('rpc error')) });
    const strategy = new SolanaStrategy(NETWORK, sol as any, makeMoralis() as any, makeMetaplex() as any);

    await expect(strategy.getBalance(MOCK_SOL_ADDRESS)).rejects.toThrow(BadGatewayException);
  });
});


describe('SolanaStrategy.getTransactions', () => {
  it('fetches signatures and parsed transactions, extracts transfer details', async () => {
    const sol = makeSol();
    (sol.getSignaturesForAddress as jest.Mock).mockResolvedValue([
      { signature: 'sig123abc', blockTime: 1700000000, err: null },
      { signature: 'sig456def', blockTime: 1700000001, err: { msg: 'error' } },
    ]);
    (sol.getParsedTransactions as jest.Mock).mockResolvedValue([
      {
        transaction: {
          message: {
            instructions: [
              {
                parsed: { type: 'transfer', info: { destination: 'destAddr', lamports: 500000000 } },
                program: 'system',
              },
            ],
          },
        },
      },
      null,
    ]);
    const strategy = new SolanaStrategy(NETWORK, sol as any, makeMoralis() as any, makeMetaplex() as any);

    const result = await strategy.getTransactions(MOCK_SOL_ADDRESS, 2);

    expect(sol.getSignaturesForAddress).toHaveBeenCalledWith(expect.anything(), { limit: 2 });
    expect(sol.getParsedTransactions).toHaveBeenCalledWith(['sig123abc', 'sig456def']);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      hash: 'sig123abc',
      from: MOCK_SOL_ADDRESS,
      to: 'destAddr',
      value: '0.500000',
      timestamp: 1700000000,
      status: 'success',
    });
    expect(result[1]).toMatchObject({ hash: 'sig456def', to: null, value: null, status: 'failed' });
  });

  it('parses spl-token transfer instructions', async () => {
    const sol = makeSol();
    (sol.getSignaturesForAddress as jest.Mock).mockResolvedValue([
      { signature: 'sigSpl', blockTime: 1700000000, err: null },
    ]);
    (sol.getParsedTransactions as jest.Mock).mockResolvedValue([
      {
        transaction: {
          message: {
            instructions: [
              {
                parsed: {
                  type: 'transferChecked',
                  info: {
                    destination: 'tokenDestAddr',
                    tokenAmount: { amount: '6000000', decimals: 6 },
                  },
                },
                program: 'spl-token',
              },
            ],
          },
        },
      },
    ]);
    const strategy = new SolanaStrategy(NETWORK, sol as any, makeMoralis() as any, makeMetaplex() as any);

    const result = await strategy.getTransactions(MOCK_SOL_ADDRESS, 1);

    expect(result[0]).toMatchObject({
      hash: 'sigSpl',
      to: 'tokenDestAddr',
      value: '6.000000',
      status: 'success',
    });
  });

  it('returns null to/value for non-transfer transactions', async () => {
    const sol = makeSol();
    (sol.getSignaturesForAddress as jest.Mock).mockResolvedValue([
      { signature: 'sigDefi', blockTime: 1700000000, err: null },
    ]);
    (sol.getParsedTransactions as jest.Mock).mockResolvedValue([
      {
        transaction: {
          message: {
            instructions: [
              { parsed: { type: 'allocate', info: {} }, program: 'system' },
            ],
          },
        },
      },
    ]);
    const strategy = new SolanaStrategy(NETWORK, sol as any, makeMoralis() as any, makeMetaplex() as any);

    const result = await strategy.getTransactions(MOCK_SOL_ADDRESS, 1);

    expect(result[0].to).toBeNull();
    expect(result[0].value).toBeNull();
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

  it('throws BadGatewayException on Moralis SDK failure', async () => {
    const getSPL = jest.fn().mockRejectedValue(new Error('Moralis SDK error'));
    const moralis = makeMoralis({
      isAvailable: jest.fn().mockReturnValue(true),
      sdk: { SolApi: { account: { getSPL } } },
    });
    const strategy = new SolanaStrategy(NETWORK, makeSol() as any, moralis as any, makeMetaplex() as any);

    await expect(strategy.getTokenBalances(MOCK_SOL_ADDRESS)).rejects.toThrow(BadGatewayException);
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
