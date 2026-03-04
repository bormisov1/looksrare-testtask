import { isValidEvmAddress, isValidSolanaAddress, isValidTonAddress } from './address.utils';

describe('isValidEvmAddress', () => {
  it('accepts a valid checksummed EVM address', () => {
    expect(isValidEvmAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(true);
  });

  it('accepts a lowercase EVM address', () => {
    expect(isValidEvmAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(true);
  });

  it('rejects a too-short hex string', () => {
    expect(isValidEvmAddress('0x1234')).toBe(false);
  });

  it('rejects a Solana address', () => {
    expect(isValidEvmAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEvmAddress('')).toBe(false);
  });
});

describe('isValidSolanaAddress', () => {
  it('accepts a valid Solana base58 address', () => {
    expect(isValidSolanaAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(true);
  });

  it('rejects an EVM address', () => {
    expect(isValidSolanaAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidSolanaAddress('')).toBe(false);
  });

  it('rejects invalid base58', () => {
    expect(isValidSolanaAddress('0OIl')).toBe(false);
  });
});

describe('isValidTonAddress', () => {
  it('accepts a valid TON user-friendly address', () => {
    expect(isValidTonAddress('EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2')).toBe(true);
  });

  it('rejects an EVM address', () => {
    expect(isValidTonAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidTonAddress('')).toBe(false);
  });

  it('rejects random garbage', () => {
    expect(isValidTonAddress('not-a-ton-address')).toBe(false);
  });
});
