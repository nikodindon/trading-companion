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
