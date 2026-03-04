import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisService } from '../redis/redis.service';
import {
  WALLET_BALANCE_CHANGED,
  WalletBalanceChangedEvent,
} from './events/wallet-balance-changed.event';
import { ALERTS_KEY } from './constants';

const MAX_ALERTS = 50;

@Injectable()
export class WalletListener {
  private readonly logger = new Logger(WalletListener.name);

  constructor(private readonly redis: RedisService) {}

  @OnEvent(WALLET_BALANCE_CHANGED)
  async handleBalanceChanged(event: WalletBalanceChangedEvent): Promise<void> {
    this.logger.log(
      `Balance changed for ${event.address}: ${event.previousBalance} → ${event.currentBalance} ${event.symbol}`,
    );
    await this.redis.lpush(ALERTS_KEY, JSON.stringify(event));
    await this.redis.ltrim(ALERTS_KEY, 0, MAX_ALERTS - 1);
  }
}
