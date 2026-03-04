import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WalletListener } from './wallet.listener';
import { RedisModule } from '../redis/redis.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { EvmProvider } from '../blockchain/providers/evm.provider';
import { SolanaProvider } from '../blockchain/providers/solana.provider';
import { TonProvider } from '../blockchain/providers/ton.provider';
import { MoralisProvider } from '../blockchain/providers/moralis.provider';
import { MetaplexProvider } from '../blockchain/providers/metaplex.provider';
import { BlockchainStrategy, BLOCKCHAIN_STRATEGY } from './strategies/blockchain-strategy.interface';
import { EvmStrategy } from './strategies/evm.strategy';
import { SolanaStrategy } from './strategies/solana.strategy';
import { TonStrategy } from './strategies/ton.strategy';
import { IsWalletAddressConstraint } from '../utils/validators/is-wallet-address.validator';
import { ValidateAddressPipe } from './pipes/validate-address.pipe';

@Module({
  imports: [ConfigModule, RedisModule, BlockchainModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    WalletListener,
    IsWalletAddressConstraint,
    ValidateAddressPipe,
    {
      provide: BLOCKCHAIN_STRATEGY,
      useFactory: (
        config: ConfigService,
        evm: EvmProvider,
        sol: SolanaProvider,
        ton: TonProvider,
        moralis: MoralisProvider,
        metaplex: MetaplexProvider,
      ): BlockchainStrategy => {
        const network = config.get<string>('NETWORK', 'ethereum');
        if (evm.isEvmNetwork()) return new EvmStrategy(network, evm, moralis);
        if (sol.isSolanaNetwork()) return new SolanaStrategy(network, sol, moralis, metaplex);
        if (ton.isTonNetwork()) return new TonStrategy(network, ton);
        throw new Error(`Unsupported network: ${network}`);
      },
      inject: [ConfigService, EvmProvider, SolanaProvider, TonProvider, MoralisProvider, MetaplexProvider],
    },
  ],
})
export class WalletModule {}
