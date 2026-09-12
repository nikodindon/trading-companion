import { z } from 'zod';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const ConfigSchema = z.object({
  solana: z.object({
    rpcUrl: z.string().url(),
    network: z.enum(['mainnet-beta', 'devnet', 'testnet']).default('mainnet-beta'),
  }),
  wallet: z.object({
    privateKey: z.string().optional(),
  }),
  apis: z.object({
    coingeckoKey: z.string().optional(),
    coinmarketcapKey: z.string().optional(),
  }),
  db: z.object({
    path: z.string().default('./data/db/trader.db'),
  }),
  trading: z.object({
    dryRun: z.boolean().default(true),
    maxPositionSizeUsd: z.number().positive().default(50),
    maxDailyTrades: z.number().int().positive().default(10),
    maxDailyLossUsd: z.number().positive().default(100),
    defaultSlippageBps: z.number().int().positive().default(50),
  }),
  log: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    path: z.string().default('./data/logs'),
  }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

function loadConfig(): AppConfig {
  return ConfigSchema.parse({
    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
      network: process.env.SOLANA_NETWORK ?? 'mainnet-beta',
    },
    wallet: {
      privateKey: process.env.WALLET_PRIVATE_KEY,
    },
    apis: {
      coingeckoKey: process.env.COINGECKO_API_KEY,
      coinmarketcapKey: process.env.COINMARKETCAP_API_KEY,
    },
    db: {
      path: process.env.DB_PATH ?? './data/db/trader.db',
    },
    trading: {
      dryRun: process.env.DRY_RUN !== 'false',
      maxPositionSizeUsd: Number(process.env.MAX_POSITION_SIZE_USD ?? 50),
      maxDailyTrades: Number(process.env.MAX_DAILY_TRADES ?? 10),
      maxDailyLossUsd: Number(process.env.MAX_DAILY_LOSS_USD ?? 100),
      defaultSlippageBps: Number(process.env.DEFAULT_SLIPPAGE_BPS ?? 50),
    },
    log: {
      level: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
      path: process.env.LOG_PATH ?? './data/logs',
    },
  });
}

export const config = loadConfig();
