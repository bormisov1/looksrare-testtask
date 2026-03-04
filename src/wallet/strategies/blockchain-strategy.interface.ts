import { Transaction, TokenBalance, NftItem } from '../../blockchain/types/blockchain.types';

export const BLOCKCHAIN_STRATEGY = Symbol('BLOCKCHAIN_STRATEGY');

export interface BlockchainStrategy {
  getBalance(address: string): Promise<{ balance: string; symbol: string }>;
  getTransactions(address: string, limit: number): Promise<Transaction[]>;
  getTokenBalances(address: string): Promise<TokenBalance[]>;
  getNfts(address: string): Promise<NftItem[]>;
}
