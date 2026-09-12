/**
 * Signaux techniques combinés (confluence) pour un moteur de décision enrichi.
 * Un BUY fort nécessite ≥ 3 indicateurs alignés positivement.
 */
import { TechnicalIndicators, IndicatorResult } from './indicators';
import { getDb } from '../database';
import { logger } from '../utils/logger';

export interface SignalConfluence {
  assetId: string;
  symbol: string;
  priceUsd: number;
  score: number; // 0-5 : nombre d'indicateurs alignés positivement
  indicators: {
    rsi14: 'neutral' | 'oversold' | 'overbought';
    trend: 'bullish' | 'bearish' | 'neutral';
    bbTouch: 'none' | 'upper' | 'lower';
    bbSignal: 'normal' | 'squeeze' | 'expansion';
    volume: 'normal' | 'high' | 'low';
  };
  recommendation: 'buy' | 'sell' | 'hold' | 'watch';
  confidence: number; // 0-1
  reasons: string[];
  timestamp: string;
}

export interface CorrelationResult {
  btcTrend: 'bullish' | 'bearish' | 'neutral';
  correlationAdvice: 'avoid_alts' | 'neutral' | 'prefer_alts';
  message: string;
}

export class SignalEngine {
  private indicatorsEngine: TechnicalIndicators;

  constructor() {
    this.indicatorsEngine = new TechnicalIndicators();
  }

  /**
   * Calcule la matrice de confluence pour un asset donné.
   * Score : +1 par indicateur aligné positivement pour BUY.
   */
  async calculateConfluence(assetId: string, symbol: string, currentPrice: number): Promise<SignalConfluence> {
    const indicators = await this.indicatorsEngine.calculateForAsset(assetId);
    const reasons: string[] = [];
    let score = 0;

    if (!indicators) {
      return {
        assetId,
        symbol,
        priceUsd: currentPrice,
        score: 0,
        indicators: {
          rsi14: 'neutral',
          trend: 'neutral',
          bbTouch: 'none',
          bbSignal: 'normal',
          volume: 'normal',
        },
        recommendation: 'watch',
        confidence: 0.1,
        reasons: ['Pas assez de données pour les indicateurs techniques'],
        timestamp: new Date().toISOString(),
      };
    }

    const signals = TechnicalIndicators.interpretSignals(indicators);
    const bbTouch = TechnicalIndicators.checkBBTouch(indicators);

    // Score pour BUY : confluence d'au moins 3 signaux positifs
    // RSI oversold (achat opportunité après correction) : +1
    // RSI overbought (vendre) : -1
    // EMA20 > EMA50 (tendance haussière) : +1
    // BB squeeze (potentiel mouvement fort) : +1
    // Volume haut (confirmation mouvement) : +1
    // BB lower touch (rebond possible) : +1
    // BB upper touch (résistance atteinte) : -1

    if (signals.rsiSignal === 'oversold') {
      score += 1;
      reasons.push('RSI oversold (<30) — potentiel rebond');
    } else if (signals.rsiSignal === 'overbought') {
      score -= 1;
      reasons.push('RSI overbought (>70) — risque correction');
    }

    if (signals.trendSignal === 'bullish') {
      score += 1;
      reasons.push('Tendance haussière (EMA20 > EMA50)');
    } else if (signals.trendSignal === 'bearish') {
      score -= 1;
      reasons.push('Tendance baissière (EMA20 < EMA50)');
    }

    if (signals.bbSignal === 'squeeze') {
      score += 1;
      reasons.push('BB squeeze — potentiel breakout');
    }

    if (signals.volumeSignal === 'high') {
      score += 1;
      reasons.push('Volume élevé — confirmation mouvement');
    }

    if (bbTouch === 'lower') {
      score += 1;
      reasons.push('Prix au contact de la bande inférieure BB — support');
    } else if (bbTouch === 'upper') {
      score -= 1;
      reasons.push('Prix au contact de la bande supérieure BB — résistance');
    }

    // Recommandation finale basée sur score
    let recommendation: 'buy' | 'sell' | 'hold' | 'watch' = 'watch';
    let confidence = 0.4;

    if (score >= 3) {
      recommendation = 'buy';
      confidence = Math.min(0.5 + score * 0.08, 0.9);
      reasons.push(`Confluence forte : score ${score}/5`);
    } else if (score >= 1) {
      recommendation = 'watch';
      confidence = 0.55;
      reasons.push(`Surveiller — score de confluence : ${score}/5`);
    } else if (score <= -2) {
      recommendation = 'sell';
      confidence = 0.65;
      reasons.push(`Signaux baissiers : score ${score}/5`);
    } else {
      recommendation = 'watch';
      confidence = 0.4;
      reasons.push('Pas assez de confluence — maintenir position');
    }

    return {
      assetId,
      symbol,
      priceUsd: currentPrice,
      score,
      indicators: {
        rsi14: signals.rsiSignal,
        trend: signals.trendSignal,
        bbTouch,
        bbSignal: signals.bbSignal,
        volume: signals.volumeSignal,
      },
      recommendation,
      confidence,
      reasons,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Vérifie la corrélation avec BTC pour éviter d'acheter des alts en correction BTC.
   */
  async checkBtcCorrelation(): Promise<CorrelationResult> {
    const btcIndicators = await this.indicatorsEngine.calculateForAsset('bitcoin');
    if (!btcIndicators) {
      return {
        btcTrend: 'neutral',
        correlationAdvice: 'neutral',
        message: 'Données BTC insuffisantes pour analyse de corrélation',
      };
    }

    const signals = TechnicalIndicators.interpretSignals(btcIndicators);
    const btcTrend = signals.trendSignal;

    if (btcTrend === 'bearish') {
      return {
        btcTrend,
        correlationAdvice: 'avoid_alts',
        message: 'BTC en correction — éviter d\'acheter des alts (corrélation négative probable)',
      };
    }

    return {
      btcTrend,
      correlationAdvice: btcTrend === 'bullish' ? 'prefer_alts' : 'neutral',
      message: btcTrend === 'bullish'
        ? 'BTC en tendance haussière — alts pourraient suivre (corrélation positive)'
        : 'BTC stable — corrélation neutre avec alts',
    };
  }

  /**
   * Vérifie si un asset a une saisonnalité (pattern hebdomadaire/mensuel basé sur historique SQLite).
   */
  async checkSeasonality(assetId: string): Promise<{ pattern: string; message: string }> {
    const db = getDb();
    const snapshots = db.prepare(`
      SELECT price_usd, strftime('%w', recorded_at) as weekday,
             strftime('%m', recorded_at) as month
      FROM price_snapshots
      WHERE asset_id = ? AND recorded_at >= datetime('now', '-90 days')
      ORDER BY recorded_at DESC
      LIMIT 200
    `).all(assetId) as Array<{ price_usd: number; weekday: string; month: string }>;

    if (snapshots.length < 30) {
      return { pattern: 'insufficient_data', message: 'Pas assez de données pour détecter la saisonnalité (minimum 30j)' };
    }

    // Analyse simple : variation moyenne par jour de la semaine
    const weekdayPriceChanges = new Map<string, number[]>();
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      const weekday = curr.weekday;
      const change = ((prev.price_usd - curr.price_usd) / prev.price_usd) * 100;
      if (!weekdayPriceChanges.has(weekday)) weekdayPriceChanges.set(weekday, []);
      weekdayPriceChanges.get(weekday)!.push(change);
    }

    // Trouver le jour le plus favorable (moyenne positive la plus haute)
    let bestDay = '';
    let bestAvg = -Infinity;
    for (const [day, changes] of weekdayPriceChanges) {
      const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestDay = day;
      }
    }

    const dayNames: Record<string, string> = {
      '0': 'Dimanche', '1': 'Lundi', '2': 'Mardi', '3': 'Mercredi',
      '4': 'Jeudi', '5': 'Vendredi', '6': 'Samedi',
    };

    return {
      pattern: bestAvg > 0 ? 'weekly_positive' : 'weekly_negative',
      message: `Saisonnalité détectée : ${dayNames[bestDay] || bestDay} a tendance à être ${bestAvg > 0 ? 'favorable' : 'défavorable'} (variation moyenne: ${bestAvg.toFixed(2)}%)`,
    };
  }

