#!/usr/bin/env bash
# =============================================================================
# TRADER COMPANION — init.sh
# Génère toute l'arborescence du projet de façon autonome et rejouable.
# Usage : chmod +x init.sh && ./init.sh [dossier_cible]
# =============================================================================

set -euo pipefail

TARGET="${1:-trader-companion}"
echo "🚀 Initialisation de Trader Companion dans ./$TARGET"

# ── Arborescence ──────────────────────────────────────────────────────────────
mkdir -p "$TARGET"/{src/{config,wallet,market,dex,database,engine,risk,cli,utils},tests/{unit,integration},docs,scripts,data/{db,logs,exports}}

cd "$TARGET"

# ── .env.example ──────────────────────────────────────────────────────────────
cat > .env.example << 'ENVEOF'
# ── Réseau Solana ──────────────────────────────────────────────────────────────
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta

# ── Wallet (NE JAMAIS COMMITTER LA CLÉ PRIVÉE RÉELLE) ────────────────────────
# Format : tableau JSON de bytes (Uint8Array exporté)
# Exemple : [12,34,56,...] — généré par `solana-keygen new`
WALLET_PRIVATE_KEY=

# ── APIs de données marché ─────────────────────────────────────────────────────
COINGECKO_API_KEY=        # Pro optionnel, fonctionne sans (rate-limited)
COINMARKETCAP_API_KEY=    # Requis pour CMC

# ── Base de données ────────────────────────────────────────────────────────────
DB_PATH=./data/db/trader.db

# ── Mode exécution ────────────────────────────────────────────────────────────
# true  = simulation uniquement (DÉFAUT — aucune transaction réelle)
# false = exécution réelle (activer explicitement et consciemment)
DRY_RUN=true

# ── Risk management ────────────────────────────────────────────────────────────
MAX_POSITION_SIZE_USD=50       # Taille max par position
MAX_DAILY_TRADES=10            # Trades max par jour
MAX_DAILY_LOSS_USD=100         # Perte max tolérée par jour
DEFAULT_SLIPPAGE_BPS=50        # Slippage Jupiter (0.5%)

# ── Logs ──────────────────────────────────────────────────────────────────────
LOG_LEVEL=info                 # debug | info | warn | error
LOG_PATH=./data/logs
ENVEOF

# ── .gitignore ────────────────────────────────────────────────────────────────
cat > .gitignore << 'GITEOF'
node_modules/
dist/
.env
data/db/*.db
data/logs/*.log
data/exports/
*.key
*.pem
.DS_Store
GITEOF

# ── tsconfig.json ─────────────────────────────────────────────────────────────
cat > tsconfig.json << 'TSEOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
TSEOF

# ── package.json ──────────────────────────────────────────────────────────────
cat > package.json << 'PKGEOF'
{
  "name": "trader-companion",
  "version": "0.1.0",
  "description": "Autonomous Solana trading companion for Hermes agent",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/cli/index.ts",
    "start": "node dist/cli/index.js",
    "status": "ts-node src/cli/index.ts status",
    "analyze": "ts-node src/cli/index.ts analyze",
    "report": "ts-node src/cli/index.ts report",
    "test": "jest",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "lint": "eslint src/**/*.ts",
    "db:init": "ts-node scripts/db-init.ts",
    "db:migrate": "ts-node scripts/db-migrate.ts"
  },
  "dependencies": {
    "@solana/web3.js": "^1.95.3",
    "@jup-ag/api": "^6.0.29",
    "better-sqlite3": "^9.4.3",
    "axios": "^1.7.7",
    "dotenv": "^16.4.5",
    "zod": "^3.23.8",
    "commander": "^12.1.0",
    "chalk": "^4.1.2",
    "date-fns": "^3.6.0",
    "winston": "^3.14.2",
    "decimal.js": "^10.4.3",
    "p-limit": "^3.1.0",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.5.5",
    "@types/node-cron": "^3.0.11",
    "typescript": "^5.6.2",
    "ts-node": "^10.9.2",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.13",
    "ts-jest": "^29.2.5"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "roots": ["<rootDir>/tests"]
  }
}
PKGEOF

# ── src/config/index.ts ───────────────────────────────────────────────────────
cat > src/config/index.ts << 'EOF'
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
EOF

