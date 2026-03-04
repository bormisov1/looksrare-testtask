import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TonClient } from '@ton/ton';
import { Address, Transaction } from '@ton/core';
import { RpcThrottler } from '../../utils/rpc-throttler';

@Injectable()
export class TonProvider implements OnModuleInit {
  private readonly logger = new Logger(TonProvider.name);
  private throttler!: RpcThrottler;

  /** TonClient instance — available when NETWORK=ton. */
  client!: TonClient;

  readonly symbol = 'TON';
  readonly decimals = 9; // 1 TON = 10^9 nanoTON

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const network = this.configService.get<string>('NETWORK', 'ethereum');

    if (network !== 'ton') {
      this.logger.log(`TON Provider: skipped (selected network is "${network}")`);
      return;
    }

    const endpoint = this.configService.get<string>(
      'TON_RPC_URL',
      'https://toncenter.com/api/v2/jsonRPC',
    );
    const apiKey = this.configService.get<string>('TON_API_KEY', '');

    this.throttler = new RpcThrottler(apiKey ? 8 : 1);
    this.client = new TonClient({ endpoint, apiKey: apiKey || undefined });
    this.logger.log(`TON Provider initialized (${endpoint})`);
  }

  /** Parse a TON address string into an Address object */
  parseAddress(address: string): Address {
    return Address.parse(address);
  }

  isTonNetwork(): boolean {
    return this.configService.get<string>('NETWORK', 'ethereum') === 'ton';
  }

  async getBalance(addr: Address): Promise<bigint> {
    return this.throttler.execute(() => this.client.getBalance(addr));
  }

  async getTransactions(
    addr: Address,
    opts: { limit: number },
  ): Promise<Transaction[]> {
    return this.throttler.execute(() =>
      this.client.getTransactions(addr, opts),
    );
  }
}
