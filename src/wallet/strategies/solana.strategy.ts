import { BadGatewayException, Logger } from '@nestjs/common';
import { PublicKey, ParsedInstruction } from '@solana/web3.js';
import { Metadata, Nft, Sft } from '@metaplex-foundation/js';
import { SolanaProvider } from '../../blockchain/providers/solana.provider';
import { MoralisProvider } from '../../blockchain/providers/moralis.provider';
import { MetaplexProvider } from '../../blockchain/providers/metaplex.provider';
import { Transaction, TokenBalance, NftItem } from '../../blockchain/types/blockchain.types';
import { formatBalance } from '../../utils/decimal.utils';
import { BlockchainStrategy } from './blockchain-strategy.interface';

interface SolMoralisSpLItem {
  mint: { address: string };
  amount: { toString(): string };
  name: string;
  symbol: string;
  decimals?: number;
}

export class SolanaStrategy implements BlockchainStrategy {
  private readonly logger = new Logger(SolanaStrategy.name);

  constructor(
    private readonly network: string,
    private readonly sol: SolanaProvider,
    private readonly moralis: MoralisProvider,
    private readonly metaplex: MetaplexProvider,
  ) {}

  async getBalance(address: string): Promise<{ balance: string; symbol: string }> {
    try {
      const pk = new PublicKey(address);
      const raw = await this.sol.getBalance(pk);
      return {
        balance: formatBalance(raw, this.sol.decimals),
        symbol: this.sol.symbol,
      };
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException(`Failed to fetch balance from ${this.network} node`);
    }
  }

  async getTransactions(address: string, limit: number): Promise<Transaction[]> {
    try {
      const pk = new PublicKey(address);
      const signatures = await this.sol.getSignaturesForAddress(pk, { limit });

      const parsed = await this.sol.getParsedTransactions(
        signatures.map((s) => s.signature),
      );

      return signatures.map((sig, i): Transaction => {
        const tx = parsed[i];
        let to: string | null = null;
        let value: string | null = null;

        if (tx) {
          const instructions = tx.transaction.message.instructions;
          for (const ix of instructions) {
            if ('parsed' in ix) {
              const pix = ix as ParsedInstruction;
              if (
                pix.program === 'system' &&
                pix.parsed?.type === 'transfer'
              ) {
                to = pix.parsed.info.destination ?? null;
                value = formatBalance(
                  pix.parsed.info.lamports ?? 0,
                  this.sol.decimals,
                );
                break;
              }
              if (
                pix.program === 'spl-token' &&
                (pix.parsed?.type === 'transfer' || pix.parsed?.type === 'transferChecked')
              ) {
                to = pix.parsed.info.destination ?? null;
                const decimals = pix.parsed.info.tokenAmount?.decimals ?? 0;
                const amount = pix.parsed.info.tokenAmount?.amount ?? pix.parsed.info.amount ?? '0';
                value = formatBalance(amount, decimals);
                break;
              }
            }
          }
        }

        return {
          hash: sig.signature,
          from: address,
          to,
          value,
          timestamp: sig.blockTime ?? 0,
          status: sig.err ? 'failed' : 'success',
        };
      });
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException(`Failed to fetch transactions from ${this.network}`);
    }
  }

  async getTokenBalances(address: string): Promise<TokenBalance[]> {
    if (!this.moralis.isAvailable()) return [];

    try {
      const res = await this.moralis.sdk.SolApi.account.getSPL({ address, network: 'mainnet' });
      return (res.result as unknown as SolMoralisSpLItem[]).map((item) => ({
        contractAddress: item.mint.address,
        name: item.name,
        symbol: item.symbol,
        decimals: item.decimals ?? 9,
        balance: formatBalance(String(item.amount), item.decimals ?? 9),
        network: this.network,
      }));
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException('Failed to fetch token balances from Moralis');
    }
  }

  async getNfts(address: string): Promise<NftItem[]> {
    if (!this.metaplex.isAvailable()) return [];

    try {
      const owner = new PublicKey(address);
      const metaplexNfts: (Metadata | Nft | Sft)[] = await this.metaplex.sdk.nfts().findAllByOwner({ owner });
      return metaplexNfts.map((nft) => ({
        mint: 'mintAddress' in nft ? nft.mintAddress.toBase58() : (nft as Nft | Sft).address.toBase58(),
        name: nft.name,
        symbol: nft.symbol,
        network: this.network,
      }));
    } catch (err) {
      this.logger.error((err as Error).message, (err as Error).stack);
      throw new BadGatewayException('Failed to fetch NFTs');
    }
  }
}