# ── src/utils/logger.ts ───────────────────────────────────────────────────────
cat > src/utils/logger.ts << 'EOF'
import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = process.env.LOG_PATH ?? './data/logs';
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'trader.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    }),
  ],
});
EOF

# ── src/database/schema.ts ────────────────────────────────────────────────────
cat > src/database/schema.ts << 'EOF'
export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Assets suivis (cryptos + stocks tokénisés)
CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,          -- ex: "solana", "bitcoin", "xstock-aapl"
  symbol        TEXT NOT NULL,             -- ex: "SOL", "BTC", "xAAPL"
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('crypto','tokenized_stock','stablecoin')),
  mint_address  TEXT,                      -- Adresse mint Solana (si applicable)
  coingecko_id  TEXT,
  cmc_id        INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Snapshots de prix (historique brut)
CREATE TABLE IF NOT EXISTS price_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  price_usd     REAL NOT NULL,
  volume_24h    REAL,
  market_cap    REAL,
  price_change_1h   REAL,
  price_change_24h  REAL,
  price_change_7d   REAL,
  source        TEXT NOT NULL,             -- 'coingecko' | 'cmc' | 'jupiter'
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Positions actuelles (portefeuille)
CREATE TABLE IF NOT EXISTS positions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  quantity      REAL NOT NULL,
  avg_buy_price REAL NOT NULL,
  total_invested_usd REAL NOT NULL,
  opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','partial'))
);

-- Historique de tous les trades
CREATE TABLE IF NOT EXISTS trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  position_id   INTEGER REFERENCES positions(id),
  side          TEXT NOT NULL CHECK(side IN ('buy','sell')),
  quantity      REAL NOT NULL,
  price_usd     REAL NOT NULL,
  total_usd     REAL NOT NULL,
  fees_usd      REAL DEFAULT 0,
  tx_signature  TEXT,                      -- Signature de transaction Solana
  dry_run       INTEGER NOT NULL DEFAULT 1,
  executed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  notes         TEXT
);

-- Recommandations générées par le moteur
CREATE TABLE IF NOT EXISTS recommendations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      TEXT NOT NULL REFERENCES assets(id),
  action        TEXT NOT NULL CHECK(action IN ('buy','sell','hold','watch')),
  confidence    REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  reason        TEXT NOT NULL,
  suggested_size_usd REAL,
  price_at_rec  REAL NOT NULL,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  acted_upon    INTEGER DEFAULT 0,
  trade_id      INTEGER REFERENCES trades(id)
);

-- Sessions Hermes (chaque ouverture de session)
CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at      TEXT,
  summary       TEXT,
  portfolio_value_usd REAL,
  pnl_session_usd REAL
);

