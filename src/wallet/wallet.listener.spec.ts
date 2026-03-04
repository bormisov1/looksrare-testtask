import { Test, TestingModule } from '@nestjs/testing';
import { WalletListener } from './wallet.listener';
import { RedisService } from '../redis/redis.service';
import { WalletBalanceChangedEvent } from './events/wallet-balance-changed.event';

const MOCK_EVENT: WalletBalanceChangedEvent = {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  network: 'ethereum',
  symbol: 'ETH',
  previousBalance: '1.000000',
  currentBalance: '1.500000',
  detectedAt: 1700001000000,
};

describe('WalletListener', () => {
  let listener: WalletListener;
  let redis: { lpush: jest.Mock; ltrim: jest.Mock };

  beforeEach(async () => {
    redis = {
      lpush: jest.fn().mockResolvedValue(undefined),
      ltrim: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletListener,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    listener = module.get(WalletListener);
  });

  describe('handleBalanceChanged', () => {
    it('persists the serialized event to the alerts Redis list', async () => {
      await listener.handleBalanceChanged(MOCK_EVENT);

      expect(redis.lpush).toHaveBeenCalledWith('wallet:alerts', JSON.stringify(MOCK_EVENT));
    });

    it('trims the alerts list to a maximum of 50 entries', async () => {
      await listener.handleBalanceChanged(MOCK_EVENT);

      expect(redis.ltrim).toHaveBeenCalledWith('wallet:alerts', 0, 49);
    });
  });
});
