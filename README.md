# 🤖 Trader Companion

> Compagnon de trading autonome sur Solana, conçu pour être piloté par l'agent **Hermes**.  
> Analyse le marché, gère un wallet, propose des positions, exécute des swaps via Jupiter.

---

## Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Architecture](#architecture)
3. [Stack technique](#stack-technique)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Utilisation avec Hermes](#utilisation-avec-hermes)
7. [Commandes CLI](#commandes-cli)
8. [Modules détaillés](#modules-détaillés)
9. [Base de données](#base-de-données)
10. [Risk Management](#risk-management)
11. [Assets supportés](#assets-supportés)
12. [Sécurité](#sécurité)
13. [FAQ](#faq)

---

## Vue d'ensemble

Trader Companion est un système **local-first** qui permet à l'agent Hermes de :

- Consulter l'état complet du marché crypto + stocks tokénisés
- Analyser les positions ouvertes et calculer le PnL en temps réel
- Recevoir des recommandations structurées (BUY / SELL / HOLD / WATCH)
- Exécuter des swaps on-chain via **Jupiter** sur Solana (avec garde-fous)
- Conserver un historique complet dans une base SQLite locale

### Workflow quotidien type

```
Hermes ouvre la session
    │
    ▼
npm run status          ← Vue marché + wallet + positions ouvertes
    │
    ▼
npm run analyze         ← Recommandations par asset (BUY/SELL/HOLD/WATCH)
    │
    ▼
Hermes discute avec toi des signaux
    │
    ▼
(si décision prise) → commande d'exécution avec confirmation
    │
    ▼
npm run report          ← Export JSON machine-readable pour Hermes
```

---

## Architecture

```
trader-companion/
│
├── src/
│   ├── config/           # Chargement .env + validation Zod
│   ├── wallet/           # WalletManager : Solana keypair, balances
│   ├── market/
│   │   ├── coingecko.ts  # Prix, volumes, trending, global market
│   │   └── coinmarketcap.ts  # Quotes CMC, Fear & Greed Index
│   ├── dex/
│   │   └── jupiter.ts    # Quotes de swap, exécution, prix on-chain
│   ├── database/
│   │   ├── schema.ts     # DDL SQLite complet
│   │   └── index.ts      # Singleton de connexion
│   ├── engine/
│   │   ├── recommender.ts # Moteur de recommandation heuristique
│   │   ├── portfolio.ts   # Calcul PnL, valeur totale
│   │   └── indicators.ts  # RSI, EMA, Bollinger Bands, volume ratio
│   ├── risk/
│   │   └── index.ts      # Garde-fous avant toute exécution
│   ├── cli/
│   │   └── index.ts      # CLI Commander (status/analyze/report/indicators)
│   ├── scheduler/
│   │   └── index.ts      # Collecte automatique prix (cron)
│   └── utils/
│       ├── logger.ts     # Winston logs console + fichier
│       └── rate-limiter.ts # Rate limiting avec backoff exponentiel
│
├── scripts/
│   ├── db-init.ts        # Peupler les assets par défaut
│   └── db-migrate.ts     # Migrations futures
│
├── tests/
│   ├── unit/             # Tests unitaires Jest
│   └── integration/      # Tests d'intégration
│
├── data/
│   ├── db/               # trader.db (SQLite)
│   ├── logs/             # trader.log, error.log
│   └── exports/          # Rapports JSON exportés
│
├── docs/
│   └── SECURITY.md       # Consignes de sécurité détaillées
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── ROADMAP.md
```

---

## Stack technique

| Couche | Technologie | Raison |
|---|---|---|
| Langage | TypeScript / Node.js | Écosystème Solana le plus mature |
| Blockchain | `@solana/web3.js` | SDK officiel |
| DEX / Swaps | Jupiter API v6 | Meilleur agrégateur Solana |
| Base de données | SQLite (`better-sqlite3`) | Local, sans serveur, performant |
| Données marché | CoinGecko + CoinMarketCap | Couverture maximale |
| Validation config | Zod | Erreurs claires au démarrage |
| CLI | Commander.js | Interface propre pour Hermes |
| Logs | Winston | Rotation, niveaux, JSON |
| Tests | Jest + ts-jest | — |

---

## Installation

### Prérequis

- Node.js ≥ 18
- npm ≥ 9
- Un wallet Solana dédié (⚠ **jamais votre wallet principal**)

### Étapes

```bash
# 1. Générer l'arborescence complète
chmod +x init.sh
./init.sh trader-companion

# 2. Entrer dans le projet
cd trader-companion

# 3. Copier et éditer la config
cp .env.example .env
nano .env          # ou votre éditeur préféré

# 4. Installer les dépendances
npm install

# 5. Compiler TypeScript
npm run build

# 6. Initialiser la base de données avec les assets par défaut
npm run db:init

# 7. Premier test
npm run status
```

### Générer un wallet dédié

```bash
# Via Solana CLI
solana-keygen new --outfile ./wallet-trader.json

# Extraire la clé privée au format attendu
cat wallet-trader.json
# Copier le tableau JSON dans WALLET_PRIVATE_KEY dans .env
```

⚠ **Déposer uniquement de petites sommes** sur ce wallet.  
⚠ **Ne jamais committer** le fichier `.env` ou `wallet-trader.json`.

---

## Configuration

Tous les paramètres sont dans `.env` :

```ini
# Réseau Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta

# Wallet (tableau JSON de bytes)
WALLET_PRIVATE_KEY=[12,34,56,...]

# APIs
COINGECKO_API_KEY=         # Optionnel (rate-limited sans clé)
COINMARKETCAP_API_KEY=     # Requis pour Fear & Greed, quotes CMC

# Base de données
DB_PATH=./data/db/trader.db

# Mode — LAISSER true JUSQU'À VALIDATION COMPLÈTE
DRY_RUN=true

# Risk management
MAX_POSITION_SIZE_USD=50   # $ max par trade
MAX_DAILY_TRADES=10        # Trades réels max/jour
MAX_DAILY_LOSS_USD=100     # Coupe-circuit perte quotidienne
DEFAULT_SLIPPAGE_BPS=50    # 0.5% slippage Jupiter

# Logs
LOG_LEVEL=info
LOG_PATH=./data/logs
```

### RPC recommandé

Le RPC public Solana est limité en requêtes. Pour un usage intensif :
- [Helius](https://helius.xyz) — gratuit tier disponible
- [QuickNode](https://quicknode.com)
- [Alchemy](https://alchemy.com)

---

## Utilisation avec Hermes

Hermes (votre agent) interagit principalement via la CLI et les fichiers JSON exportés.

### Session type Hermes

```bash
# 1. Démarrer la session
npm run status

# → Hermes reçoit : balances wallet, prix marché, positions ouvertes, PnL

# 2. Analyser et obtenir les recommandations
npm run analyze

# → Hermes reçoit : BUY/SELL/HOLD/WATCH par asset avec justification

# 3. Export machine-readable
npm run report > data/exports/session-$(date +%Y%m%d-%H%M).json

# → Hermes peut parser le JSON pour le passer à une autre session ou un LLM
```

### Contexte à passer à Hermes

Pour que Hermes soit le plus efficace possible, lui passer en contexte :
1. Le contenu de `npm run report` (JSON positions + dernières recs)
2. Les derniers logs (`tail -n 50 data/logs/trader.log`)
3. Le `.env` **sans** la clé privée (pour qu'il connaisse les limites risk)

---

## Commandes CLI

| Commande | Description |
|---|---|
| `npm run status` | État complet : wallet, marché, positions, PnL |
| `npm run analyze` | Recommandations BUY/SELL/HOLD/WATCH par asset |
| `npm run report` | Export JSON machine-readable |
| `npm run db:init` | Peupler les assets par défaut |
| `npm run build` | Compiler TypeScript → dist/ |
| `npm test` | Lancer tous les tests Jest |
| `npm run test:unit` | Tests unitaires uniquement |
| `npm run scheduler` | Collecte automatique prix (cron 5min) |
| `npm run indicators` | Indicateurs techniques (RSI, EMA, BB, volume) |
| `npm run signals` | Analyse combinée (confluence + corrélation BTC + saisonnalité) |
| `npm run calibrate` | Calibration des poids de signaux sur résultats passés |
| `npm run daily-report` | Rapport quotidien Markdown |
| `npm run export` | Export CSV historique trades |
| `npm run backtest` | Backtest sur données passées |
| `npm run dashboard` | Dashboard HTML interactif (Chart.js) |

---

## Modules détaillés

### `src/market/coingecko.ts` — CoinGeckoClient

- `getMarketData(coinIds[])` — Prix, volumes, variations 1h/24h/7j pour une liste d'assets
- `getGlobalMarket()` — Market cap total, dominance BTC, variation 24h
- `getTrendingCoins()` — Top 7 trending du moment

Fonctionne sans clé API (rate-limited à ~10-30 req/min).  
Avec une clé Pro : pas de limite + endpoints supplémentaires.

### `src/market/coinmarketcap.ts` — CoinMarketCapClient

- `getLatestQuotes(slugs[])` — Quotes temps réel CMC
- `getFearGreedIndex()` — Indice Fear & Greed (0-100)

Requiert une clé API CMC (plan gratuit disponible).

### `src/dex/jupiter.ts` — JupiterClient

- `getQuote(inputMint, outputMint, amount, slippage)` — Meilleur chemin de swap
- `getPriceUsd(mint)` — Prix on-chain d'un token (via quote USDC)
- `executeSwap(quote, walletKey, signFn)` — Exécution avec guard DRY_RUN

**En `DRY_RUN=true`** : logge le swap sans rien envoyer on-chain.  
**En `DRY_RUN=false`** : exécute réellement la transaction.

### `src/engine/recommender.ts` — Recommender

Moteur heuristique Phase 1. Paramètres clés :

| Signal | Poids |
|---|---|
| Trend 24h > 3% ET 7j > 5% | +2 points BUY |
| Momentum 1h > 1% ET 24h > 2% | +1 point BUY |
| Volume > 5% market cap | +1 point BUY |
| Recovery après -15% sur 7j | +1 point BUY |
| Baisse 24h > 5% | -2 points |
| PnL position > +20% | → SELL (stop profit) |
| PnL position < -10% | → SELL (stop loss) |

Score ≥ 3 → BUY | Score ≥ 1 → WATCH | Score < 1 → WATCH/HOLD

### `src/engine/signals.ts` — SignalEngine
- `calculateConfluence()` : matrice de confluence (score 0-5) combinant RSI, EMA, BB, volume
- `checkBtcCorrelation()` : corrélation BTC vs alts (bullish/bearish)
- `checkSeasonality()` : patterns hebdomadaires basés sur historique SQLite
- `generateCombinedAnalysis()` : analyse complète avec recommandation, score de confiance, conseils

### `src/engine/llm-advisor.ts` — LLMAdvisor (optionnel)
- Intégration LLM externe (Ollama via `provider=ollama`)
- Analyse en langage naturel du contexte marché + portfolio + recommandations + alertes
- Méthode `generateAnalysis()` : fournit un résumé structuré prêt pour un LLM
- Méthode `queryLLM()` : requête vers endpoint Ollama (ou autre provider)

### `src/engine/calibrator.ts` — Calibrator
- Ajuste les poids des signaux heuristiques selon taux de réussite passé (30j)
- `calibrateSignalWeights()` : retourne `signalWeights` + `accuracyRate`

### `src/engine/watchlist-dynamic.ts` — DynamicWatchlist
- `analyzeTrending()` : détecte coins trending CoinGecko non encore suivis
- `proposeAdditions()` : propose ajout automatique (min score 0.8)

### `src/risk/index.ts` — RiskManager

Vérifié **avant toute exécution réelle**, indépendamment du recommender :

1. **Taille de position** ≤ `MAX_POSITION_SIZE_USD`
2. **Nombre de trades/jour** ≤ `MAX_DAILY_TRADES`
3. **Perte quotidienne** ≤ `MAX_DAILY_LOSS_USD`

Si une des vérifications échoue → trade **bloqué**, même si Hermes valide.

---

### `src/scheduler/index.ts` — PriceScheduler

Collecte automatique des prix via cron (par défaut toutes les 5 minutes) :
- `start()` / `stop()` — Démarre/arrête le processus
- `runOnce()` — Exécution manuelle unique
- Collecte CoinGecko (prix, volumes, variations) + CMC Fear & Greed Index
- Utilise le RateLimiter pour respecter les quotas API

### `src/engine/indicators.ts` — TechnicalIndicators

Indicateurs techniques calculés depuis l'historique SQLite :
- **RSI (14)** — Relative Strength Index (Wilder's smoothing)
- **EMA 20 / EMA 50** — Moyennes mobiles exponentielles + détection croisements
- **Bollinger Bands (20, 2σ)** — Bandes sup/milieu/inf + largeur (%)
- **Volume Ratio 7j** — Volume actuel / moyenne 7j

Fonctions utiles :
- `calculateForAsset(assetId)` — Tous les indicateurs pour un asset
- `calculateAll()` — Tous les assets actifs
- `interpretSignals()` — Interprétation : RSI (oversold/overbought), Trend (bullish/bearish), BB (squeeze/expansion), Volume (high/low)
- `checkBBTouch()` — Détection toucher bande haute/basse

### `src/utils/rate-limiter.ts` — RateLimiter

Rate limiting intelligent par domaine (coingecko, coinmarketcap, jupiter) :
- File d'attente avec backoff exponentiel (1s, 2s, 4s... max 30s)
- Fenêtre glissante configurable (défaut 30 req/min)
- Retry automatique (max 3) avec logs
- Stats en temps réel : `getStats(domain)`

---

## Base de données

SQLite locale (`data/db/trader.db`). Tables principales :

| Table | Contenu |
|---|---|
| `assets` | Assets suivis (crypto + stocks tokénisés) |
| `price_snapshots` | Historique de tous les prix récupérés |
| `positions` | Positions ouvertes / fermées / partielles |
| `trades` | Chaque trade exécuté (dry ou réel) |
| `recommendations` | Toutes les recommandations générées |
| `sessions` | Chaque ouverture de session Hermes |
| `events` | Alertes et événements notables |

### Requêtes utiles

```sql
-- PnL total réalisé
SELECT SUM(CASE WHEN side='sell' THEN total_usd ELSE -total_usd END) as pnl
FROM trades WHERE dry_run=0;

-- Historique de prix SOL (dernières 24h)
SELECT recorded_at, price_usd FROM price_snapshots
WHERE asset_id='solana' AND recorded_at > datetime('now','-1 day')
ORDER BY recorded_at;

-- Recommandations récentes
SELECT a.symbol, r.action, r.confidence, r.reason
FROM recommendations r JOIN assets a ON a.id=r.asset_id
ORDER BY r.generated_at DESC LIMIT 20;
```

---

## Risk Management

Le système applique **trois niveaux de garde-fous** :

### Niveau 1 — Configuration
Défini dans `.env`. Modifiable sans redéploiement.

### Niveau 2 — RiskManager (code)
Vérification synchrone avant chaque exécution. Non contournable par la CLI.

### Niveau 3 — Mode DRY_RUN
`DRY_RUN=true` (défaut) garantit qu'aucune transaction on-chain n'est émise.  
Passer à `false` uniquement après :
- ✅ Plusieurs sessions de simulation validées
- ✅ Tests unitaires et intégration passants
- ✅ Relecture complète du code d'exécution

### Recommandations opérationnelles

- Commencer avec `MAX_POSITION_SIZE_USD=20-50`
- Ne mettre sur le wallet que ce que vous acceptez de perdre entièrement
- Toujours valider manuellement avec Hermes avant d'activer `DRY_RUN=false`
- Surveiller `data/logs/error.log` régulièrement

---

## Assets supportés

### Cryptos (via CoinGecko)
Tout asset listé sur CoinGecko avec un `id` valide.  
Exemples : `bitcoin`, `ethereum`, `solana`, `chainlink`, `avalanche-2`

### Stocks tokénisés (via Jupiter on-chain)
Assets émis sur Solana représentant des actions traditionnelles.  
Exemples : xAAPL, xTSLA, xSPY (selon disponibilité sur Jupiter)

Pour les ajouter :
```typescript
// Dans scripts/db-init.ts
{ id: 'xstock-nvda', symbol: 'xNVDA', name: 'NVIDIA (xStock)',
  type: 'tokenized_stock', mint_address: 'ADRESSE_MINT_SOLANA' }
```

Le prix est récupéré via un quote Jupiter (USDC → token).

---

## Sécurité

Voir `docs/SECURITY.md` pour le détail complet.

Points critiques :

- 🔑 **Clé privée** : ne jamais la committer, utiliser des variables d'environnement
- 👛 **Wallet dédié** : jamais votre wallet principal
- 💰 **Fonds limités** : uniquement ce que vous acceptez de perdre
- 🔵 **DRY_RUN=true** par défaut et pendant toute la phase de test
- 🔒 **`.gitignore`** inclut `.env`, `*.db`, `*.key`

---

## FAQ

**Q : Peut-on lancer plusieurs instances en parallèle ?**  
R : Non recommandé — SQLite (`better-sqlite3`) est synchrone et single-process. Une instance à la fois.

**Q : Comment ajouter un nouvel asset crypto ?**  
R : Ajouter une ligne dans `scripts/db-init.ts` avec l'`id` CoinGecko exact, puis relancer `npm run db:init`.

**Q : Quelle fréquence d'appels API CoinGecko sans clé ?**  
R : ~10-30 req/min. Pour des mises à jour toutes les 5-10 minutes (cron), c'est suffisant.

**Q : Comment reset complètement la base ?**  
R : `rm data/db/trader.db && npm run db:init`

**Q : Est-ce du conseil financier ?**  
R : **Non.** Ce projet est un outil d'exploration technique. Les recommandations sont heuristiques et ne constituent pas un conseil financier. Les marchés crypto sont hautement volatils.

---

*Trader Companion — projet personnel de Niko / nikodindon*  
*Pas de conseil financier. Utilisez à vos propres risques.*
