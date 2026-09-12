/**
 * Système d'alertes sur événements notables.
 * Détecte : mouvements >±10% en 1h, position >15% profit, stop-loss approché (<5% du seuil).
 */
import { getDb } from '../database';
import { logger } from '../utils/logger';

export type AlertType =
  | 'price_spike_1h'
  | 'position_profit_15pct'
  | 'stop_loss_approaching'
  | 'daily_loss_warning'
  | 'daily_trades_warning'
  | 'fear_greed_extreme';

export interface Alert {
  id?: number;
  type: AlertType;
  assetId: string | null;
  symbol: string | null;
  message: string;
  severity: 'info' | 'warn' | 'critical';
  value: number; // Valeur qui a déclenché l'alerte (ex: % de variation)
  threshold: number; // Seuil configuré
  createdAt: string;
  acknowledged: boolean;
}

export interface AlertConfig {
  priceSpike1hPct: number; // défaut 10%
  positionProfitAlertPct: number; // défaut 15%
  stopLossApproachPct: number; // défaut 5% (distance au stop-loss)
  dailyLossWarningPct: number; // défaut 80% du max daily loss
  dailyTradesWarningPct: number; // défaut 80% du max daily trades
  fearGreedExtremeLow: number; // défaut 20 (extreme fear)
  fearGreedExtremeHigh: number; // défaut 80 (extreme greed)
}

const DEFAULT_CONFIG: AlertConfig = {
  priceSpike1hPct: 10,
  positionProfitAlertPct: 15,
  stopLossApproachPct: 5,
  dailyLossWarningPct: 80,
  dailyTradesWarningPct: 80,
  fearGreedExtremeLow: 20,
  fearGreedExtremeHigh: 80,
};

export class AlertEngine {
  private config: AlertConfig;
  private lastAlerts: Map<string, number> = new Map(); // Pour éviter spam (cooldown 1h)

  constructor(config?: Partial<AlertConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Vérifie les alertes de prix (variation 1h > seuil).
   */
  async checkPriceAlerts(): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const db = getDb();

    // Récupérer les derniers snapshots par asset (dernière heure)
    const snapshots = db.prepare(`
      SELECT
        ps.asset_id,
        a.symbol,
        ps.price_usd,
        ps.price_change_1h,
        ps.recorded_at
      FROM price_snapshots ps
      JOIN assets a ON a.id = ps.asset_id
      WHERE ps.recorded_at >= datetime('now', '-1 hour')
        AND ps.price_change_1h IS NOT NULL
        AND a.is_active = 1
      ORDER BY ps.asset_id, ps.recorded_at DESC
    `).all() as Array<{
      asset_id: string;
      symbol: string;
      price_usd: number;
      price_change_1h: number;
      recorded_at: string;
    }>;

    // Grouper par asset et prendre le plus récent
    const latestByAsset = new Map<string, typeof snapshots[0]>();
    for (const s of snapshots) {
      if (!latestByAsset.has(s.asset_id)) {
        latestByAsset.set(s.asset_id, s);
      }
    }

    for (const [assetId, snap] of latestByAsset) {
      const changePct = Math.abs(snap.price_change_1h);
      if (changePct >= this.config.priceSpike1hPct) {
        const key = `price_spike_1h_${assetId}`;
        if (!this.shouldAlert(key)) continue;

        alerts.push({
          type: 'price_spike_1h',
          assetId,
          symbol: snap.symbol,
          message: `${snap.symbol} a bougé de ${snap.price_change_1h >= 0 ? '+' : ''}${snap.price_change_1h.toFixed(2)}% en 1h (prix: $${snap.price_usd.toFixed(4)})`,
          severity: changePct >= this.config.priceSpike1hPct * 2 ? 'critical' : 'warn',
          value: snap.price_change_1h,
          threshold: this.config.priceSpike1hPct,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        });
        this.lastAlerts.set(key, Date.now());
      }
    }

    return alerts;
  }

  /**
   * Vérifie les alertes sur positions ouvertes (profit > 15%, stop-loss approché).
   */
  async checkPositionAlerts(priceMap: Map<string, number>): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const db = getDb();

    const positions = db.prepare(`
      SELECT p.*, a.symbol
      FROM positions p
      JOIN assets a ON a.id = p.asset_id
      WHERE p.status = 'open'
    `).all() as Array<{
      asset_id: string;
      symbol: string;
      quantity: number;
      avg_buy_price: number;
      total_invested_usd: number;
    }>;

