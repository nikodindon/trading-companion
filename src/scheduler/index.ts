/**
 * Scheduler automatique pour collecte de prix périodique.
 * Démarre avec `npm run scheduler` (processus séparé).
 */
import { CronJob } from 'cron';
import { config } from '../config';
import { getDb, closeDb } from '../database';
import { CoinGeckoClient } from '../market/coingecko';
import { CoinMarketCapClient } from '../market/coinmarketcap';
import { logger } from '../utils/logger';
import { rateLimiter } from '../utils/rate-limiter';

interface SchedulerConfig {
  intervalMinutes: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  intervalMinutes: 5,
  enabled: true,
};

export class PriceScheduler {
  private job: CronJob | null = null;
  private cgClient: CoinGeckoClient;
  private cmcClient: CoinMarketCapClient | null = null;
  private config: SchedulerConfig;
  private isRunning = false;

  constructor(customConfig?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.cgClient = new CoinGeckoClient();

    if (config.apis.coinmarketcapKey) {
      this.cmcClient = new CoinMarketCapClient();
    }
  }

  private async collectPrices(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler: collection déjà en cours, skip');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const db = getDb();

      // Récupérer les assets actifs (crypto seulement pour CoinGecko)
      const assets = db.prepare(`
        SELECT id, symbol, name, type, coingecko_id
        FROM assets
        WHERE is_active = 1 AND type = 'crypto' AND coingecko_id IS NOT NULL
      `).all() as Array<{ id: string; symbol: string; name: string; type: string; coingecko_id: string }>;

      if (assets.length === 0) {
        logger.info('Scheduler: aucun asset crypto à collecter');
        return;
      }

      const cgIds = assets.map(a => a.coingecko_id).filter(Boolean);

      // Collecte CoinGecko avec rate limiting
      if (cgIds.length > 0) {
        logger.info(`Scheduler: collecte prix pour ${cgIds.length} assets via CoinGecko`);

        const marketData = await rateLimiter.execute('coingecko', () =>
          this.cgClient.getMarketData(cgIds)
        );

        const insertSnapshot = db.prepare(`
          INSERT INTO price_snapshots (asset_id, price_usd, volume_24h, market_cap, price_change_1h, price_change_24h, price_change_7d, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'coingecko')
        `);

        for (const d of marketData) {
          insertSnapshot.run(
            d.id,
            d.current_price,
            d.total_volume ?? null,
            d.market_cap ?? null,
            d.price_change_percentage_1h_in_currency ?? null,
            d.price_change_percentage_24h ?? null,
            d.price_change_percentage_7d_in_currency ?? null
          );
        }

        logger.info(`Scheduler: ${marketData.length} snapshots CoinGecko insérés`);
      }

      // Collecte CMC Fear & Greed (une fois par jour, ou selon config)
      if (this.cmcClient) {
        try {
          const fearGreed = await rateLimiter.execute('coinmarketcap', () =>
            this.cmcClient!.getFearGreedIndex()
          );

          if (fearGreed !== null) {
            // Stocker dans events pour traçabilité
            db.prepare(`
              INSERT INTO events (type, asset_id, message, severity)
              VALUES ('fear_greed', NULL, ?, 'info')
            `).run(`Fear & Greed Index: ${fearGreed}`);
            logger.info(`Scheduler: Fear & Greed Index = ${fearGreed}`);
          }
        } catch (err) {
          logger.warn('Scheduler: échec Fear & Greed', err);
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`Scheduler: collecte terminée en ${duration}ms`);
    } catch (err) {
      logger.error('Scheduler: erreur lors de la collecte', err);
    } finally {
      this.isRunning = false;
    }
  }

  start(): void {
    if (this.job) {
      logger.warn('Scheduler: déjà démarré');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Scheduler: désactivé par config');
      return;
    }

    const cronExpression = `*/${this.config.intervalMinutes} * * * *`;

    this.job = new CronJob(cronExpression, async () => {
      await this.collectPrices();
    });

    this.job.start();
    logger.info(`Scheduler: démarré (toutes les ${this.config.intervalMinutes} minutes)`);
  }

  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      logger.info('Scheduler: arrêté');
    }
  }

  async runOnce(): Promise<void> {
    logger.info('Scheduler: exécution manuelle unique');
    await this.collectPrices();
  }

  getStatus(): { running: boolean; intervalMinutes: number; enabled: boolean } {
    return {
      running: this.job !== null,
      intervalMinutes: this.config.intervalMinutes,
      enabled: this.config.enabled,
    };
  }
}

// Point d'entrée pour `npm run scheduler`
export async function startScheduler(): Promise<void> {
  const scheduler = new PriceScheduler({
    intervalMinutes: 5,
    enabled: true,
  });

  // Gestion graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Scheduler: signal ${signal} reçu, arrêt...`);
    scheduler.stop();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  scheduler.start();

  // Garder le processus vivant
  logger.info('Scheduler: en cours d\'exécution (Ctrl+C pour arrêter)');
}

// Exécution directe si appelé comme script
if (require.main === module) {
  startScheduler().catch(err => {
    logger.error('Scheduler: erreur fatale', err);
    process.exit(1);
  });
}