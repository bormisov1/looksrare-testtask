import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import axios from 'axios';
import { RpcThrottler } from '../../utils/rpc-throttler';

export interface EvmNetworkConfig {
  rpcUrl: string;
  explorerApiUrl: string;
  explorerApiKeyEnv: string; // name of the env variable holding the API key
  chainId: number;
  symbol: string;
  decimals: number;
}

/**
 * Configurations for supported EVM networks.
 * Public free RPCs are used by default — no key required for basic operations.
 *
 * Transaction history is available via Explorer APIs (Etherscan / BscScan / Polygonscan).
 * Free API key: https://etherscan.io/apis (same for others)
 */
const NETWORK_CONFIGS: Record<string, EvmNetworkConfig> = {
  ethereum: {
    rpcUrl: 'https://eth.llamarpc.com',
    explorerApiUrl: 'https://api.etherscan.io/v2/api',
    explorerApiKeyEnv: 'ETHERSCAN_API_KEY',
    chainId: 1,
    symbol: 'ETH',
    decimals: 18,
  },
  bnb: {
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorerApiUrl: 'https://api.etherscan.io/v2/api',
    explorerApiKeyEnv: 'ETHERSCAN_API_KEY',
    chainId: 56,
    symbol: 'BNB',
    decimals: 18,
  },
  polygon: {
    rpcUrl: 'https://polygon-rpc.com',
    explorerApiUrl: 'https://api.etherscan.io/v2/api',
    explorerApiKeyEnv: 'ETHERSCAN_API_KEY',
    chainId: 137,
    symbol: 'MATIC',
    decimals: 18,
  },
};

@Injectable()
export class EvmProvider implements OnModuleInit {
  private readonly logger = new Logger(EvmProvider.name);
  private readonly throttler = new RpcThrottler(2);

  /** ethers.js JSON-RPC provider. Available when the selected network is EVM. */
  provider!: ethers.JsonRpcProvider;

  /** Configuration for the active network */
  config!: EvmNetworkConfig;

  /** Explorer API key (optional, required for transaction history) */
  explorerApiKey!: string;

  network!: string;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.network = this.configService.get<string>('NETWORK', 'ethereum');

    if (!this.isEvmNetwork()) {
      this.logger.log(`EVM Provider: skipped (selected network is "${this.network}")`);
      return;
    }

    this.config = NETWORK_CONFIGS[this.network];
    this.explorerApiKey = this.configService.get<string>(
      this.config.explorerApiKeyEnv,
      '',
    );

    if (!this.explorerApiKey) {
      this.logger.warn(
        `${this.config.explorerApiKeyEnv} is not set — transaction history will be unavailable`,
      );
    }

    const rpcUrl =
      this.configService.get<string>(`${this.network.toUpperCase()}_RPC_URL`) ||
      this.config.rpcUrl;

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.logger.log(`EVM Provider initialized: ${this.network} (${rpcUrl})`);
  }

  isEvmNetwork(): boolean {
    return ['ethereum', 'bnb', 'polygon'].includes(
      this.configService.get<string>('NETWORK', 'ethereum'),
    );
  }

  async getBalance(address: string): Promise<bigint> {
    return this.throttler.execute(() => this.provider.getBalance(address));
  }

  async explorerGet<T>(params: Record<string, unknown>): Promise<T> {
    return this.throttler.execute(async () => {
      const { data } = await axios.get<T>(this.config.explorerApiUrl, {
        timeout: 10_000,
        params: {
          ...params,
          apikey: this.explorerApiKey,
        },
      });
      return data;
    });
  }
}
