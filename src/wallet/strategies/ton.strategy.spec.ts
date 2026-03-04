import axios, { AxiosError } from 'axios';
import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { TonStrategy } from './ton.strategy';
import { makeTonProvider as makeTon } from './test-helpers';

jest.mock('axios', () => {
  const actual = jest.requireActual<typeof import('axios')>('axios');
  return {
    __esModule: true,
    ...actual,
    default: { ...actual.default, get: jest.fn(), isAxiosError: actual.default.isAxiosError },
  };
});

const MOCK_TON_ADDRESS = 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2';
const NETWORK = 'ton';


describe('TonStrategy.getBalance', () => {
  it('fetches from provider, converts nanoTON to TON', async () => {
    const ton = makeTon();
    const strategy = new TonStrategy(NETWORK, ton as any);

    const result = await strategy.getBalance(MOCK_TON_ADDRESS);

    expect(ton.parseAddress).toHaveBeenCalledWith(MOCK_TON_ADDRESS);
    expect(ton.getBalance).toHaveBeenCalledWith('parsed-ton-addr');
    expect(result).toEqual({ balance: '1.500000', symbol: 'TON' });
  });

  it('throws BadGatewayException on client failure', async () => {
    const ton = makeTon({ getBalance: jest.fn().mockRejectedValue(new Error('rpc error')) });
    const strategy = new TonStrategy(NETWORK, ton as any);

    await expect(strategy.getBalance(MOCK_TON_ADDRESS)).rejects.toThrow(BadGatewayException);
  });
});


describe('TonStrategy.getTransactions', () => {
  it('returns empty array when no transactions', async () => {
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    const result = await strategy.getTransactions(MOCK_TON_ADDRESS, 10);

    expect(result).toEqual([]);
  });

  it('maps TON transactions with inMessage fields', async () => {
    const mockHash = Buffer.from('abc123', 'hex');
    const rawTx = {
      hash: () => mockHash,
      now: 1700000000,
      inMessage: {
        info: {
          type: 'internal',
          src: { toString: () => '0:sender_address' },
          value: { coins: 1500000000n },
        },
      },
      description: { aborted: false },
    };
    const ton = makeTon({ getTransactions: jest.fn().mockResolvedValue([rawTx]) });
    const strategy = new TonStrategy(NETWORK, ton as any);

    const result = await strategy.getTransactions(MOCK_TON_ADDRESS, 5);

    expect(ton.getTransactions).toHaveBeenCalledWith('parsed-ton-addr', { limit: 5 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hash: mockHash.toString('hex'),
      from: '0:sender_address',
      to: MOCK_TON_ADDRESS,
      value: '1.500000',
      timestamp: 1700000000,
      status: 'success',
    });
  });

  it('returns null for from/value on external messages', async () => {
    const rawTx = {
      hash: () => Buffer.from('ff', 'hex'),
      now: 1700000001,
      inMessage: { info: { type: 'external-in' } },
      description: { aborted: false },
    };
    const ton = makeTon({ getTransactions: jest.fn().mockResolvedValue([rawTx]) });
    const strategy = new TonStrategy(NETWORK, ton as any);

    const result = await strategy.getTransactions(MOCK_TON_ADDRESS, 1);

    expect(result[0].from).toBeNull();
    expect(result[0].value).toBeNull();
  });

  it('marks transaction as failed when description.aborted is true', async () => {
    const rawTx = {
      hash: () => Buffer.from('ff', 'hex'),
      now: 1700000001,
      inMessage: null,
      description: { type: 'generic', aborted: true },
    };
    const ton = makeTon({ getTransactions: jest.fn().mockResolvedValue([rawTx]) });
    const strategy = new TonStrategy(NETWORK, ton as any);

    const result = await strategy.getTransactions(MOCK_TON_ADDRESS, 1);

    expect(result[0].status).toBe('failed');
  });
});


const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TonStrategy.getTokenBalances', () => {
  it('returns mapped token balances from TonCenter', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        jetton_wallets: [
          {
            address: '0:wallet',
            balance: '1000000000',
            jetton: { address: '0:jetton', name: 'Tether USD', symbol: 'USDT', decimals: '6' },
          },
        ],
      },
    });
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    const result = await strategy.getTokenBalances(MOCK_TON_ADDRESS);

    expect(mockedAxios.get).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ contractAddress: '0:jetton', symbol: 'USDT', network: NETWORK });
  });

  it('returns empty array when TonCenter returns no wallets', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { jetton_wallets: [] } });
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    expect(await strategy.getTokenBalances(MOCK_TON_ADDRESS)).toEqual([]);
  });

  it('throws GatewayTimeoutException on timeout', async () => {
    mockedAxios.get.mockRejectedValueOnce(new AxiosError('timeout', 'ECONNABORTED'));
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    await expect(strategy.getTokenBalances(MOCK_TON_ADDRESS)).rejects.toThrow(GatewayTimeoutException);
  });

  it('throws ServiceUnavailableException on 401', async () => {
    mockedAxios.get.mockRejectedValueOnce(new AxiosError('unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, { status: 401 } as any));
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    await expect(strategy.getTokenBalances(MOCK_TON_ADDRESS)).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('TonStrategy.getNfts', () => {
  it('returns mapped NFTs from TonCenter', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        nft_items: [
          {
            address: '0:nft-item',
            collection: { address: '0:collection', name: 'My Collection' },
            metadata: { name: 'NFT #1', symbol: '' },
          },
        ],
      },
    });
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    const result = await strategy.getNfts(MOCK_TON_ADDRESS);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ mint: '0:nft-item', name: 'NFT #1', network: NETWORK });
  });

  it('returns empty array when TonCenter returns no items', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { nft_items: [] } });
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    expect(await strategy.getNfts(MOCK_TON_ADDRESS)).toEqual([]);
  });

  it('throws GatewayTimeoutException on timeout', async () => {
    mockedAxios.get.mockRejectedValueOnce(new AxiosError('timeout', 'ETIMEDOUT'));
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    await expect(strategy.getNfts(MOCK_TON_ADDRESS)).rejects.toThrow(GatewayTimeoutException);
  });

  it('throws ServiceUnavailableException on 403', async () => {
    mockedAxios.get.mockRejectedValueOnce(new AxiosError('forbidden', 'ERR_BAD_REQUEST', undefined, undefined, { status: 403 } as any));
    const strategy = new TonStrategy(NETWORK, makeTon() as any);

    await expect(strategy.getNfts(MOCK_TON_ADDRESS)).rejects.toThrow(ServiceUnavailableException);
  });
});
