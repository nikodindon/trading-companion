/**
 * Calibrateur : ajuste le poids des signaux selon résultats passés.
 */
import { getDb } from '../database';
import { logger } from '../utils/logger';

export interface CalibrationResult {
  signalWeights: {
    trend24h7d: number;
    momentum1h24h: number;
    volumeRatio: number;
    recoveryAfterDrop: number;
    dropProtection: number;
    pnlStopProfit: number;
    pnlStopLoss: number;
  };
  calibratedAt: string;
  sampleSize: number;
  accuracyRate: number;
}

export class Calibrator {
  /**
   * Calibre les poids des signaux heuristiques du recommender
   * en comparant recommandations passées avec les résultats réels (Pnl FIFO).
   */
  async calibrateSignalWeights(): Promise<CalibrationResult> {
    const db = getDb();

    // Récupérer toutes les recommandations BUY/SELL du dernier mois
    const recommendations = db.prepare(`
      SELECT r.id, r.asset_id, r.action, r.confidence, r.price_at_rec, r.generated_at, r.acted_upon, r.trade_id
      FROM recommendations r
      WHERE r.generated_at >= datetime('now', '-30 days')
        AND r.action IN ('buy', 'sell')
    `).all() as Array<{
      id: number; asset_id: string; action: string; confidence: number;
      price_at_rec: number; generated_at: string; acted_upon: number; trade_id: number | null;
    }>;

    if (recommendations.length === 0) {
      logger.warn('Calibrator : pas assez de données pour calibrer');
      return {
        signalWeights: {
          trend24h7d: 1.0,
          momentum1h24h: 1.0,
          volumeRatio: 1.0,
          recoveryAfterDrop: 1.0,
          dropProtection: 1.0,
          pnlStopProfit: 1.0,
          pnlStopLoss: 1.0,
        },
        calibratedAt: new Date().toISOString(),
        sampleSize: 0,
        accuracyRate: 0,
      };
    }

    // Compter combien de BUY ont produit un PnL positif dans les 7j suivants
    // (simplification : on regarde le prix actuel comme résultat approximatif)
    let positiveResults = 0;
    let totalEvaluated = 0;

    for (const rec of recommendations) {
      // Vérifier si un trade réel a été fait après la recommandation
      if (rec.acted_upon === 0) continue; // Non exécutée
      totalEvaluated++;

      const trade = db.prepare(`
        SELECT side, price_usd, total_usd
        FROM trades
        WHERE id = ? AND dry_run = 0
      `).get(rec.trade_id) as { side: string; price_usd: number; total_usd: number } | undefined;

      if (!trade) continue;

      // Pour BUY : PnL = prix vente ultérieur - prix achat (approximé par prix actuel)
      // Pour simplifier, on considère le résultat comme positif si le total_usd du sell est > total_usd du buy
      // Ici approximation : comparer le prix de la rec au prix actuel
      const currentPriceRow = db.prepare(`
        SELECT price_usd FROM price_snapshots
        WHERE asset_id = ?
        ORDER BY recorded_at DESC
        LIMIT 1
      `).get(rec.asset_id) as { price_usd: number } | undefined;

      if (!currentPriceRow) continue;

      if (rec.action === 'buy') {
        const pnlApprox = currentPriceRow.price_usd - rec.price_at_rec;
        if (pnlApprox > 0) positiveResults++;
      } else if (rec.action === 'sell') {
        // Pour SELL : succès si le prix actuel est < prix de la rec (on a bien vendu au bon moment)
        const pnlApprox = rec.price_at_rec - currentPriceRow.price_usd;
        if (pnlApprox > 0) positiveResults++;
      }
    }

    const accuracyRate = totalEvaluated > 0 ? positiveResults / totalEvaluated : 0;

    // Ajuster les poids : si le taux de réussite est bon (>55%), augmenter ; sinon réduire
    const baseWeight = 1.0;
    const adjustmentFactor = accuracyRate > 0.55 ? 1 + (accuracyRate - 0.55) * 0.5 : Math.max(0.5, accuracyRate);

    logger.info('Calibrator : calibration terminée', {
      sampleSize: totalEvaluated,
      positiveResults,
      accuracyRate,
      adjustmentFactor,
    });

    return {
      signalWeights: {
        trend24h7d: baseWeight * adjustmentFactor,
        momentum1h24h: baseWeight * adjustmentFactor,
        volumeRatio: baseWeight * adjustmentFactor,
        recoveryAfterDrop: baseWeight * adjustmentFactor,
        dropProtection: baseWeight,
        pnlStopProfit: baseWeight,
        pnlStopLoss: baseWeight,
      },
      calibratedAt: new Date().toISOString(),
      sampleSize: totalEvaluated,
      accuracyRate,
    };
  }
}

export const calibrator = new Calibrator();
