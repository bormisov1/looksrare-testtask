import { formatBalance, hasBalanceChanged } from './decimal.utils';

describe('formatBalance', () => {
  it('converts wei to ETH with 6 decimal places', () => {
    expect(formatBalance(1000000000000000000n, 18)).toBe('1.000000');
  });

  it('converts lamports to SOL', () => {
    expect(formatBalance(1500000000, 9)).toBe('1.500000');
  });

  it('handles zero', () => {
    expect(formatBalance(0, 18)).toBe('0.000000');
  });

  it('handles large numbers without precision loss', () => {
    expect(formatBalance('123456789012345678901234567', 18)).toBe('123456789.012345');
  });

  it('handles string input', () => {
    expect(formatBalance('1000000', 6)).toBe('1.000000');
  });

  it('respects custom decimal places', () => {
    expect(formatBalance(1000000000000000000n, 18, 2)).toBe('1.00');
  });

  it('handles sub-unit amounts', () => {
    expect(formatBalance(1, 18)).toBe('0.000000');
  });
});

describe('hasBalanceChanged', () => {
  it('returns true when balances differ', () => {
    expect(hasBalanceChanged('1.000000', '1.500000')).toBe(true);
  });

  it('returns false when balances are equal', () => {
    expect(hasBalanceChanged('1.500000', '1.500000')).toBe(false);
  });

  it('returns false when difference is below threshold', () => {
    expect(hasBalanceChanged('1.000000', '1.005000', '0.01')).toBe(false);
  });

  it('returns true when difference exceeds threshold', () => {
    expect(hasBalanceChanged('1.000000', '1.020000', '0.01')).toBe(true);
  });

  it('handles zero previous balance', () => {
    expect(hasBalanceChanged('0', '0.000001')).toBe(true);
  });

  it('returns false for identical zero balances', () => {
    expect(hasBalanceChanged('0', '0')).toBe(false);
  });
});
