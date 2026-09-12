# 🗺 Roadmap — Trader Companion

> Évolution progressive du système, du scaffolding jusqu'à l'autonomie encadrée.  
> Chaque phase doit être **validée en simulation avant de passer à la suivante**.

---

## Phase 0 — Scaffolding & Infrastructure ✅

**Objectif :** Tout le code tourne, la CI est propre, la base est initialisée.

### Tâches

- [x] Arborescence complète générée par `init.sh`
- [x] TypeScript compilé sans erreur
- [x] SQLite initialisé avec schéma complet
- [x] WalletManager : chargement keypair, balances SOL + SPL
- [x] CoinGeckoClient : prix, volumes, variations, trending
- [x] CoinMarketCapClient : quotes, Fear & Greed
- [x] JupiterClient : quotes de swap, mode DRY_RUN
- [x] RiskManager : 3 garde-fous (taille, trades/jour, perte/jour)
- [x] Recommender heuristique (score basé sur momentum/volume)
- [x] CLI : `status`, `analyze`, `report`
- [x] Tests unitaires Recommender

### Critère de passage

```
npm run build && npm test → 0 erreurs
npm run status           → affiche le tableau de bord
```

---

## Phase 1 — Données de marché complètes 📊 ✅

**Objectif :** Avoir des données riches, fiables et historisées pour chaque session.

### Tâches

- [x] **Scheduler automatique** (`cron`) : snapshot de prix toutes les 5 minutes
  - Fichier : `src/scheduler/index.ts`
  - Démarre avec `npm run scheduler` (process séparé)
- [x] **Indicateurs techniques** calculés à partir de l'historique SQLite :
  - RSI (14 périodes) sur snapshots prix
  - EMA 20 / EMA 50 (croisements)
  - Bollinger Bands (20, 2σ)
  - Volume moyen 7j vs volume actuel
  - Fichier : `src/engine/indicators.ts`
- [x] **Fear & Greed Index** intégré dans `status` et `analyze` (via events table)
- [x] **Global market context** : market cap total, dominance BTC (disponible via CoinGeckoClient)
- [x] **Trending coins** CoinGecko : disponible via `getTrendingCoins()`
- [x] **Prix on-chain Jupiter** pour les stocks tokénisés (xAAPL, xTSLA…) — infrastructure prête
- [x] **Rate limiting intelligent** : file d'attente API avec backoff exponentiel
  - Fichier : `src/utils/rate-limiter.ts`
- [x] **Tests unitaires** indicateurs techniques (couvert par tests Recommender + build)

### Nouvelles commandes CLI

```bash
npm run scheduler      # Démarrer le processus de collecte automatique
npm run indicators     # Afficher les indicateurs techniques actuels
```

### Critère de passage

✅ Collecte automatique fonctionnelle, RSI/EMA/BB calculables après 48h, rate limiter protège les APIs.

---

## Phase 2 — Historique, PnL & Rapports 📈 ✅

**Objectif :** Avoir une vision complète et historisée de toutes les performances.

### Tâches

- [x] **PnL réalisé vs non-réalisé** : calcul précis avec frais
  - Méthode FIFO pour les positions partielles
  - Fichier : `src/engine/pnl.ts`
- [x] **Export de rapport quotidien** en Markdown lisible par Hermes
  - Résumé de session, meilleures/pires positions, recommandations actées
  - Fichier : `src/cli/commands/daily-report.ts` (intégré dans `src/cli/index.ts`)
- [x] **Export CSV** de l'historique de trades
  - Fichier : `src/cli/commands/export.ts` (intégré dans `src/cli/index.ts`)
- [x] **Système d'alertes** sur événements notables :
  - Asset suivi en mouvement > ±10% en 1h
  - Position en profit de plus de 15%
  - Stop-loss approché (< 5% du seuil)
  - Fichier : `src/engine/alerts.ts`
- [x] **Vue calendrier** des sessions Hermes avec PnL par session (dans daily-report)
- [x] **Backtesting simplifié** : rejouer les recommandations passées sur données réelles
  - Fichier : `src/cli/commands/backtest.ts` (intégré dans `src/cli/index.ts`)
- [x] **Dashboard HTML statique** généré à la demande (graphiques Chart.js)
  - Fichier : `src/cli/commands/dashboard.ts` (intégré dans `src/cli/index.ts`)

### Nouvelles commandes CLI

```bash
npm run daily-report   # Rapport Markdown du jour
npm run export         # CSV de l'historique trades
npm run backtest       # Simulation sur données passées
npm run dashboard      # Génère data/exports/dashboard.html
```

### Critère de passage

✅ Rapport quotidien lisible par Hermes sans ambiguïté. Le backtest peut rejouer 30 jours de données. Dashboard HTML interactif généré.

---

## Phase 3 — Exécution réelle supervisée 🔴

**Objectif :** Activer `DRY_RUN=false` avec des garde-fous renforcés et une supervision explicite.

### Prérequis stricts

- ✅ Phases 0, 1 et 2 complètes
- ✅ Minimum 2 semaines de simulation avec des résultats cohérents
- ✅ Backtest positif sur les 30 derniers jours
- ✅ Wallet dédié avec montant limité (ex. 50-100 USDC maximum)
- ✅ Revue complète du code `executeSwap` et `RiskManager`

### Tâches

- [ ] **Confirmation obligatoire** avant tout trade réel
  - Prompt CLI interactif avec résumé du trade et demande de confirmation
  - Option `--yes` pour Hermes (mais loggée explicitement)
  - Fichier : `src/cli/commands/execute.ts`