-- Alertes et événements notables
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,             -- 'price_alert','trade_executed','risk_breach'
  asset_id      TEXT REFERENCES assets(id),
  message       TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warn','critical')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged  INTEGER DEFAULT 0
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_price_snapshots_asset ON price_snapshots(asset_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status, asset_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_date ON recommendations(generated_at DESC);
`;
EOF

# ── src/database/index.ts ─────────────────────────────────────────────────────
cat > src/database/index.ts << 'EOF'
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { SCHEMA_SQL } from './schema';
import { logger } from '../utils/logger';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = path.resolve(config.db.path);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.exec(SCHEMA_SQL);
  logger.info(`Database initialized at ${dbPath}`);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
EOF

# ── src/wallet/index.ts ───────────────────────────────────────────────────────
cat > src/wallet/index.ts << 'EOF'
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
EOF

# ── src/market/coingecko.ts ───────────────────────────────────────────────────
cat > src/market/coingecko.ts << 'EOF'
import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

const BASE_URL = 'https://api.coingecko.com/api/v3';
const BASE_URL_PRO = 'https://pro-api.coingecko.com/api/v3';

export interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_1h_in_currency: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency: number;
  market_cap_rank: number;
  circulating_supply: number;
  ath: number;
  ath_change_percentage: number;
}

export interface MarketSummary {
  total_market_cap: number;
  total_volume: number;
  btc_dominance: number;
  market_cap_change_24h: number;
  fear_greed_index?: number;
}

export class CoinGeckoClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    const apiKey = config.apis.coingeckoKey;
    if (apiKey) {
      this.baseUrl = BASE_URL_PRO;
      this.headers = { 'x-cg-pro-api-key': apiKey };
    } else {
      this.baseUrl = BASE_URL;
      this.headers = {};
    }
  }

  async getMarketData(coinIds: string[]): Promise<CoinGeckoMarketData[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/coins/markets`, {
        headers: this.headers,
        params: {
          vs_currency: 'usd',
          ids: coinIds.join(','),
          order: 'market_cap_desc',
          per_page: 250,
          page: 1,
          sparkline: false,
          price_change_percentage: '1h,24h,7d',
        },
      });
      return response.data as CoinGeckoMarketData[];
    } catch (err) {
      logger.error('CoinGecko getMarketData error', err);
      throw err;
    }
  }

  async getGlobalMarket(): Promise<MarketSummary> {
    try {
      const response = await axios.get(`${this.baseUrl}/global`, { headers: this.headers });
      const d = response.data.data;
      return {
        total_market_cap: d.total_market_cap?.usd ?? 0,
        total_volume: d.total_volume?.usd ?? 0,
        btc_dominance: d.market_cap_percentage?.btc ?? 0,
        market_cap_change_24h: d.market_cap_change_percentage_24h_usd ?? 0,
      };
    } catch (err) {
      logger.error('CoinGecko getGlobalMarket error', err);
      throw err;
    }
  }

  async getTrendingCoins(): Promise<Array<{ id: string; symbol: string; name: string; rank: number }>> {
    try {
      const response = await axios.get(`${this.baseUrl}/search/trending`, { headers: this.headers });
      return response.data.coins.map((c: { item: { id: string; symbol: string; name: string; market_cap_rank: number } }) => ({
        id: c.item.id,
        symbol: c.item.symbol,
        name: c.item.name,
        rank: c.item.market_cap_rank,
      }));
    } catch (err) {
      logger.error('CoinGecko getTrendingCoins error', err);
      return [];
    }
  }
}
EOF

# ── src/market/coinmarketcap.ts ───────────────────────────────────────────────
cat > src/market/coinmarketcap.ts << 'EOF'
import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

const BASE_URL = 'https://pro-api.coinmarketcap.com/v1';

export interface CMCQuote {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  cmc_rank: number;
  quote: {
    USD: {
      price: number;
      volume_24h: number;
      percent_change_1h: number;
      percent_change_24h: number;
      percent_change_7d: number;
      market_cap: number;
      last_updated: string;
    };
  };
}

export class CoinMarketCapClient {
  private apiKey: string;

  constructor() {
    this.apiKey = config.apis.coinmarketcapKey ?? '';
    if (!this.apiKey) logger.warn('CMC API key not configured');
  }

  async getLatestQuotes(slugs: string[]): Promise<CMCQuote[]> {
    if (!this.apiKey) throw new Error('CMC API key required');
    try {
      const response = await axios.get(`${BASE_URL}/cryptocurrency/quotes/latest`, {
        headers: { 'X-CMC_PRO_API_KEY': this.apiKey },
        params: { slug: slugs.join(','), convert: 'USD' },
      });
      return Object.values(response.data.data) as CMCQuote[];
    } catch (err) {
      logger.error('CMC getLatestQuotes error', err);
      throw err;
    }
  }

  async getFearGreedIndex(): Promise<number | null> {
    // CMC Pro fournit le Fear & Greed via /fear-and-greed/latest
    if (!this.apiKey) return null;
    try {
      const response = await axios.get(`${BASE_URL}/fear-and-greed/latest`, {
        headers: { 'X-CMC_PRO_API_KEY': this.apiKey },
      });
      return response.data.data?.value ?? null;
    } catch {
      return null;
    }
  }
}
EOF

# ── src/dex/jupiter.ts ────────────────────────────────────────────────────────
cat > src/dex/jupiter.ts << 'EOF'
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
EOF

# ── src/risk/index.ts ─────────────────────────────────────────────────────────
cat > src/risk/index.ts << 'EOF'
import { getDb } from '../database';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface RiskCheck {
  allowed: boolean;
  reason: string;
  warnings: string[];
}