  /**
   * Génère une analyse combinée (confluence + corrélation + saisonnalité).
   */
  async generateCombinedAnalysis(assetId: string, symbol: string, currentPrice: number, positionData?: { quantity: number; avgBuyPrice: number; totalInvested: number }): Promise<{
    confluence: SignalConfluence;
    correlation: CorrelationResult;
    seasonality: { pattern: string; message: string };
    finalAdvice: string;
    dynamicSizeUsd?: number;
  }> {
    const [confluence, correlation, seasonality] = await Promise.all([
      this.calculateConfluence(assetId, symbol, currentPrice),
      this.checkBtcCorrelation(),
      this.checkSeasonality(assetId),
    ]);

    let finalAdvice = '';
    if (correlation.correlationAdvice === 'avoid_alts' && confluence.recommendation === 'buy') {
      finalAdvice = 'ATTENTION : BTC en correction. Même si les signaux techniques sont positifs pour ' + symbol +
        ', la corrélation négative suggère la prudence. Considerer de réduire la taille de position ou attendre.';
      confluence.recommendation = 'watch';
      confluence.confidence *= 0.6;
      confluence.reasons.push('Corrélation BTC négative détectée — réduction de la confiance');
    } else if (confluence.score >= 3 && correlation.correlationAdvice === 'prefer_alts') {
      finalAdvice = 'Confluence forte (' + confluence.score + '/5) + BTC haussier : opportunité d\'achat confirmée pour ' + symbol + '.';
    } else if (confluence.score >= 3) {
      finalAdvice = 'Confluence technique forte (' + confluence.score + '/5) pour ' + symbol + '. Trade recommandé.';
    } else {
      finalAdvice = confluence.reasons.join(' | ');
    }

    const bbWidthApprox = confluence.indicators.bbSignal === "squeeze" ? 5 : (confluence.indicators.bbSignal === "expansion" ? 20 : 12);
    const volFactor = Math.max(0.5, Math.min(1.5, 15 / Math.max(bbWidthApprox, 1)));
    const sizeMult = confluence.confidence * volFactor;
    const dynamicSize = Math.round(sizeMult * 50);
    return { confluence, correlation, seasonality, finalAdvice: finalAdvice + " Taille suggérée dynamique : $" + dynamicSize.toFixed(0), dynamicSizeUsd: dynamicSize };
  }
}

export const signalEngine = new SignalEngine();