import axios from 'axios';
import { BadGatewayException, GatewayTimeoutException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EvmProvider } from '../../blockchain/providers/evm.provider';
import { MoralisProvider } from '../../blockchain/providers/moralis.provider';
import { Transaction, TokenBalance, NftItem } from '../../blockchain/types/blockchain.types';
import { formatBalance } from '../../utils/decimal.utils';
import { BlockchainStrategy } from './blockchain-strategy.interface';

interface EvmExplorerTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError: string;
}

interface EvmExplorerResponse {
  status: string;
  result: EvmExplorerTx[] | string;
}

export class EvmStrategy implements BlockchainStrategy {
  private readonly logger = new Logger(EvmStrategy.name);

  constructor(
    private readonly network: string,
    private readonly evm: EvmProvider,
    private readonly moralis: MoralisProvider,
  ) {}

  async getBalance(address: string): Promise<{ balance: string; symbol: string }> {
    try {
      const raw = await this.evm.getBalance(address);
      return {
        balance: formatBalance(raw, this.evm.config.decimals),
        symbol: this.evm.config.symbol,
      };
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException(`Failed to fetch balance from ${this.network} node`);
    }
  }

  async getTransactions(address: string, limit: number): Promise<Transaction[]> {
    try {
      const data = await this.evm.explorerGet<EvmExplorerResponse>({
        chainid: this.evm.config.chainId,
        module: 'account',
        action: 'txlist',
        address,
        sort: 'desc',
        page: 1,
        offset: limit,
      });

      if (data.status === '1' && Array.isArray(data.result)) {
        return data.result.map((tx): Transaction => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: formatBalance(tx.value, this.evm.config.decimals),
          timestamp: Number(tx.timeStamp),
          status: tx.isError === '0' ? 'success' : 'failed',
        }));
      }
      return [];
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          throw new GatewayTimeoutException(`${this.network} explorer request timed out`);
        }
        if (err.response?.status === 401 || err.response?.status === 403) {
          throw new ServiceUnavailableException(`${this.network} explorer API key rejected`);
        }
      }
      throw new BadGatewayException(`Failed to fetch transactions from ${this.network}`);
    }
  }

  async getTokenBalances(address: string): Promise<TokenBalance[]> {
    if (!this.moralis.isAvailable()) return [];

    try {
      const res = await this.moralis.sdk.EvmApi.token.getWalletTokenBalances({
        address,
        chain: this.moralis.evmChainId,
      });
      return res.result.map((item) => ({
        contractAddress: item.token?.contractAddress?.lowercase ?? '',
        name: item.token?.name ?? '',
        symbol: item.token?.symbol ?? '',
        decimals: item.token?.decimals ?? 18,
        balance: formatBalance(String(item.value), item.token?.decimals ?? 18),
        network: this.network,
      }));
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException('Failed to fetch token balances from Moralis');
    }
  }

  async getNfts(address: string): Promise<NftItem[]> {
    if (!this.moralis.isAvailable()) return [];

    try {
      const res = await this.moralis.sdk.EvmApi.nft.getWalletNFTs({
        address,
        chain: this.moralis.evmChainId,
      });
      return res.result.map((item) => ({
        contractAddress: item.tokenAddress?.lowercase ?? '',
        tokenId: String(item.tokenId),
        name: item.name ?? '',
        symbol: item.symbol ?? '',
        network: this.network,
      }));
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException('Failed to fetch NFTs');
    }
  }
}
