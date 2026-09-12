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