export class RiskManager {
  check(action: 'buy' | 'sell', amountUsd: number, assetId: string): RiskCheck {
    const warnings: string[] = [];
    const db = getDb();

    // 1. Position size
    if (action === 'buy' && amountUsd > config.trading.maxPositionSizeUsd) {
      return {
        allowed: false,
        reason: `Position size $${amountUsd} exceeds max $${config.trading.maxPositionSizeUsd}`,
        warnings,
      };
    }

    // 2. Daily trade count
    const today = new Date().toISOString().slice(0, 10);
    const tradeCount = (db.prepare(
      `SELECT COUNT(*) as c FROM trades WHERE date(executed_at)=? AND dry_run=0`
    ).get(today) as { c: number }).c;

    if (tradeCount >= config.trading.maxDailyTrades) {
      return {
        allowed: false,
        reason: `Daily trade limit reached (${tradeCount}/${config.trading.maxDailyTrades})`,
        warnings,
      };
    }

    // 3. Daily loss
    const dailyPnl = (db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN side='sell' THEN total_usd ELSE -total_usd END), 0) as pnl
       FROM trades WHERE date(executed_at)=? AND dry_run=0`
    ).get(today) as { pnl: number }).pnl;

    if (dailyPnl < -config.trading.maxDailyLossUsd) {
      return {
        allowed: false,
        reason: `Daily loss limit breached ($${Math.abs(dailyPnl).toFixed(2)} / $${config.trading.maxDailyLossUsd})`,
        warnings,
      };
    }

    // 4. Price impact warning (à passer depuis Jupiter)
    if (tradeCount >= config.trading.maxDailyTrades * 0.8) {
      warnings.push(`Approaching daily trade limit (${tradeCount}/${config.trading.maxDailyTrades})`);
    }

    logger.info(`Risk check PASSED for ${action} ${assetId} $${amountUsd}`);
    return { allowed: true, reason: 'All checks passed', warnings };
  }
}
EOF

# ── src/engine/recommender.ts ─────────────────────────────────────────────────
cat > src/engine/recommender.ts << 'EOF'
import { getDb } from '../database';
import { logger } from '../utils/logger';

export type Action = 'buy' | 'sell' | 'hold' | 'watch';

export interface Recommendation {
  assetId: string;
  symbol: string;
  action: Action;
  confidence: number;
  reason: string;
  suggestedSizeUsd: number | null;
  priceAtRec: number;
}

export interface AssetSnapshot {
  assetId: string;
  symbol: string;
  priceUsd: number;
  change1h: number;
  change24h: number;
  change7d: number;
  volume24h: number;
  marketCap: number;
}

export interface PositionData {
  assetId: string;
  quantity: number;
  avgBuyPrice: number;
  totalInvestedUsd: number;
}

/**
 * Moteur de recommandation heuristique (Phase 1).
 * À enrichir avec ML/LLM en Phase 4.
 */
export class Recommender {
  analyze(snapshot: AssetSnapshot, position: PositionData | null): Recommendation {
    const reasons: string[] = [];
    let action: Action = 'watch';
    let confidence = 0.5;
    let suggestedSizeUsd: number | null = null;

    const { change1h, change24h, change7d, volume24h, marketCap } = snapshot;

    // ── Signaux de vente (prioritaires si on a une position) ──────────────────
    if (position) {
      const currentValue = position.quantity * snapshot.priceUsd;
      const pnlPct = ((currentValue - position.totalInvestedUsd) / position.totalInvestedUsd) * 100;

      if (pnlPct >= 20) {
        action = 'sell';
        confidence = 0.8;
        reasons.push(`Target +20% atteint (PnL actuel: +${pnlPct.toFixed(1)}%)`);
      } else if (pnlPct <= -10) {
        action = 'sell';
        confidence = 0.75;
        reasons.push(`Stop-loss -10% déclenché (PnL: ${pnlPct.toFixed(1)}%)`);
      } else if (change24h < -8 && pnlPct > 0) {
        action = 'sell';
        confidence = 0.65;
        reasons.push(`Baisse 24h ${change24h.toFixed(1)}% — sécuriser les gains`);
      } else if (change24h > 5 && pnlPct > 5) {
        action = 'hold';
        confidence = 0.7;
        reasons.push(`Momentum positif, position profitable — conserver`);
      } else {
        action = 'hold';
        confidence = 0.5;
        reasons.push(`Pas de signal fort — maintenir la position`);
      }
    } else {
      // ── Signaux d'achat ───────────────────────────────────────────────────
      let buyScore = 0;

      if (change24h > 3 && change7d > 5) { buyScore += 2; reasons.push(`Trend haussier 24h/7j`); }
      if (change1h > 1 && change24h > 2) { buyScore += 1; reasons.push(`Momentum positif 1h`); }
      if (volume24h > marketCap * 0.05) { buyScore += 1; reasons.push(`Volume élevé vs market cap`); }
      if (change7d < -15 && change24h > 0) { buyScore += 1; reasons.push(`Recovery après correction 7j`); }
      if (change24h < -5) { buyScore -= 2; reasons.push(`Baisse 24h significative — éviter`); }

      if (buyScore >= 3) {
        action = 'buy';
        confidence = Math.min(0.4 + buyScore * 0.1, 0.85);
        suggestedSizeUsd = 20;
        reasons.push(`Score d'achat: ${buyScore}/5`);
      } else if (buyScore >= 1) {
        action = 'watch';
        confidence = 0.55;
        reasons.push(`Surveiller — pas assez de confluences`);
      } else {
        action = 'watch';
        confidence = 0.4;
      }
    }

    const rec: Recommendation = {
      assetId: snapshot.assetId,
      symbol: snapshot.symbol,
      action,
      confidence,
      reason: reasons.join(' | '),
      suggestedSizeUsd,
      priceAtRec: snapshot.priceUsd,
    };

    // Persister la recommandation en base
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO recommendations (asset_id, action, confidence, reason, suggested_size_usd, price_at_rec)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(rec.assetId, rec.action, rec.confidence, rec.reason, rec.suggestedSizeUsd, rec.priceAtRec);
    } catch (err) {
      logger.warn('Could not persist recommendation', err);
    }

    return rec;
  }
}
EOF

