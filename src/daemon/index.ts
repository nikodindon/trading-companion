/**
 * Mode autonome (`npm run daemon`) : collecte en continu, recommandations horaires,
 * exécution automatique des SELL (stop-loss / take-profit) uniquement.
 * N'exécute JAMAIS de BUY sans validation Hermes.
 */
import { CronJob } from 'cron';
import { getDb, closeDb } from '../database';
import { PriceScheduler } from '../scheduler';
import { CoinGeckoClient } from '../market/coingecko';
import { Recommender } from '../engine/recommender';
import { RiskManager } from '../risk';
import { alertEngine } from '../engine/alerts';
import { technicalIndicators } from '../engine/indicators';
import { logger } from '../utils/logger';
import { config } from '../config';
import { notifier } from '../utils/notifier';

export interface DaemonConfig {
  intervalMinutes: number;
  enabled: boolean;
  autoSellOnly: boolean;
  dryRunOnlyUntilValidated: boolean;
}

const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  intervalMinutes: 60,
  enabled: false,
  autoSellOnly: true,
  dryRunOnlyUntilValidated: true,
};

export class TradingDaemon {
  private job: CronJob | null = null;
  private scheduler: PriceScheduler;
  private config: DaemonConfig;
  private running = false;

  constructor(customConfig?: Partial<DaemonConfig>) {
    this.config = { ...DEFAULT_DAEMON_CONFIG, ...customConfig };
    this.scheduler = new PriceScheduler({ intervalMinutes: 5 });
  }

