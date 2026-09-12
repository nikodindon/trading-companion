import axios from 'axios';
import { Connection, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { config } from '../config';
import { logger } from '../utils/logger';

const JUPITER_API = 'https://quote-api.jup.ag/v6';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown[];
}

export interface SwapResult {
  txSignature: string | null;
  dryRun: boolean;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
}

export class JupiterClient {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amountLamports: number,
    slippageBps: number = config.trading.defaultSlippageBps
  ): Promise<JupiterQuote> {
    const response = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount: amountLamports,
        slippageBps,
        onlyDirectRoutes: false,
      },
    });
    return response.data as JupiterQuote;
  }

  async getPriceUsd(mint: string): Promise<number | null> {
    try {
      // Prix en USDC via quote de 1 USDC
      const quote = await this.getQuote(USDC_MINT, mint, 1_000_000); // 1 USDC = 1e6
      const outAmount = Number(quote.outAmount);
      if (!outAmount) return null;
      return 1_000_000 / outAmount; // prix en USD par token
    } catch {
      return null;
    }
  }

  async executeSwap(
    quote: JupiterQuote,
    walletPublicKey: string,
    signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>
  ): Promise<SwapResult> {
    if (config.trading.dryRun) {
      logger.info('[DRY RUN] Swap simulé', {
        in: quote.inAmount,
        out: quote.outAmount,
        impact: quote.priceImpactPct,
      });
      return {
        txSignature: null,
        dryRun: true,
        inputAmount: Number(quote.inAmount),
        outputAmount: Number(quote.outAmount),
        priceImpact: Number(quote.priceImpactPct),
      };
    }

    const { data } = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse: quote,
      userPublicKey: walletPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    });

    const txBuf = Buffer.from(data.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    const signed = await signTransaction(tx);
    const sig = await this.connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    await this.connection.confirmTransaction(sig, 'confirmed');
    logger.info(`Swap executed: ${sig}`);

    return {
      txSignature: sig,
      dryRun: false,
      inputAmount: Number(quote.inAmount),
      outputAmount: Number(quote.outAmount),
      priceImpact: Number(quote.priceImpactPct),
    };
  }
}
