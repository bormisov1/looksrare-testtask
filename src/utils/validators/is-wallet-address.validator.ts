import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isValidEvmAddress, isValidSolanaAddress, isValidTonAddress } from '../address.utils';

const EVM_NETWORKS = ['ethereum', 'bnb', 'polygon'];

/**
 * Custom class-validator constraint that validates addresses for the configured network.
 * When NETWORK is set, only accepts addresses matching that network type.
 */
@Injectable()
@ValidatorConstraint({ name: 'isWalletAddress', async: false })
export class IsWalletAddressConstraint implements ValidatorConstraintInterface {
  constructor(private readonly configService: ConfigService) {}

  validate(address: string): boolean {
    const network = this.configService.get<string>('NETWORK', 'ethereum');

    if (EVM_NETWORKS.includes(network)) return isValidEvmAddress(address);
    if (network === 'solana') return isValidSolanaAddress(address);
    if (network === 'ton') return isValidTonAddress(address);

    return isValidEvmAddress(address) || isValidSolanaAddress(address) || isValidTonAddress(address);
  }

  defaultMessage(): string {
    return 'Invalid wallet address for the configured network';
  }
}

/** Decorator that validates EVM, Solana, and TON wallet addresses */
export function IsWalletAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsWalletAddressConstraint,
    });
  };
}
