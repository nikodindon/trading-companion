import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../config';
import { logger } from '../utils/logger';

export class WalletManager {
  private connection: Connection;
  private keypair: Keypair | null = null;

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');

    if (config.wallet.privateKey) {
      try {
        const keyArray = JSON.parse(config.wallet.privateKey) as number[];
        this.keypair = Keypair.fromSecretKey(Uint8Array.from(keyArray));
        logger.info(`Wallet loaded: ${this.keypair.publicKey.toBase58()}`);
      } catch (err) {
        logger.error('Failed to load wallet from WALLET_PRIVATE_KEY', err);
      }
    } else {
      logger.warn('No wallet configured — read-only mode');
    }
  }

  get publicKey(): PublicKey | null {
    return this.keypair?.publicKey ?? null;
  }

  get address(): string {
    return this.keypair?.publicKey.toBase58() ?? 'NOT_CONFIGURED';
  }

  async getSolBalance(): Promise<number> {
    if (!this.keypair) return 0;
    const lamports = await this.connection.getBalance(this.keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  async getTokenBalances(): Promise<Array<{ mint: string; amount: number; decimals: number }>> {
    if (!this.keypair) return [];
    const accounts = await this.connection.getParsedTokenAccountsByOwner(
      this.keypair.publicKey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );

    return accounts.value
      .map((a) => {
        const info = a.account.data.parsed?.info;
        return {
          mint: info?.mint ?? '',
          amount: Number(info?.tokenAmount?.uiAmount ?? 0),
          decimals: info?.tokenAmount?.decimals ?? 0,
        };
      })
      .filter((t) => t.amount > 0);
  }

  getConnection(): Connection {
    return this.connection;
  }

  hasWallet(): boolean {
    return this.keypair !== null;
  }

  getKeypair(): Keypair {
    if (!this.keypair) throw new Error('No wallet configured');
    return this.keypair;
  }
}