    for (const pos of positions) {
      const currentPrice = priceMap.get(pos.asset_id);
      if (!currentPrice) continue;

      const currentValue = pos.quantity * currentPrice;
      const pnlPct = ((currentValue - pos.total_invested_usd) / pos.total_invested_usd) * 100;

      // Alerte profit > 15%
      if (pnlPct >= this.config.positionProfitAlertPct) {
        const key = `position_profit_${pos.asset_id}`;
        if (!this.shouldAlert(key)) continue;

        alerts.push({
          type: 'position_profit_15pct',
          assetId: pos.asset_id,
          symbol: pos.symbol,
          message: `${pos.symbol} en profit de +${pnlPct.toFixed(1)}% (entry: $${pos.avg_buy_price.toFixed(4)}, now: $${currentPrice.toFixed(4)})`,
          severity: 'info',
          value: pnlPct,
          threshold: this.config.positionProfitAlertPct,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        });
        this.lastAlerts.set(key, Date.now());
      }

      // Alerte stop-loss approché (dans les 5% du seuil -10%)
      const stopLossThreshold = -10;
      const distanceToStopLoss = pnlPct - stopLossThreshold; // ex: -6% -> distance = 4%
      if (pnlPct < 0 && distanceToStopLoss <= this.config.stopLossApproachPct && distanceToStopLoss > 0) {
        const key = `stop_loss_approach_${pos.asset_id}`;
        if (!this.shouldAlert(key)) continue;

        alerts.push({
          type: 'stop_loss_approaching',
          assetId: pos.asset_id,
          symbol: pos.symbol,
          message: `${pos.symbol} approche du stop-loss (-10%) : PnL actuel ${pnlPct.toFixed(1)}% (distance: ${distanceToStopLoss.toFixed(1)}%)`,
          severity: 'warn',
          value: pnlPct,
          threshold: stopLossThreshold,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        });
        this.lastAlerts.set(key, Date.now());
      }
    }

