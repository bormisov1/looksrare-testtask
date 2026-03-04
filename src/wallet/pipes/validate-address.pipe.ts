import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isValidEvmAddress, isValidSolanaAddress, isValidTonAddress } from '../../utils/address.utils';

const EVM_NETWORKS = ['ethereum', 'bnb', 'polygon'];

@Injectable()
export class ValidateAddressPipe implements PipeTransform {
  constructor(private readonly configService: ConfigService) {}

  transform(value: string): string {
    const network = this.configService.get<string>('NETWORK', 'ethereum');

    if (EVM_NETWORKS.includes(network) && isValidEvmAddress(value)) return value;
    if (network === 'solana' && isValidSolanaAddress(value)) return value;
    if (network === 'ton' && isValidTonAddress(value)) return value;

    throw new BadRequestException('Invalid wallet address for the configured network');
  }
}