- [ ] **Transaction logging complet** : signature Solana, explorer link, timestamp
- [ ] **Rollback automatique** : si une transaction échoue → log + alerte, jamais de retry automatique
- [ ] **Notifications** : fichier webhook optionnel (Discord, Telegram) pour chaque trade réel
  - Fichier : `src/utils/notifier.ts`
- [ ] **Rate limiting trades** : délai minimum entre deux trades (ex. 30 secondes)
- [ ] **Vérification solde USDC** avant achat (éviter SOL drain par frais)
- [ ] **Gestion des erreurs de slippage** : si slippage réel > seuil → annulation
- [ ] **Tests d'intégration** avec devnet Solana avant mainnet

### Nouvelles commandes CLI

```bash
npm run execute -- --buy solana --amount 20    # Acheter $20 de SOL (avec confirmation)
npm run execute -- --sell solana --pct 50      # Vendre 50% de la position SOL
npm run execute -- --status                    # Vérifier le statut des transactions récentes
```

### Critère de passage

5 trades réels exécutés avec succès, logs complets, aucune transaction non voulue.

---

## Phase 4 — Intelligence de décision enrichie 🧠

**Objectif :** Passer d'une heuristique simple à un moteur de décision plus robuste.

### Tâches

- [ ] **Signaux techniques combinés** (Phase 1 + RSI + EMA + Bollinger)
  - Matrice de confluence : un BUY nécessite ≥ 3 indicateurs alignés
  - Fichier : `src/engine/signals.ts`
- [ ] **Corrélation entre assets** : détecter quand BTC tire tout le marché
  - Éviter d'acheter des alts quand BTC est en correction
- [ ] **Seasonality** : patterns hebdomadaires/mensuels basés sur l'historique
- [ ] **Intégration LLM externe** (optionnel) :
  - Envoyer le contexte marché + positions à un LLM (local via Ollama ou API)
  - Récupérer une analyse en langage naturel enrichissant la CLI
  - Fichier : `src/engine/llm-advisor.ts`
- [ ] **Scoring de confiance affiné** : calibré sur les résultats des recommandations passées
  - Si rec BUY → trade → +PnL : augmenter le poids de ce signal
  - Fichier : `src/engine/calibrator.ts`
- [ ] **Watchlist dynamique** : ajouter automatiquement des assets si trending + volume fort
- [ ] **Position sizing dynamique** : ajuster la taille selon la confiance et la volatilité

### Critère de passage

Le taux de recommandations "actées et profitables" (mesuré sur 30j) est supérieur à 55%.

---

## Phase 5 — Autonomie encadrée 🚀

**Objectif :** Le système peut tourner seul entre les sessions Hermes, avec reporting automatique.

### Tâches

- [ ] **Mode autonome** (`npm run daemon`) :
  - Collecte les prix en continu
  - Génère des recommandations toutes les heures
  - Exécute automatiquement les SELL (stop-loss / take-profit) uniquement
  - N'exécute jamais de BUY sans validation Hermes
  - Fichier : `src/daemon/index.ts`
- [ ] **Rapport de session automatique** à chaque démarrage de Hermes :
  - Ce qui s'est passé depuis la dernière session
  - Positions fermées, alertes déclenchées, PnL réalisé
- [ ] **Gestion automatique du rebalancing** : si USDC < seuil → pause des achats
- [ ] **Logging structuré** pour intégration avec des outils externes
- [ ] **API REST locale** (Express, port 3000) pour intégration future :
  - `GET /status` — JSON état complet
  - `GET /recommendations` — recommandations actuelles
  - `POST /execute` — trade avec token d'auth local
  - Fichier : `src/api/index.ts`
- [ ] **Tests end-to-end** complets avec devnet

### Critère de passage

Le daemon tourne 72h sans intervention humaine, les stop-loss s'exécutent correctement, Hermes reçoit un rapport complet à l'ouverture de chaque session.

---

## Backlog — Idées futures

Ces fonctionnalités ne sont pas planifiées mais pourraient être intéressantes :

- **Multi-wallet** : gérer plusieurs wallets avec des stratégies différentes
- **Paper trading compétitif** : comparer plusieurs stratégies en parallèle en simulation
- **Intégration DeFi** : farming, lending (Kamino, MarginFi) pour le USDC idle
- **NFT floor price tracking** : si des collections Solana intéressent
- **Tax reporting** : export compatible avec des outils de déclaration crypto
- **Mobile notifications** via Pushover ou Ntfy (self-hosted)
- **Intégration Telegram bot** : Hermes peut envoyer des updates via bot

---

## Tableau de bord des phases

| Phase | Status | Durée estimée |
|---|---|---|
| Phase 0 — Scaffolding | ✅ Livré | Complète |
| Phase 1 — Données marché | ✅ Livré | Complète |
| Phase 2 — Historique & PnL | ✅ Livré | Complète |
| Phase 3 — Exécution réelle | 🔲 À faire | 2-3 semaines |
| Phase 4 — Intelligence | 🔲 À faire | 3-4 semaines |
| Phase 5 — Autonomie | 🔲 À faire | 2-3 semaines |

---

> **Règle d'or :** Ne jamais sauter une phase. La simulation doit toujours précéder l'exécution réelle.  
> Un bug en simulation coûte du temps. Un bug en live coûte de l'argent.
