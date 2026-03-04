import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from '../redis/redis.service';
import { WatchWalletDto } from './dto/watch-wallet.dto';
import {
  WalletBalance,
  TransactionList,
  WatchedWalletWithBalance,
  BalanceAlert,
  TokenBalance,
  NftItem,
} from '../blockchain/types/blockchain.types';
import {
  WALLET_BALANCE_CHANGED,
  WalletBalanceChangedEvent,
} from './events/wallet-balance-changed.event';
import { hasBalanceChanged } from '../utils/decimal.utils';
import { BlockchainStrategy, BLOCKCHAIN_STRATEGY } from './strategies/blockchain-strategy.interface';
import { ALERTS_KEY } from './constants';

const EVM_NETWORKS = ['ethereum', 'bnb', 'polygon'];

function normalizeAddress(address: string, network: string): string {
  return EVM_NETWORKS.includes(network) ? address.toLowerCase() : address;
}

const CACHE_KEYS = {
  balance: (address: string) => `balance:${address}`,
  transactions: (address: string, limit: number) => `txs:${address}:${limit}`,
  tokens: (address: string) => `tokens:${address}`,
  nfts: (address: string) => `nfts:${address}`,
  lastBalance: (address: string) => `last_balance:${address}`,
  watchlist: 'watchlist',
};

@Injectable()
export class WalletService {
  private readonly network: string;
  private readonly cacheTtl: { balance: number; transactions: number; tokens: number; nfts: number };

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly events: EventEmitter2,
    @Inject(BLOCKCHAIN_STRATEGY) private readonly strategy: BlockchainStrategy,
  ) {
    this.network = this.configService.get<string>('NETWORK', 'ethereum');
    this.cacheTtl = {
      balance:      Number(this.configService.get<number>('CACHE_TTL_BALANCE', 30)),
      transactions: Number(this.configService.get<number>('CACHE_TTL_TRANSACTIONS', 60)),
      tokens:       Number(this.configService.get<number>('CACHE_TTL_TOKENS', 120)),
      nfts:         Number(this.configService.get<number>('CACHE_TTL_NFTS', 300)),
    };
  }

  async getBalance(address: string): Promise<WalletBalance> {
    const normalized = normalizeAddress(address, this.network);
    const key = CACHE_KEYS.balance(normalized);
    const cached = await this.redis.get(key);
    if (cached) {
      return { ...JSON.parse(cached), cached: true };
    }

    const { balance, symbol } = await this.strategy.getBalance(address);

    const result: WalletBalance = {
      address,
      balance,
      symbol,
      network: this.network,
      cached: false,
    };

    await this.redis.set(key, JSON.stringify(result), this.cacheTtl.balance);
    return result;
  }

  async getTransactions(address: string, limit = 10): Promise<TransactionList> {
    const normalized = normalizeAddress(address, this.network);
    const key = CACHE_KEYS.transactions(normalized, limit);
    const cached = await this.redis.get(key);
    if (cached) {
      return { ...JSON.parse(cached), cached: true };
    }

    const transactions = await this.strategy.getTransactions(address, limit);

    const result: TransactionList = {
      address,
      transactions,
      network: this.network,
      cached: false,
    };

    await this.redis.set(key, JSON.stringify(result), this.cacheTtl.transactions);
    return result;
  }

  async watchWallet(dto: WatchWalletDto): Promise<{ success: boolean; address: string }> {
    const normalizedAddress = normalizeAddress(dto.address, this.network);
    await this.redis.hset(
      CACHE_KEYS.watchlist,
      normalizedAddress,
      JSON.stringify({ address: normalizedAddress, label: dto.label, addedAt: Date.now() }),
    );
    return { success: true, address: normalizedAddress };
  }

  async getWatchedWallets(): Promise<WatchedWalletWithBalance[]> {
    const all = await this.redis.hgetall(CACHE_KEYS.watchlist);
    if (!all || Object.keys(all).length === 0) return [];

    const results: WatchedWalletWithBalance[] = [];
    for (const raw of Object.values(all)) {
      const wallet = JSON.parse(raw) as { address: string; label?: string; addedAt: number };
      try {
        const { balance, symbol } = await this.getBalance(wallet.address);
        const prevBalance = await this.redis.get(CACHE_KEYS.lastBalance(wallet.address));

        if (hasBalanceChanged(prevBalance ?? '0', balance)) {
          this.events.emit(WALLET_BALANCE_CHANGED, {
            address: wallet.address,
            network: this.network,
            symbol,
            previousBalance: prevBalance ?? '0',
            currentBalance: balance,
            detectedAt: Date.now(),
          } as WalletBalanceChangedEvent);
        }

        await this.redis.set(CACHE_KEYS.lastBalance(wallet.address), balance);
        results.push({ address: wallet.address, label: wallet.label, addedAt: wallet.addedAt, balance, symbol });
      } catch {
        results.push({ address: wallet.address, label: wallet.label, addedAt: wallet.addedAt, balance: null, symbol: '' });
      }
    }
    return results;
  }

  async getAlerts(): Promise<BalanceAlert[]> {
    const raw = await this.redis.lrange(ALERTS_KEY, 0, -1);
    return raw.map((item) => JSON.parse(item) as BalanceAlert);
  }

  async getTokenBalances(address: string): Promise<TokenBalance[]> {
    const normalized = normalizeAddress(address, this.network);
    const key = CACHE_KEYS.tokens(normalized);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);

    const tokens = await this.strategy.getTokenBalances(address);
    await this.redis.set(key, JSON.stringify(tokens), this.cacheTtl.tokens);
    return tokens;
  }

  async getNfts(address: string): Promise<NftItem[]> {
    const normalized = normalizeAddress(address, this.network);
    const key = CACHE_KEYS.nfts(normalized);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);

    const nfts = await this.strategy.getNfts(address);
    await this.redis.set(key, JSON.stringify(nfts), this.cacheTtl.nfts);
    return nfts;
  }
}
