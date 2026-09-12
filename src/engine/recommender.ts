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
