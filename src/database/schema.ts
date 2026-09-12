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