# ── src/engine/portfolio.ts ───────────────────────────────────────────────────
cat > src/engine/portfolio.ts << 'EOF'
import { getDb } from '../database';

export interface PortfolioSummary {
  totalInvestedUsd: number;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  positions: PositionSummary[];
}

export interface PositionSummary {
  assetId: string;
  symbol: string;
  quantity: number;
  avgBuyPrice: number;
  currentPrice: number;
  currentValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
}

export function getPortfolioSummary(priceMap: Map<string, number>): PortfolioSummary {
  const db = getDb();
  const positions = db.prepare(`
    SELECT p.*, a.symbol FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.status='open'
  `).all() as Array<{
    asset_id: string; symbol: string; quantity: number;
    avg_buy_price: number; total_invested_usd: number;
  }>;

  let totalInvested = 0;
  let currentValue = 0;
  const summaries: PositionSummary[] = [];

  for (const pos of positions) {
    const price = priceMap.get(pos.asset_id) ?? pos.avg_buy_price;
    const val = pos.quantity * price;
    const pnlUsd = val - pos.total_invested_usd;
    const pnlPct = (pnlUsd / pos.total_invested_usd) * 100;

    totalInvested += pos.total_invested_usd;
    currentValue += val;

    summaries.push({
      assetId: pos.asset_id,
      symbol: pos.symbol,
      quantity: pos.quantity,
      avgBuyPrice: pos.avg_buy_price,
      currentPrice: price,
      currentValueUsd: val,
      pnlUsd,
      pnlPct,
    });
  }

  return {
    totalInvestedUsd: totalInvested,
    currentValueUsd: currentValue,
    unrealizedPnlUsd: currentValue - totalInvested,
    unrealizedPnlPct: totalInvested > 0 ? ((currentValue - totalInvested) / totalInvested) * 100 : 0,
    positions: summaries.sort((a, b) => b.pnlPct - a.pnlPct),
  };
}
EOF

# ── src/cli/index.ts ──────────────────────────────────────────────────────────
cat > src/cli/index.ts << 'EOF'
#!/usr/bin/env ts-node
import { Command } from 'commander';
import chalk from 'chalk';
import { getDb, closeDb } from '../database';
import { WalletManager } from '../wallet';
import { CoinGeckoClient } from '../market/coingecko';
import { Recommender } from '../engine/recommender';
import { getPortfolioSummary } from '../engine/portfolio';
import { RiskManager } from '../risk';
import { config } from '../config';
import { logger } from '../utils/logger';

const program = new Command();

