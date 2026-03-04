import { IsWalletAddressConstraint } from './is-wallet-address.validator';

const VALID_EVM = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const VALID_SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const VALID_TON = 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2';

function makeValidator(network: string) {
  const configService = {
    get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'NETWORK') return network;
      return defaultValue;
    }),
  };
  return new IsWalletAddressConstraint(configService as any);
}

describe('IsWalletAddressConstraint', () => {
  describe('ethereum network', () => {
    const validator = makeValidator('ethereum');

    it('accepts valid EVM address', () => {
      expect(validator.validate(VALID_EVM)).toBe(true);
    });

    it('rejects Solana address', () => {
      expect(validator.validate(VALID_SOL)).toBe(false);
    });

    it('rejects TON address', () => {
      expect(validator.validate(VALID_TON)).toBe(false);
    });
  });

  describe('solana network', () => {
    const validator = makeValidator('solana');

    it('accepts valid Solana address', () => {
      expect(validator.validate(VALID_SOL)).toBe(true);
    });

    it('rejects EVM address', () => {
      expect(validator.validate(VALID_EVM)).toBe(false);
    });
  });

  describe('ton network', () => {
    const validator = makeValidator('ton');

    it('accepts valid TON address', () => {
      expect(validator.validate(VALID_TON)).toBe(true);
    });

    it('rejects EVM address', () => {
      expect(validator.validate(VALID_EVM)).toBe(false);
    });
  });

  describe('bnb network (EVM variant)', () => {
    const validator = makeValidator('bnb');

    it('accepts valid EVM address', () => {
      expect(validator.validate(VALID_EVM)).toBe(true);
    });

    it('rejects Solana address', () => {
      expect(validator.validate(VALID_SOL)).toBe(false);
    });
  });
});