  private async daemonTick(): Promise<void> {
    if (this.running) {
      logger.warn('Daemon tick déjà en cours, skip');
      return;
    }
    this.running = true;

    try {
      logger.info('Daemon tick démarré');

      await this.scheduler.runOnce();

      const db = getDb();
      const assets = db.prepare(`SELECT id, symbol FROM assets WHERE is_active = 1 AND type = 'crypto'`).all() as Array<{ id: string; symbol: string }>;
      const cg = new CoinGeckoClient();
      const cgIds = assets.map((a) => a.id).filter((id) => !id.startsWith('xstock-'));
      const marketData = await cg.getMarketData(cgIds);
      const priceMap = new Map(marketData.map((d) => [d.id, d.current_price]));

      const recommender = new Recommender();
      const recommendations: Array<{ assetId: string; action: string; confidence: number; priceAtRec: number; suggestedSizeUsd: number | null }> = [];

      for (const d of marketData) {
        const pos = db.prepare(`SELECT quantity, avg_buy_price, total_invested_usd FROM positions WHERE asset_id = ? AND status = 'open'`).get(d.id) as
          | { quantity: number; avg_buy_price: number; total_invested_usd: number }
          | undefined;
        const rec = recommender.analyze({
          assetId: d.id,
          symbol: d.symbol.toUpperCase(),
          priceUsd: d.current_price,
          change1h: d.price_change_percentage_1h_in_currency ?? 0,
          change24h: d.price_change_percentage_24h ?? 0,
          change7d: d.price_change_percentage_7d_in_currency ?? 0,
          volume24h: d.total_volume ?? 0,
          marketCap: d.market_cap ?? 0,
        }, pos ? { assetId: d.id, quantity: pos.quantity, avgBuyPrice: pos.avg_buy_price, totalInvestedUsd: pos.total_invested_usd } : null);
        recommendations.push({
          assetId: rec.assetId,
          action: rec.action,
          confidence: rec.confidence,
          priceAtRec: rec.priceAtRec,
          suggestedSizeUsd: rec.suggestedSizeUsd,
        });
      }

      logger.info('Daemon recommandations', {
        count: recommendations.length,
        actions: recommendations.map((r) => `${r.assetId}:${r.action}`).join(', '),
      });

      // Alertes (prix, positions, risk)
      const priceAlerts = await alertEngine.checkPriceAlerts();
      const positionAlerts = await alertEngine.checkPositionAlerts(priceMap);
      const riskAlerts = await alertEngine.checkRiskAlerts();
      const allAlerts = [...priceAlerts, ...positionAlerts, ...riskAlerts];
      if (allAlerts.length > 0) {
        logger.info('Daemon alertes détectées', { count: allAlerts.length });
      }

      // Indicateurs techniques
      const indicators = await technicalIndicators.calculateAll();
      logger.info('Daemon indicateurs calculés', { count: indicators.length });

      // Auto-sell : STOP-LOSS automatique uniquement (pas BUY automatique)
      const positions = db.prepare(`SELECT p.*, a.symbol FROM positions p JOIN assets a ON a.id = p.asset_id WHERE p.status = 'open'`).all() as Array<any>;
      for (const pos of positions) {
        const currentPrice = priceMap.get(pos.asset_id) ?? pos.avg_buy_price;
        const currentValue = pos.quantity * currentPrice;
        const pnlPct = ((currentValue - pos.total_invested_usd) / pos.total_invested_usd) * 100;
        if (pnlPct <= -10) {
          logger.info('Daemon AUTO-SELL stop-loss', { asset: pos.symbol, pnlPct: pnlPct.toFixed(2), qty: pos.quantity });
          if (!this.config.dryRunOnlyUntilValidated && !config.trading.dryRun) {
            await notifier.notifyTrade({
              action: 'sell',
              assetSymbol: pos.symbol,
              quantity: pos.quantity,
              priceUsd: currentPrice,
              totalUsd: currentValue,
              txSignature: 'AUTO_STOP_LOSS_DAEMON',
              dryRun: false,
              timestamp: new Date().toISOString(),
            });
            console.log(`  AUTO-SELL (stop-loss): ${pos.symbol} qty ${pos.quantity.toFixed(4)} PnL ${pnlPct.toFixed(1)}%`);
          } else {
            console.log(`  AUTO-SELL (simulé): ${pos.symbol} qty ${pos.quantity.toFixed(4)} PnL ${pnlPct.toFixed(1)}%`);
          }
        }
        if (pnlPct >= 20) {
          logger.info('Daemon TAKE-PROFIT atteint', { asset: pos.symbol, pnlPct: pnlPct.toFixed(2) });
          console.log(`  TAKE-PROFIT: ${pos.symbol} qty ${pos.quantity.toFixed(4)} PnL ${pnlPct.toFixed(1)}%`);
        }
      }

      logger.info('Daemon tick terminé', {
        recommendations: recommendations.length,
        alerts: allAlerts.length,
        positions: positions.length,
        indicators: indicators.length,
      });
    } catch (err) {
      logger.error('Daemon tick error', err);
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.job) {
      logger.warn('Daemon déjà démarré');
      return;
    }
    if (!this.config.enabled) {
      logger.info('Daemon désactivé');
      return;
    }
    const expression = `*/${this.config.intervalMinutes} * * * *`;
    this.job = new CronJob(expression, async () => {
      await this.daemonTick();
    });
    this.job.start();
    logger.info(`Daemon démarré (intervalle ${this.config.intervalMinutes} min)`, {
      autoSellOnly: this.config.autoSellOnly,
      dryRunOnly: this.config.dryRunOnlyUntilValidated,
    });
  }

  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      logger.info('Daemon arrêté');
    }
  }
}

export async function startDaemon(): Promise<void> {
  const daemon = new TradingDaemon({ intervalMinutes: 60, enabled: true, autoSellOnly: true, dryRunOnlyUntilValidated: true });

  const shutdown = (signal: string) => {
    logger.info(`Daemon signal ${signal} reçu, arrêt...`);
    daemon.stop();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  daemon.start();
  logger.info('Daemon en cours (Ctrl+C pour arrêter)');
  await new Promise(() => {});
}

if (require.main === module) {
  startDaemon().catch((err) => {
    logger.error('Daemon fatal error', err);
    process.exit(1);
  });
}