program
  .name('trader')
  .description('Trader Companion — CLI for Hermes agent')
  .version('0.1.0');

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('État complet : wallet, positions, marché')
  .action(async () => {
    try {
      console.log(chalk.cyan('\n═══════════════════════════════════════'));
      console.log(chalk.cyan('  🤖 TRADER COMPANION — STATUS REPORT'));
      console.log(chalk.cyan(`  ${new Date().toLocaleString('fr-FR')}`));
      console.log(chalk.cyan('═══════════════════════════════════════\n'));

      console.log(chalk.yellow(`Mode: ${config.trading.dryRun ? '🔵 DRY RUN (simulation)' : '🔴 LIVE TRADING'}`));

      const wallet = new WalletManager();
      console.log(`\n${chalk.bold('💼 Wallet:')} ${wallet.address}`);

      if (wallet.hasWallet()) {
        const sol = await wallet.getSolBalance();
        console.log(`  SOL Balance: ${sol.toFixed(4)} SOL`);
        const tokens = await wallet.getTokenBalances();
        if (tokens.length > 0) {
          console.log(`  Token accounts: ${tokens.length}`);
        }
      }

      const db = getDb();
      const assets = db.prepare(`SELECT * FROM assets WHERE is_active=1`).all() as Array<{ id: string; symbol: string; name: string }>;

      if (assets.length === 0) {
        console.log(chalk.gray('\n⚠ Aucun asset configuré. Ajoutez des assets avec `db:init`.'));
        return;
      }

      const cg = new CoinGeckoClient();
      const cgIds = assets.filter(a => a.id && !a.id.startsWith('xstock-')).map(a => a.id);

      let marketData: Record<string, { price: number; change24h: number; change1h: number; change7d: number; volume: number; mcap: number }> = {};

      if (cgIds.length > 0) {
        const data = await cg.getMarketData(cgIds);
        for (const d of data) {
          marketData[d.id] = {
            price: d.current_price,
            change24h: d.price_change_percentage_24h ?? 0,
            change1h: d.price_change_percentage_1h_in_currency ?? 0,
            change7d: d.price_change_percentage_7d_in_currency ?? 0,
            volume: d.total_volume ?? 0,
            mcap: d.market_cap ?? 0,
          };

          // Enregistrer snapshot
          db.prepare(`
            INSERT INTO price_snapshots (asset_id, price_usd, volume_24h, market_cap, price_change_1h, price_change_24h, price_change_7d, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'coingecko')
          `).run(d.id, d.current_price, d.total_volume, d.market_cap,
            d.price_change_percentage_1h_in_currency ?? 0,
            d.price_change_percentage_24h ?? 0,
            d.price_change_percentage_7d_in_currency ?? 0);
        }
      }

      console.log(`\n${chalk.bold('📊 Marché (assets suivis):')} `);
      console.log('─'.repeat(75));
      console.log(chalk.gray('  Symbol    Prix USD      1h%        24h%       7j%      Volume 24h'));
      console.log('─'.repeat(75));

      for (const asset of assets) {
        const m = marketData[asset.id];
        if (!m) continue;
        const c = (v: number) => v >= 0 ? chalk.green(`+${v.toFixed(2)}%`) : chalk.red(`${v.toFixed(2)}%`);
        const vol = m.volume > 1e9 ? `$${(m.volume/1e9).toFixed(1)}B` : `$${(m.volume/1e6).toFixed(0)}M`;
        console.log(`  ${asset.symbol.padEnd(8)} $${m.price.toFixed(4).padEnd(12)} ${c(m.change1h).padEnd(14)} ${c(m.change24h).padEnd(14)} ${c(m.change7d).padEnd(12)} ${vol}`);
      }

      const priceMap = new Map(Object.entries(marketData).map(([id, m]) => [id, m.price]));
      const portfolio = getPortfolioSummary(priceMap);

      if (portfolio.positions.length > 0) {
        console.log(`\n${chalk.bold('💰 Portfolio:')} `);
        const pnlColor = portfolio.unrealizedPnlUsd >= 0 ? chalk.green : chalk.red;
        console.log(`  Investi: $${portfolio.totalInvestedUsd.toFixed(2)} | Valeur: $${portfolio.currentValueUsd.toFixed(2)} | PnL: ${pnlColor(`$${portfolio.unrealizedPnlUsd.toFixed(2)} (${portfolio.unrealizedPnlPct.toFixed(1)}%)`)}`);
        for (const pos of portfolio.positions) {
          const pnlC = pos.pnlUsd >= 0 ? chalk.green : chalk.red;
          console.log(`  ${pos.symbol.padEnd(8)} qty: ${pos.quantity.toFixed(4)}  entry: $${pos.avgBuyPrice.toFixed(4)}  now: $${pos.currentPrice.toFixed(4)}  PnL: ${pnlC(`${pos.pnlPct.toFixed(1)}%`)}`);
        }
      } else {
        console.log(chalk.gray('\n  Aucune position ouverte.'));
      }

      console.log(`\n${chalk.bold('🔒 Risk Limits:')} max position $${config.trading.maxPositionSizeUsd} | max trades/j ${config.trading.maxDailyTrades} | stop-loss/j $${config.trading.maxDailyLossUsd}`);
      console.log('');

    } catch (err) {
      logger.error('Status command error', err);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// ── analyze ───────────────────────────────────────────────────────────────────
program
  .command('analyze')
  .description('Analyse des assets et recommandations d\'action')
  .action(async () => {
    try {
      console.log(chalk.cyan('\n═══════════════════════════════════════'));
      console.log(chalk.cyan('  🧠 ANALYSE & RECOMMANDATIONS'));
      console.log(chalk.cyan('═══════════════════════════════════════\n'));

      const db = getDb();
      const assets = db.prepare(`SELECT * FROM assets WHERE is_active=1`).all() as Array<{ id: string; symbol: string; name: string }>;
      if (!assets.length) { console.log('Aucun asset configuré.'); return; }

      const cg = new CoinGeckoClient();
      const data = await cg.getMarketData(assets.map(a => a.id).filter(id => !id.startsWith('xstock-')));

      const recommender = new Recommender();
      const risk = new RiskManager();

      const ACTION_EMOJI: Record<string, string> = { buy: '🟢 ACHETER', sell: '🔴 VENDRE', hold: '🟡 GARDER', watch: '👁  SURVEILLER' };

      for (const d of data) {
        const pos = db.prepare(`SELECT p.*, a.symbol FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.asset_id=? AND p.status='open'`).get(d.id) as null | { asset_id: string; symbol: string; quantity: number; avg_buy_price: number; total_invested_usd: number };

        const rec = recommender.analyze({
          assetId: d.id,
          symbol: d.symbol.toUpperCase(),
          priceUsd: d.current_price,
          change1h: d.price_change_percentage_1h_in_currency ?? 0,
          change24h: d.price_change_percentage_24h ?? 0,
          change7d: d.price_change_percentage_7d_in_currency ?? 0,
          volume24h: d.total_volume ?? 0,
          marketCap: d.market_cap ?? 0,
        }, pos ? {
          assetId: pos.asset_id,
          quantity: pos.quantity,
          avgBuyPrice: pos.avg_buy_price,
          totalInvestedUsd: pos.total_invested_usd,
        } : null);

        const emoji = ACTION_EMOJI[rec.action] ?? rec.action;
        console.log(`${emoji.padEnd(18)} ${d.symbol.toUpperCase().padEnd(8)} $${d.current_price.toFixed(4).padEnd(14)} conf: ${(rec.confidence * 100).toFixed(0)}%`);
        console.log(`  ${chalk.gray(rec.reason)}`);

        if ((rec.action === 'buy' || rec.action === 'sell') && rec.suggestedSizeUsd) {
          const riskCheck = risk.check(rec.action, rec.suggestedSizeUsd, rec.assetId);
          if (!riskCheck.allowed) {
            console.log(`  ${chalk.red('⛔ BLOQUÉ PAR RISK MANAGER:')} ${riskCheck.reason}`);
          } else {
            console.log(`  ${chalk.green('✅ Risk OK')} — taille suggérée: $${rec.suggestedSizeUsd}`);
          }
        }
        console.log('');
      }
    } catch (err) {
      logger.error('Analyze command error', err);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// ── report ────────────────────────────────────────────────────────────────────
program
  .command('report')
  .description('Rapport synthétique pour Hermes (texte brut machine-readable)')
  .action(async () => {
    const db = getDb();
    const trades = db.prepare(`SELECT * FROM trades ORDER BY executed_at DESC LIMIT 20`).all();
    const recs = db.prepare(`SELECT * FROM recommendations ORDER BY generated_at DESC LIMIT 10`).all();
    const positions = db.prepare(`SELECT p.*, a.symbol FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.status='open'`).all();

    console.log(JSON.stringify({ trades, recs, positions, generated_at: new Date().toISOString() }, null, 2));
    closeDb();
  });

program.parseAsync(process.argv).catch(console.error);
EOF

# ── scripts/db-init.ts ────────────────────────────────────────────────────────
cat > scripts/db-init.ts << 'EOF'
/**
 * Peuple la base avec les assets par défaut.
 * Modifier la liste selon vos besoins.
 */
import { getDb, closeDb } from '../src/database';

const DEFAULT_ASSETS = [
  { id: 'bitcoin',   symbol: 'BTC',  name: 'Bitcoin',       type: 'crypto',            coingecko_id: 'bitcoin' },
  { id: 'ethereum',  symbol: 'ETH',  name: 'Ethereum',      type: 'crypto',            coingecko_id: 'ethereum' },
  { id: 'solana',    symbol: 'SOL',  name: 'Solana',        type: 'crypto',            coingecko_id: 'solana' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink',     type: 'crypto',            coingecko_id: 'chainlink' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche',  type: 'crypto',            coingecko_id: 'avalanche-2' },
  { id: 'usd-coin',  symbol: 'USDC', name: 'USD Coin',      type: 'stablecoin',        coingecko_id: 'usd-coin',
    mint_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  // Stocks tokénisés (prix via Jupiter on-chain — pas de coingecko_id)
  { id: 'xstock-aapl', symbol: 'xAAPL', name: 'Apple (xStock)', type: 'tokenized_stock',
    mint_address: '' /* À renseigner quand disponible */ },
  { id: 'xstock-tsla', symbol: 'xTSLA', name: 'Tesla (xStock)', type: 'tokenized_stock',
    mint_address: '' },
];

const db = getDb();
const insert = db.prepare(`
  INSERT OR IGNORE INTO assets (id, symbol, name, type, mint_address, coingecko_id)
  VALUES (@id, @symbol, @name, @type, @mint_address, @coingecko_id)
`);

for (const a of DEFAULT_ASSETS) {
  insert.run({ mint_address: null, coingecko_id: null, ...a });
  console.log(`✓ ${a.symbol} — ${a.name}`);
}

closeDb();
console.log('\n✅ Base initialisée avec les assets par défaut.');
EOF

# ── tests/unit/recommender.test.ts ───────────────────────────────────────────
cat > tests/unit/recommender.test.ts << 'EOF'
import { Recommender } from '../../src/engine/recommender';

// Mock DB pour ne pas dépendre de SQLite en test unitaire
jest.mock('../../src/database', () => ({
  getDb: () => ({
    prepare: () => ({ run: jest.fn() }),
  }),
}));

describe('Recommender', () => {
  const rec = new Recommender();

  const baseSnapshot = {
    assetId: 'solana',
    symbol: 'SOL',
    priceUsd: 100,
    change1h: 0,
    change24h: 0,
    change7d: 0,
    volume24h: 1_000_000_000,
    marketCap: 40_000_000_000,
  };

  it('recommande BUY sur momentum positif fort', () => {
    const r = rec.analyze({ ...baseSnapshot, change1h: 2, change24h: 5, change7d: 10 }, null);
    expect(r.action).toBe('buy');
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it('recommande SELL sur stop-loss -10%', () => {
    const pos = { assetId: 'solana', quantity: 1, avgBuyPrice: 111.11, totalInvestedUsd: 111.11 };
    const r = rec.analyze({ ...baseSnapshot, priceUsd: 100 }, pos);
    expect(r.action).toBe('sell');
  });

  it('recommande SELL sur target +20%', () => {
    const pos = { assetId: 'solana', quantity: 1, avgBuyPrice: 80, totalInvestedUsd: 80 };
    const r = rec.analyze({ ...baseSnapshot, priceUsd: 100 }, pos);
    expect(r.action).toBe('sell');
    expect(r.reason).toContain('+20%');
  });

  it('recommande WATCH sans signal fort', () => {
    const r = rec.analyze({ ...baseSnapshot, change24h: -1 }, null);
    expect(['watch', 'hold']).toContain(r.action);
  });
});
EOF

echo ""
echo "✅ Arborescence générée."
echo ""
echo "📦 Étapes suivantes :"
echo "   cd $TARGET"
echo "   cp .env.example .env && nano .env"
echo "   npm install"
echo "   npm run db:init"
echo "   npm run status"