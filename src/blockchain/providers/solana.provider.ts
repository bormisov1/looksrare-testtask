import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  ConfirmedSignatureInfo,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { RpcThrottler } from '../../utils/rpc-throttler';

@Injectable()
export class SolanaProvider implements OnModuleInit {
  private readonly logger = new Logger(SolanaProvider.name);
  private readonly throttler = new RpcThrottler(3);

  /** @solana/web3.js Connection. Available when NETWORK=solana. */
  connection!: Connection;

  readonly symbol = 'SOL';
  readonly decimals = 9; // 1 SOL = 10^9 lamports

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const network = this.configService.get<string>('NETWORK', 'ethereum');

    if (network !== 'solana') {
      this.logger.log(`Solana Provider: skipped (selected network is "${network}")`);
      return;
    }

    const rpcUrl = this.configService.get<string>(
      'SOLANA_RPC_URL',
      'https://api.mainnet-beta.solana.com',
    );

    this.connection = new Connection(rpcUrl, 'confirmed');
    this.logger.log(`Solana Provider initialized (${rpcUrl})`);
  }

  isSolanaNetwork(): boolean {
    return this.configService.get<string>('NETWORK', 'ethereum') === 'solana';
  }

  async getBalance(pk: PublicKey): Promise<number> {
    return this.throttler.execute(() => this.connection.getBalance(pk));
  }

  async getSignaturesForAddress(
    pk: PublicKey,
    opts: { limit: number },
  ): Promise<ConfirmedSignatureInfo[]> {
    return this.throttler.execute(() =>
      this.connection.getSignaturesForAddress(pk, opts),
    );
  }

  async getParsedTransactions(
    signatures: string[],
  ): Promise<(ParsedTransactionWithMeta | null)[]> {
    const fns = signatures.map(
      (sig) => () => this.connection.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 }),
    );
    return this.throttler.executeChunked(fns, 3);
  }
}
