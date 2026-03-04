import axios from 'axios';
import { BadGatewayException, GatewayTimeoutException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TransactionDescriptionGeneric } from '@ton/core';
import { TonProvider } from '../../blockchain/providers/ton.provider';
import { Transaction, TokenBalance, NftItem } from '../../blockchain/types/blockchain.types';
import { formatBalance } from '../../utils/decimal.utils';
import { BlockchainStrategy } from './blockchain-strategy.interface';

const TONCENTER_API = 'https://toncenter.com/api/v3';

export class TonStrategy implements BlockchainStrategy {
  private readonly logger = new Logger(TonStrategy.name);

  constructor(
    private readonly network: string,
    private readonly ton: TonProvider,
  ) {}

  async getBalance(address: string): Promise<{ balance: string; symbol: string }> {
    try {
      const addr = this.ton.parseAddress(address);
      const raw = await this.ton.client.getBalance(addr);
      return {
        balance: formatBalance(raw, this.ton.decimals),
        symbol: this.ton.symbol,
      };
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException(`Failed to fetch balance from ${this.network} node`);
    }
  }

  async getTransactions(address: string, limit: number): Promise<Transaction[]> {
    try {
      const addr = this.ton.parseAddress(address);
      const rawTxs = await this.ton.client.getTransactions(addr, { limit });
      return rawTxs.map((tx): Transaction => {
        const inMsg = tx.inMessage;
        const from =
          inMsg?.info.type === 'internal' && inMsg.info.src
            ? inMsg.info.src.toString()
            : null;
        const value =
          inMsg?.info.type === 'internal' && inMsg.info.value
            ? formatBalance(inMsg.info.value.coins, this.ton.decimals)
            : null;

        const desc = tx.description;
        const aborted = 'aborted' in desc ? (desc as TransactionDescriptionGeneric).aborted : false;

        return {
          hash: tx.hash().toString('hex'),
          from,
          to: address,
          value,
          timestamp: tx.now,
          status: aborted ? 'failed' : 'success',
        };
      });
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException(`Failed to fetch transactions from ${this.network}`);
    }
  }

  async getTokenBalances(address: string): Promise<TokenBalance[]> {
    try {
      const { data } = await axios.get<{
        jetton_wallets: Array<{
          address: string;
          balance: string;
          jetton: { address: string; name: string; symbol: string; decimals: string };
        }>;
      }>(`${TONCENTER_API}/jetton/wallets`, {
        timeout: 10_000,
        params: { owner_address: address, limit: 100 },
      });

      return (data.jetton_wallets ?? []).map((w) => ({
        contractAddress: w.jetton.address,
        name: w.jetton.name ?? '',
        symbol: w.jetton.symbol ?? '',
        decimals: Number(w.jetton.decimals ?? 9),
        balance: formatBalance(w.balance, Number(w.jetton.decimals ?? 9)),
        network: this.network,
      }));
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          throw new GatewayTimeoutException('TonCenter request timed out');
        }
        if (err.response?.status === 401 || err.response?.status === 403) {
          throw new ServiceUnavailableException('TonCenter API key rejected');
        }
      }
      throw new BadGatewayException('Failed to fetch token balances from TonCenter');
    }
  }

  async getNfts(address: string): Promise<NftItem[]> {
    try {
      const { data } = await axios.get<{
        nft_items: Array<{
          address: string;
          collection?: { address: string; name: string };
          metadata?: { name?: string; symbol?: string };
        }>;
      }>(`${TONCENTER_API}/nft/items`, {
        timeout: 10_000,
        params: { owner_address: address, limit: 100 },
      });

      return (data.nft_items ?? []).map((item) => ({
        contractAddress: item.collection?.address ?? '',
        mint: item.address,
        name: item.metadata?.name ?? item.collection?.name ?? '',
        symbol: item.metadata?.symbol ?? '',
        network: this.network,
      }));
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          throw new GatewayTimeoutException('TonCenter request timed out');
        }
        if (err.response?.status === 401 || err.response?.status === 403) {
          throw new ServiceUnavailableException('TonCenter API key rejected');
        }
      }
      throw new BadGatewayException('Failed to fetch NFTs from TonCenter');
    }
  }
}