    return alerts;
  }

  /**
   * Vérifie les alertes risk management (perte quotidienne, nb trades).
   */
  async checkRiskAlerts(): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    // Perte quotidienne
    const dailyPnl = (db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN side='sell' THEN total_usd ELSE -total_usd END), 0) as pnl
      FROM trades WHERE date(executed_at)=? AND dry_run=0
    `).get(today) as { pnl: number }).pnl;

    // Config risk limits
    const { config } = await import('../config');
    const maxDailyLoss = config.trading.maxDailyLossUsd;
    const maxDailyTrades = config.trading.maxDailyTrades;

    if (dailyPnl < 0) {
      const lossPct = (Math.abs(dailyPnl) / maxDailyLoss) * 100;
      if (lossPct >= this.config.dailyLossWarningPct) {
        const key = `daily_loss_warning_${today}`;
        if (!this.shouldAlert(key)) {
          alerts.push({
            type: 'daily_loss_warning',
            assetId: null,
            symbol: null,
            message: `Perte quotidienne: $${Math.abs(dailyPnl).toFixed(2)} / $${maxDailyLoss} (${lossPct.toFixed(0)}% du max)`,
            severity: lossPct >= 100 ? 'critical' : 'warn',
            value: Math.abs(dailyPnl),
            threshold: maxDailyLoss,
            createdAt: new Date().toISOString(),
            acknowledged: false,
          });
          this.lastAlerts.set(key, Date.now());
        }
      }
    }

    // Nb trades quotidiens
    const tradeCount = (db.prepare(`
      SELECT COUNT(*) as c FROM trades WHERE date(executed_at)=? AND dry_run=0
    `).get(today) as { c: number }).c;

    const tradesPct = (tradeCount / maxDailyTrades) * 100;
    if (tradesPct >= this.config.dailyTradesWarningPct) {
      const key = `daily_trades_warning_${today}`;
      if (!this.shouldAlert(key)) {
        alerts.push({
          type: 'daily_trades_warning',
          assetId: null,
          symbol: null,
          message: `Trades quotidiens: ${tradeCount} / ${maxDailyTrades} (${tradesPct.toFixed(0)}% du max)`,
          severity: tradesPct >= 100 ? 'critical' : 'warn',
          value: tradeCount,
          threshold: maxDailyTrades,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        });
        this.lastAlerts.set(key, Date.now());
      }
    }

    return alerts;
  }

  /**
   * Vérifie Fear & Greed Index extrême.
   */
  async checkFearGreedAlert(): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const db = getDb();

    const latestFg = db.prepare(`
      SELECT message, created_at
      FROM events
      WHERE type = 'fear_greed'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { message: string; created_at: string } | undefined;

    if (!latestFg) return alerts;

    // Extraire la valeur du message "Fear & Greed Index: XX"
    const match = latestFg.message.match(/Fear & Greed Index: (\d+)/);
    if (!match) return alerts;

    const value = parseInt(match[1], 10);

    if (value <= this.config.fearGreedExtremeLow) {
      const key = `fear_greed_low_${value}`;
      if (!this.shouldAlert(key)) {
        alerts.push({
          type: 'fear_greed_extreme',
          assetId: null,
          symbol: null,
          message: `Fear & Greed Index: ${value} — EXTREME FEAR (achat opportunité ?)`,
          severity: 'info',
          value,
          threshold: this.config.fearGreedExtremeLow,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        });
        this.lastAlerts.set(key, Date.now());
      }
    } else if (value >= this.config.fearGreedExtremeHigh) {
      const key = `fear_greed_high_${value}`;
      if (!this.shouldAlert(key)) {
        alerts.push({
          type: 'fear_greed_extreme',
          assetId: null,
          symbol: null,
          message: `Fear & Greed Index: ${value} — EXTREME GREED (prudence recommandée)`,
          severity: 'warn',
          value,
          threshold: this.config.fearGreedExtremeHigh,
          createdAt: new Date().toISOString(),
          acknowledged: false,
        });
        this.lastAlerts.set(key, Date.now());
      }
    }

    return alerts;
  }

  /**
   * Lance toutes les vérifications et persiste les alertes en base.
   */
  async runAllChecks(priceMap: Map<string, number>): Promise<Alert[]> {
    const allAlerts: Alert[] = [];

    const [priceAlerts, positionAlerts, riskAlerts, fgAlerts] = await Promise.all([
      this.checkPriceAlerts(),
      this.checkPositionAlerts(priceMap),
      this.checkRiskAlerts(),
      this.checkFearGreedAlert(),
    ]);

    allAlerts.push(...priceAlerts, ...positionAlerts, ...riskAlerts, ...fgAlerts);

    // Persister en base
    if (allAlerts.length > 0) {
      const db = getDb();
      const insert = db.prepare(`
        INSERT INTO events (type, asset_id, message, severity)
        VALUES (?, ?, ?, ?)
      `);

      for (const alert of allAlerts) {
        insert.run(alert.type, alert.assetId, alert.message, alert.severity);
        logger.warn(`ALERT [${alert.severity.toUpperCase()}] ${alert.message}`);
      }
    }

    return allAlerts;
  }

  /**
   * Récupère les alertes non acquittées.
   */
  getUnacknowledgedAlerts(limit: number = 50): Alert[] {
    const db = getDb();
    return db.prepare(`
      SELECT e.*, a.symbol
      FROM events e
      LEFT JOIN assets a ON a.id = e.asset_id
      WHERE e.acknowledged = 0
      ORDER BY e.created_at DESC
      LIMIT ?
    `).all(limit) as Alert[];
  }

  /**
   * Marque une alerte comme acquittée.
   */
  acknowledgeAlert(eventId: number): void {
    const db = getDb();
    db.prepare(`UPDATE events SET acknowledged = 1 WHERE id = ?`).run(eventId);
  }

  /**
   * Évite le spam : 1 alerte par type/asset par heure.
   */
  private shouldAlert(key: string): boolean {
    const lastTime = this.lastAlerts.get(key);
    if (!lastTime) return true;
    const hourMs = 60 * 60 * 1000;
    return Date.now() - lastTime > hourMs;
  }

  /**
   * Nettoie les anciens cooldowns (appeler périodiquement).
   */
  cleanupCooldowns(): void {
    const hourMs = 60 * 60 * 1000;
    const now = Date.now();
    for (const [key, time] of this.lastAlerts.entries()) {
      if (now - time > hourMs * 24) {
        this.lastAlerts.delete(key);
      }
    }
  }
}

// Instance singleton
export const alertEngine = new AlertEngine();