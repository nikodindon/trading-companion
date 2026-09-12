#!/usr/bin/env ts-node
import { Command } from 'commander';
import chalk from 'chalk';
import { getDb, closeDb } from '../database';
import { WalletManager } from '../wallet';
import { CoinGeckoClient } from '../market/coingecko';
import { Recommender } from '../engine/recommender';
import { getPortfolioSummary } from '../engine/portfolio';
import { RiskManager } from '../risk';
import { technicalIndicators, TechnicalIndicators } from '../engine/indicators';
import { calculatePortfolioPnl } from '../engine/pnl';
import { alertEngine } from '../engine/alerts';
import { notifier } from '../utils/notifier';
import { config } from '../config';
import { logger } from '../utils/logger';
import { signalEngine } from '../engine/signals';
import { executeProgram } from './commands/execute';

const program = new Command();
program.name('trader').description('Trader Companion — CLI for Hermes agent').version('0.1.0');

// Intégrer le sous-programme execute dans le CLI principal
program.addCommand(executeProgram);

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

// ── indicators ─────────────────────────────────────────────────────────────────
program
  .command('indicators')
  .description('Indicateurs techniques (RSI, EMA, Bollinger Bands) pour tous les assets')
  .action(async () => {
    try {
      console.log(chalk.cyan('\n═══════════════════════════════════════'));
      console.log(chalk.cyan('  📈 INDICATEURS TECHNIQUES'));
      console.log(chalk.cyan('═══════════════════════════════════════\n'));

      const results = await technicalIndicators.calculateAll();

      if (results.length === 0) {
        console.log(chalk.gray('  Pas assez de données historiques (minimum 50 snapshots par asset).'));
        console.log(chalk.gray('  Lancez le scheduler ou attendez plus de collecte.'));
        return;
      }

      console.log(chalk.gray('  Asset      Prix      RSI    EMA20    EMA50    BB Width  Vol Ratio  Signaux'));
      console.log('─'.repeat(95));

      for (const ind of results) {
        const signals = TechnicalIndicators.interpretSignals(ind);
        const bbTouch = TechnicalIndicators.checkBBTouch(ind);

        const rsiStr = ind.rsi14 !== null ? ind.rsi14.toFixed(1) : 'N/A';
        const ema20Str = ind.ema20 !== null ? ind.ema20.toFixed(4) : 'N/A';
        const ema50Str = ind.ema50 !== null ? ind.ema50.toFixed(4) : 'N/A';
        const bbWidthStr = ind.bbWidth !== null ? ind.bbWidth.toFixed(1) + '%' : 'N/A';
        const volStr = ind.volumeRatio7d !== null ? ind.volumeRatio7d.toFixed(2) + 'x' : 'N/A';

        const signalParts: string[] = [];
        if (signals.rsiSignal !== 'neutral') signalParts.push(`RSI:${signals.rsiSignal}`);
        if (signals.trendSignal !== 'neutral') signalParts.push(`Trend:${signals.trendSignal}`);
        if (signals.bbSignal !== 'normal') signalParts.push(`BB:${signals.bbSignal}`);
        if (signals.volumeSignal !== 'normal') signalParts.push(`Vol:${signals.volumeSignal}`);
        if (bbTouch !== 'none') signalParts.push(`BB-touch:${bbTouch}`);

        const signalStr = signalParts.length > 0 ? signalParts.join(', ') : '—';

        console.log(`  ${ind.assetId.padEnd(10)} $${ind.price.toFixed(4).padEnd(10)} ${rsiStr.padEnd(7)} ${ema20Str.padEnd(10)} ${ema50Str.padEnd(10)} ${bbWidthStr.padEnd(10)} ${volStr.padEnd(10)} ${signalStr}`);
      }

      console.log('');
    } catch (err) {
      logger.error('Indicators command error', err);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// ── daily-report ────────────────────────────────────────────────────────────────
program
  .command('daily-report')
  .description('Rapport quotidien Markdown (PnL, positions, alertes, recommandations)')
  .option('--date <date>', 'Date du rapport (YYYY-MM-DD), défaut: aujourd\'hui')
  .action(async (opts) => {
    try {
      const date = opts.date || new Date().toISOString().slice(0, 10);
      const db = getDb();

      // Récupérer les données de la journée
      const trades = db.prepare(`
        SELECT t.*, a.symbol
        FROM trades t
        JOIN assets a ON a.id = t.asset_id
        WHERE date(t.executed_at) = ? AND t.dry_run = 0
        ORDER BY t.executed_at
      `).all(date) as Array<{ symbol: string; side: string; quantity: number; price_usd: number; total_usd: number; fees_usd: number; executed_at: string }>;

      const recs = db.prepare(`
        SELECT r.*, a.symbol
        FROM recommendations r
        JOIN assets a ON a.id = r.asset_id
        WHERE date(r.generated_at) = ?
        ORDER BY r.generated_at DESC
      `).all(date);

      const alerts = db.prepare(`
        SELECT e.*, a.symbol
        FROM events e
        LEFT JOIN assets a ON a.id = e.asset_id
        WHERE date(e.created_at) = ?
        ORDER BY e.created_at DESC
      `).all(date);

      const sessions = db.prepare(`
        SELECT * FROM sessions WHERE date(started_at) = ?
      `).all(date);

      // Prix actuels pour PnL
      const cg = new CoinGeckoClient();
      const cgIds = ['bitcoin', 'ethereum', 'solana', 'chainlink', 'avalanche-2'];
      const marketData = await cg.getMarketData(cgIds);
      const priceMap = new Map(marketData.map(d => [d.id, d.current_price]));

      const pnl = calculatePortfolioPnl(priceMap);

      // Générer le Markdown
      const lines: string[] = [];
      lines.push(`# 📊 Daily Report — ${date}`);
      lines.push('');
      lines.push(`> Généré le ${new Date().toLocaleString('fr-FR')}`);
      lines.push('');

      // Résumé PnL
      lines.push('## 💰 Résumé PnL');
      lines.push('');
      lines.push(`| Métrique | Valeur |`);
      lines.push(`|---|---|`);
      lines.push(`| PnL réalisé | ${pnl.totalRealizedPnlUsd >= 0 ? '🟢' : '🔴'} $${pnl.totalRealizedPnlUsd.toFixed(2)} (${pnl.totalRealizedPnlPct.toFixed(2)}%) |`);
      lines.push(`| PnL non-réalisé | ${pnl.totalUnrealizedPnlUsd >= 0 ? '🟢' : '🔴'} $${pnl.totalUnrealizedPnlUsd.toFixed(2)} (${pnl.totalUnrealizedPnlPct.toFixed(2)}%) |`);
      lines.push(`| Frais totaux | 💸 $${pnl.totalFeesUsd.toFixed(2)} |`);
      lines.push(`| Investi total | 💵 $${pnl.totalInvestedUsd.toFixed(2)} |`);
      lines.push(`| Valeur actuelle | 💎 $${pnl.currentValueUsd.toFixed(2)} |`);
      lines.push('');

      // Trades du jour
      if (trades.length > 0) {
        lines.push(`## 📝 Trades du jour (${trades.length})`);
        lines.push('');
        lines.push(`| Heure | Asset | Side | Quantité | Prix | Total | Frais |`);
        lines.push(`|---|---|---|---|---|---|---|`);
        for (const t of trades) {
          const sideEmoji = t.side === 'buy' ? '🟢' : '🔴';
          lines.push(`| ${t.executed_at.slice(11, 16)} | ${t.symbol} | ${sideEmoji} ${t.side.toUpperCase()} | ${t.quantity.toFixed(6)} | $${t.price_usd.toFixed(4)} | $${t.total_usd.toFixed(2)} | $${t.fees_usd.toFixed(4)} |`);
        }
        lines.push('');
      } else {
        lines.push('## 📝 Trades du jour');
        lines.push('');
        lines.push('_Aucun trade réel aujourd\'hui._');
        lines.push('');
      }

      // Positions actuelles
      if (pnl.assets.length > 0) {
        lines.push('## 📈 Positions actuelles');
        lines.push('');
        lines.push(`| Asset | Qté | Prix entry | Prix actuel | Valeur | PnL $ | PnL % | Win Rate |`);
        lines.push(`|---|---|---|---|---|---|---|---|`);
        for (const a of pnl.assets) {
          const pnlEmoji = a.unrealizedPnlUsd >= 0 ? '🟢' : '🔴';
          lines.push(`| ${a.symbol} | ${a.quantity.toFixed(6)} | $${a.avgBuyPrice.toFixed(4)} | $${a.currentPrice.toFixed(4)} | $${a.currentValueUsd.toFixed(2)} | ${pnlEmoji} $${a.unrealizedPnlUsd.toFixed(2)} | ${pnlEmoji} ${a.unrealizedPnlPct.toFixed(1)}% | ${a.winRate.toFixed(0)}% |`);
        }
        lines.push('');
      }

      // Recommandations du jour
      if (recs.length > 0) {
        lines.push(`## 🧠 Recommandations du jour (${recs.length})`);
        lines.push('');
        lines.push(`| Asset | Action | Confiance | Raison |`);
        lines.push(`|---|---|---|---|`);
        for (const r of recs as Array<{ symbol: string; action: string; confidence: number; reason: string }>) {
          const actionEmoji = { buy: '🟢', sell: '🔴', hold: '🟡', watch: '👁' }[r.action] ?? '';
          lines.push(`| ${r.symbol} | ${actionEmoji} ${r.action.toUpperCase()} | ${(r.confidence * 100).toFixed(0)}% | ${r.reason} |`);
        }
        lines.push('');
      }

      // Alertes
      if (alerts.length > 0) {
        lines.push(`## ⚠️ Alertes (${alerts.length})`);
        lines.push('');
        lines.push(`| Heure | Type | Asset | Sévérité | Message |`);
        lines.push(`|---|---|---|---|---|`);
        for (const a of alerts as Array<{ created_at: string; type: string; symbol: string | null; severity: string; message: string }>) {
          const sevEmoji = { info: 'ℹ️', warn: '⚠️', critical: '🚨' }[a.severity] ?? '';
          lines.push(`| ${a.created_at.slice(11, 16)} | ${a.type} | ${a.symbol ?? '-'} | ${sevEmoji} ${a.severity} | ${a.message} |`);
        }
        lines.push('');
      }

      // Sessions Hermes
      if (sessions.length > 0) {
        lines.push('## 🤖 Sessions Hermes');
        lines.push('');
        lines.push(`| Début | Fin | Portfolio $ | PnL session $ |`);
        lines.push(`|---|---|---|---|`);
        for (const s of sessions as Array<{ started_at: string; ended_at: string | null; portfolio_value_usd: number | null; pnl_session_usd: number | null }>) {
          lines.push(`| ${s.started_at.slice(11, 16)} | ${s.ended_at ? s.ended_at.slice(11, 16) : 'en cours'} | $${s.portfolio_value_usd?.toFixed(2) ?? '-'} | ${s.pnl_session_usd !== null && s.pnl_session_usd !== undefined ? (s.pnl_session_usd >= 0 ? '+' : '') + '$' + s.pnl_session_usd.toFixed(2) : '-'} |`);
        }
        lines.push('');
      }

      console.log(lines.join('\n'));

    } catch (err) {
      logger.error('Daily report error', err);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// ── export ───────────────────────────────────────────────────────────────────────
program
  .command('export')
  .description('Export CSV de l\'historique des trades')
  .option('--from <date>', 'Date début (YYYY-MM-DD)')
  .option('--to <date>', 'Date fin (YYYY-MM-DD)')
  .option('--asset <asset>', 'Filtrer par asset (ex: solana)')
  .option('--output <file>', 'Fichier de sortie (défaut: stdout)')
  .action(async (opts) => {
    try {
      const db = getDb();
      let where = 'WHERE t.dry_run = 0';
      const params: string[] = [];

      if (opts.from) {
        where += ' AND date(t.executed_at) >= ?';
        params.push(opts.from);
      }
      if (opts.to) {
        where += ' AND date(t.executed_at) <= ?';
        params.push(opts.to);
      }
      if (opts.asset) {
        where += ' AND t.asset_id = ?';
        params.push(opts.asset);
      }

      const trades = db.prepare(`
        SELECT t.*, a.symbol
        FROM trades t
        JOIN assets a ON a.id = t.asset_id
        ${where}
        ORDER BY t.executed_at
      `).all(...params) as Array<{
        id: number; asset_id: string; symbol: string; side: string;
        quantity: number; price_usd: number; total_usd: number;
        fees_usd: number; tx_signature: string | null; dry_run: number;
        executed_at: string; notes: string | null;
      }>;

      // CSV header
      const headers = [
        'ID', 'Date', 'Asset', 'Symbol', 'Side', 'Quantity',
        'Price_USD', 'Total_USD', 'Fees_USD', 'Tx_Signature', 'Notes'
      ];

      const rows = trades.map(t => [
        t.id,
        t.executed_at,
        t.asset_id,
        t.symbol,
        t.side.toUpperCase(),
        t.quantity.toFixed(8),
        t.price_usd.toFixed(6),
        t.total_usd.toFixed(2),
        t.fees_usd.toFixed(6),
        t.tx_signature ?? '',
        t.notes ?? '',
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      if (opts.output) {
        const fs = await import('fs');
        fs.writeFileSync(opts.output, csv);
        console.log(`✅ Exporté vers ${opts.output} (${trades.length} trades)`);
      } else {
        console.log(csv);
      }

    } catch (err) {
      logger.error('Export error', err);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// ── backtest ─────────────────────────────────────────────────────────────────────
program
  .command('backtest')
  .description('Backtest simplifié : rejouer les recommandations passées sur données réelles')
  .option('--days <n>', 'Nombre de jours en arrière (défaut: 30)', '30')
  .option('--min-conf <n>', 'Confiance minimum pour agir (0-1, défaut: 0.6)', '0.6')
  .action(async (opts) => {
    try {
      const days = parseInt(opts.days, 10);
      const minConf = parseFloat(opts.minConf);
      const db = getDb();

      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().slice(0, 19).replace('T', ' ');

      // Récupérer toutes les recommandations de la période
      const recs = db.prepare(`
        SELECT r.*, a.symbol
        FROM recommendations r
        JOIN assets a ON a.id = r.asset_id
        WHERE r.generated_at >= ? AND r.confidence >= ? AND r.action IN ('buy', 'sell')
        ORDER BY r.generated_at
      `).all(sinceStr, minConf) as Array<{
        id: number; asset_id: string; symbol: string; action: string;
        confidence: number; reason: string; suggested_size_usd: number | null;
        price_at_rec: number; generated_at: string; acted_upon: number;
      }>;

      if (recs.length === 0) {
        console.log('Aucune recommandation trouvée pour cette période.');
        return;
      }

      // Pour chaque rec, simuler le trade au prix de la rec
      // et calculer PnL jusqu'à aujourd'hui ou prochain signal contraire
      let totalPnl = 0;
      let wins = 0;
      let losses = 0;
      const results: Array<{
        rec: typeof recs[0];
        exitPrice: number;
        exitDate: string;
        pnlUsd: number;
        pnlPct: number;
        heldDays: number;
      }> = [];

      const cg = new CoinGeckoClient();
      const cgIds = ['bitcoin', 'ethereum', 'solana', 'chainlink', 'avalanche-2'];
      const currentPrices = await cg.getMarketData(cgIds);
      const currentPriceMap = new Map(currentPrices.map(d => [d.id, d.current_price]));

      for (const rec of recs) {
        // Trouver prix de sortie : prochain signal contraire ou prix actuel
        const oppositeAction = rec.action === 'buy' ? 'sell' : 'buy';
        const exitRec = db.prepare(`
          SELECT price_at_rec, generated_at
          FROM recommendations
          WHERE asset_id = ? AND action = ? AND generated_at > ?
          ORDER BY generated_at ASC LIMIT 1
        `).get(rec.asset_id, oppositeAction, rec.generated_at) as { price_at_rec: number; generated_at: string } | null;

        let exitPrice: number;
        let exitDate: string;
        let heldDays: number;

        if (exitRec) {
          exitPrice = exitRec.price_at_rec;
          exitDate = exitRec.generated_at;
          const d1 = new Date(rec.generated_at);
          const d2 = new Date(exitRec.generated_at);
          heldDays = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
        } else {
          // Prix actuel
          exitPrice = currentPriceMap.get(rec.asset_id) ?? rec.price_at_rec;
          exitDate = new Date().toISOString();
          const d1 = new Date(rec.generated_at);
          heldDays = (Date.now() - d1.getTime()) / (1000 * 60 * 60 * 24);
        }

        const pnlPct = rec.action === 'buy'
          ? ((exitPrice - rec.price_at_rec) / rec.price_at_rec) * 100
          : ((rec.price_at_rec - exitPrice) / rec.price_at_rec) * 100;

        const sizeUsd = rec.suggested_size_usd ?? config.trading.maxPositionSizeUsd;
        const pnlUsd = sizeUsd * (pnlPct / 100);

        totalPnl += pnlUsd;
        if (pnlUsd > 0) wins++; else if (pnlUsd < 0) losses++;

        results.push({
          rec,
          exitPrice,
          exitDate,
          pnlUsd,
          pnlPct,
          heldDays,
        });
      }

      // Affichage résultats
      console.log(chalk.cyan(`\n═══════════════════════════════════════`));
      console.log(chalk.cyan(`  📊 BACKTEST — ${days} jours, conf ≥ ${minConf}`));
      console.log(chalk.cyan(`═══════════════════════════════════════\n`));

      console.log(`Recommandations testées: ${results.length}`);
      console.log(`Trades gagnants: ${wins} | Trades perdants: ${losses}`);
      console.log(`Win rate: ${results.length > 0 ? ((wins / results.length) * 100).toFixed(1) : 0}%`);
      console.log(`PnL total simulé: ${totalPnl >= 0 ? chalk.green : chalk.red}($${totalPnl.toFixed(2)})`);
      console.log(`PnL moyen/trade: $${(totalPnl / results.length).toFixed(2)}`);
      console.log('');

      console.log(chalk.gray('Détail:'));
      console.log(chalk.gray('Date       Asset  Action  Conf  Entry    Exit     Held  PnL%   PnL$'));
      console.log('─'.repeat(75));

      for (const r of results) {
        const pnlColor = r.pnlUsd >= 0 ? chalk.green : chalk.red;
        const actionEmoji = r.rec.action === 'buy' ? '🟢' : '🔴';
        const entryDate = r.rec.generated_at.slice(0, 10);
        console.log(`${entryDate} ${r.rec.symbol.padEnd(6)} ${actionEmoji} ${r.rec.action.padEnd(5)} ${(r.rec.confidence * 100).toFixed(0).padStart(3)}% $${r.rec.price_at_rec.toFixed(4).padStart(9)} $${r.exitPrice.toFixed(4).padStart(9)} ${r.heldDays.toFixed(1).padStart(4)}d ${pnlColor(r.pnlPct.toFixed(1).padStart(6))} ${pnlColor('$' + r.pnlUsd.toFixed(2))}`);
      }

      console.log('');

    } catch (err) {
      logger.error('Backtest error', err);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// ── dashboard ────────────────────────────────────────────────────────────────────
program
  .command('dashboard')
  .description('Génère un dashboard HTML statique avec graphiques (Chart.js)')
  .option('--output <file>', 'Fichier de sortie (défaut: data/exports/dashboard.html)')
  .action(async (opts) => {
    try {
      const outputFile = opts.output || 'data/exports/dashboard.html';
      const db = getDb();

      // Récupérer données pour graphiques
      // 1. Historique prix (derniers 30 jours)
      const priceHistory = db.prepare(`
        SELECT asset_id, price_usd, recorded_at
        FROM price_snapshots
        WHERE recorded_at >= datetime('now', '-30 days')
        ORDER BY recorded_at
      `).all() as Array<{ asset_id: string; price_usd: number; recorded_at: string }>;

      // 2. PnL par jour (derniers 30 jours)
      const dailyPnl = db.prepare(`
        SELECT
          date(executed_at) as day,
          SUM(CASE WHEN side='sell' THEN total_usd ELSE -total_usd END) as pnl,
          COUNT(*) as trades
        FROM trades
        WHERE dry_run = 0 AND executed_at >= datetime('now', '-30 days')
        GROUP BY date(executed_at)
        ORDER BY day
      `).all() as Array<{ day: string; pnl: number; trades: number }>;

      // 3. Distribution des recommandations
      const recDist = db.prepare(`
        SELECT action, COUNT(*) as count
        FROM recommendations
        WHERE generated_at >= datetime('now', '-30 days')
        GROUP BY action
      `).all() as Array<{ action: string; count: number }>;

      // 4. Portfolio PnL actuel
      const cg = new CoinGeckoClient();
      const cgIds = ['bitcoin', 'ethereum', 'solana', 'chainlink', 'avalanche-2'];
      const marketData = await cg.getMarketData(cgIds);
      const priceMap = new Map(marketData.map(d => [d.id, d.current_price]));
      const pnl = calculatePortfolioPnl(priceMap);

      // Grouper prix par asset
      const pricesByAsset = new Map<string, Array<{ date: string; price: number }>>();
      for (const p of priceHistory) {
        const arr = pricesByAsset.get(p.asset_id) || [];
        arr.push({ date: p.recorded_at.slice(0, 10), price: p.price_usd });
        pricesByAsset.set(p.asset_id, arr);
      }

      // Générer HTML
      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trader Companion — Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; margin: 0; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #00d4aa; text-align: center; margin-bottom: 10px; }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
    .card { background: #16213e; border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .card h2 { margin-top: 0; color: #00d4aa; font-size: 1.2rem; }
    canvas { max-height: 300px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
    .stat { background: #16213e; padding: 20px; border-radius: 12px; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: bold; color: #00d4aa; }
    .stat-label { color: #888; font-size: 0.9rem; margin-top: 5px; }
    .positive { color: #00d4aa !important; }
    .negative { color: #ff4757 !important; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #333; }
    th { color: #00d4aa; }
    .footer { text-align: center; color: #666; margin-top: 30px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 Trader Companion — Dashboard</h1>
    <p class="subtitle">Généré le ${new Date().toLocaleString('fr-FR')} | Mode: ${config.trading.dryRun ? '🔵 DRY RUN' : '🔴 LIVE'}</p>

    <div class="stats">
      <div class="stat">
        <div class="stat-value ${pnl.totalRealizedPnlUsd >= 0 ? 'positive' : 'negative'}">$${pnl.totalRealizedPnlUsd.toFixed(2)}</div>
        <div class="stat-label">PnL Réalisé</div>
      </div>
      <div class="stat">
        <div class="stat-value ${pnl.totalUnrealizedPnlUsd >= 0 ? 'positive' : 'negative'}">$${pnl.totalUnrealizedPnlUsd.toFixed(2)}</div>
        <div class="stat-label">PnL Non-réalisé</div>
      </div>
      <div class="stat">
        <div class="stat-value">$${pnl.totalFeesUsd.toFixed(2)}</div>
        <div class="stat-label">Frais Totaux</div>
      </div>
      <div class="stat">
        <div class="stat-value">$${pnl.currentValueUsd.toFixed(2)}</div>
        <div class="stat-label">Valeur Portfolio</div>
      </div>
    </div>

    <div class="grid">
      <!-- Prix History -->
      <div class="card">
        <h2>📈 Évolution des prix (30j)</h2>
        <canvas id="priceChart"></canvas>
      </div>

      <!-- Daily PnL -->
      <div class="card">
        <h2>📊 PnL Quotidien (30j)</h2>
        <canvas id="pnlChart"></canvas>
      </div>

      <!-- Rec Distribution -->
      <div class="card">
        <h2>🧠 Répartition Recommandations (30j)</h2>
        <canvas id="recChart"></canvas>
      </div>

      <!-- Portfolio -->
      <div class="card">
        <h2>💰 Portfolio Actuel</h2>
        <table>
          <thead>
            <tr><th>Asset</th><th>Quantité</th><th>Entry</th><th>Actuel</th><th>Valeur</th><th>PnL</th><th>PnL%</th></tr>
          </thead>
          <tbody>
            ${pnl.assets.map(a => `
              <tr>
                <td>${a.symbol}</td>
                <td>${a.quantity.toFixed(6)}</td>
                <td>$${a.avgBuyPrice.toFixed(4)}</td>
                <td>$${a.currentPrice.toFixed(4)}</td>
                <td>$${a.currentValueUsd.toFixed(2)}</td>
                <td class="${a.unrealizedPnlUsd >= 0 ? 'positive' : 'negative'}">$${a.unrealizedPnlUsd.toFixed(2)}</td>
                <td class="${a.unrealizedPnlUsd >= 0 ? 'positive' : 'negative'}">${a.unrealizedPnlPct.toFixed(1)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="footer">
      Trader Companion — Phase 2 Dashboard | Données locales SQLite | Pas de conseil financier
    </div>
  </div>

  <script>
    // Prix Chart
    const priceCtx = document.getElementById('priceChart').getContext('2d');
    const priceData = ${JSON.stringify(Object.fromEntries(pricesByAsset))};
    const priceDatasets = Object.entries(priceData).map(([asset, points], i) => ({
      label: asset.toUpperCase(),
      data: points.map(p => ({ x: p.date, y: p.price })),
      borderColor: ['#00d4aa', '#ff4757', '#ffa502', '#3742fa', '#2ed573'][i % 5],
      backgroundColor: 'transparent',
      tension: 0.1,
      pointRadius: 0,
    }));
    new Chart(priceCtx, {
      type: 'line',
      data: { datasets: priceDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { type: 'time', time: { unit: 'day' }, grid: { color: '#333' }, ticks: { color: '#888' } },
          y: { grid: { color: '#333' }, ticks: { color: '#888' } }
        },
        plugins: { legend: { labels: { color: '#eee' } } }
      }
    });

    // PnL Chart
    const pnlCtx = document.getElementById('pnlChart').getContext('2d');
    const pnlData = ${JSON.stringify(dailyPnl)};
    new Chart(pnlCtx, {
      type: 'bar',
      data: {
        labels: pnlData.map(d => d.day),
        datasets: [{
          label: 'PnL quotidien ($)',
          data: pnlData.map(d => d.pnl),
          backgroundColor: pnlData.map(d => d.pnl >= 0 ? 'rgba(0, 212, 170, 0.7)' : 'rgba(255, 71, 87, 0.7)'),
          borderColor: pnlData.map(d => d.pnl >= 0 ? '#00d4aa' : '#ff4757'),
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { grid: { color: '#333' }, ticks: { color: '#888' } }, y: { grid: { color: '#333' }, ticks: { color: '#888' } } },
        plugins: { legend: { labels: { color: '#eee' } } }
      }
    });

    // Rec Chart
    const recCtx = document.getElementById('recChart').getContext('2d');
    const recData = ${JSON.stringify(recDist)};
    new Chart(recCtx, {
      type: 'doughnut',
      data: {
        labels: recData.map(d => d.action.toUpperCase()),
        datasets: [{
          data: recData.map(d => d.count),
          backgroundColor: ['#00d4aa', '#ff4757', '#ffa502', '#3742fa'],
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#eee' } } }
      }
    });
  </script>
</body>
</html>`;

      const fs = await import('fs');
      const path = await import('path');
      const dir = path.dirname(outputFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputFile, html);

      console.log(`✅ Dashboard généré : ${outputFile}`);
      console.log(`   Ouvrez-le dans un navigateur pour voir les graphiques interactifs.`);

    } catch (err) {
      logger.error('Dashboard error', err);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

// ── signals ─────────────────────────────────────────────────────────────────────
program
  .command('signals')
  .description('Analyse combinée (confluence technique + corrélation BTC + saisonnalité)')
  .option('--asset <asset>', 'Asset à analyser (ex: solana)')
  .action(async (opts: { asset?: string }) => {
    try {
      console.log(chalk.cyan('\n═══════════════════════════════════════'));
      console.log(chalk.cyan('  🧠 ANALYSE COMBINÉE (SIGNALS)'));
      console.log(chalk.cyan('═══════════════════════════════════════\n'));

      const db = getDb();
      const assets = db.prepare(`SELECT id, symbol FROM assets WHERE is_active = 1 AND type = 'crypto'`).all() as Array<{ id: string; symbol: string }>;

      const cg = new CoinGeckoClient();
      const cgIds = assets.map(a => a.id).filter(id => !id.startsWith('xstock-'));
      const marketData = await cg.getMarketData(cgIds);
      const priceMap = new Map(marketData.map(d => [d.id, d.current_price]));

      for (const asset of assets.slice(0, opts.asset ? 1 : assets.length)) {
        if (opts.asset && asset.id !== opts.asset.toLowerCase()) continue;

        const currentPrice = priceMap.get(asset.id) ?? 0;
        const analysis = await signalEngine.generateCombinedAnalysis(asset.id, asset.symbol, currentPrice);

        console.log(chalk.bold(`📊 ${asset.symbol.toUpperCase()} — Prix: $${currentPrice.toFixed(4)}`));
        console.log('─'.repeat(60));
        console.log(`  Score confluence : ${analysis.confluence.score}/5`);
        console.log(`  Recommandation   : ${analysis.confluence.recommendation.toUpperCase()} (conf: ${(analysis.confluence.confidence * 100).toFixed(0)}%)`);
        console.log(`  Trend BTC        : ${analysis.correlation.btcTrend.toUpperCase()} (${analysis.correlation.correlationAdvice})`);
        console.log(`  Saisonnalité     : ${analysis.seasonality.pattern} — ${analysis.seasonality.message}`);
        console.log(`  Dynamic sizing  : taille suggérée $${(analysis.dynamicSizeUsd ?? 0).toFixed(0)} (conf ${(analysis.confluence.confidence * 100).toFixed(0)}%)`);
        console.log('');
        console.log(`  Raisons : ${analysis.finalAdvice}`);
        console.log(`  Dynamic sizing : taille suggérée $${(analysis.dynamicSizeUsd ?? 0).toFixed(0)} (conf ${(analysis.confluence.confidence * 100).toFixed(0)}% × vol)`);
        console.log('');
        console.log('  Indicateurs détaillés :');
        console.log(`    RSI(14)  : ${analysis.confluence.indicators.rsi14}`);
        console.log(`    Trend EMA: ${analysis.confluence.indicators.trend}`);
        console.log(`    BB Touch : ${analysis.confluence.indicators.bbTouch}`);
        console.log(`    BB Signal: ${analysis.confluence.indicators.bbSignal}`);
        console.log(`    Volume   : ${analysis.confluence.indicators.volume}`);
        console.log('');
      }
    } catch (err) {
      logger.error('Signals command error', err);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program.parseAsync(process.argv).catch(console.error);
