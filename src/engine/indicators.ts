/**
 * Indicateurs techniques calculés à partir de l'historique SQLite.
 * RSI (14), EMA 20/50, Bollinger Bands (20, 2σ), Volume ratio.
 */
import { getDb } from '../database';
import { logger } from '../utils/logger';

export interface IndicatorResult {
  assetId: string;
  timestamp: string;
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  volumeRatio7d: number | null;
  price: number;
}

export interface PricePoint {
  price: number;
  volume: number;
  timestamp: string;
}

/**
 * Calcule la moyenne mobile exponentielle (EMA)
 */
function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];

  const k = 2 / (period + 1);
  const ema: number[] = [];

  // Premier EMA = SMA des premiers 'period' prix
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema.push(sum / period);

  // EMA suivants
  for (let i = period; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[ema.length - 1] * (1 - k));
  }

  return ema;
}

/**
 * Calcule le RSI (Relative Strength Index) sur 14 périodes
 */
function calculateRSI(prices: number[], period: number = 14): number[] {
  if (prices.length < period + 1) return [];

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  const rsi: number[] = [];

  // Premier RSI : moyenne simple des gains/losses sur 'period'
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) {
    rsi.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  // RSI suivants (Wilder's smoothing)
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }

  return rsi;
}

/**
 * Calcule les Bollinger Bands (20 périodes, 2 écarts-types)
 */
function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
  upper: number[];
  middle: number[];
  lower: number[];
  width: number[];
} {
  if (prices.length < period) {
    return { upper: [], middle: [], lower: [], width: [] };
  }

  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  const width: number[] = [];

  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
    const sd = Math.sqrt(variance);

    middle.push(mean);
    upper.push(mean + stdDev * sd);
    lower.push(mean - stdDev * sd);
    width.push((upper[upper.length - 1] - lower[lower.length - 1]) / mean * 100);
  }

  return { upper, middle, lower, width };
}

/**
 * Calcule le ratio volume actuel / volume moyen 7j
 */
function calculateVolumeRatio(volumes: number[], period: number = 7 * 24 * 12): number[] { // 7 jours * 24h * 12 (5min intervals)
  if (volumes.length < period) return [];

  const ratios: number[] = [];

  for (let i = period - 1; i < volumes.length; i++) {
    const slice = volumes.slice(i - period + 1, i + 1);
    const avgVol = slice.reduce((a, b) => a + b, 0) / period;
    const currentVol = volumes[i];
    ratios.push(avgVol > 0 ? currentVol / avgVol : 1);
  }

  return ratios;
}

export class TechnicalIndicators {
  private minDataPoints = 50; // Minimum pour EMA50 + RSI + BB

  /**
   * Calcule tous les indicateurs pour un asset donné
   */
  async calculateForAsset(assetId: string, limit: number = 500): Promise<IndicatorResult | null> {
    const db = getDb();

    // Récupérer l'historique de prix (du plus ancien au plus récent pour les calculs)
    const rows = db.prepare(`
      SELECT price_usd as price, volume_24h as volume, recorded_at as timestamp
      FROM price_snapshots
      WHERE asset_id = ? AND price_usd IS NOT NULL
      ORDER BY recorded_at ASC
      LIMIT ?
    `).all(assetId, limit) as PricePoint[];

    if (rows.length < this.minDataPoints) {
      logger.debug(`Indicateurs: pas assez de données pour ${assetId} (${rows.length}/${this.minDataPoints})`);
      return null;
    }

    const prices = rows.map(r => r.price);
    const volumes = rows.map(r => r.volume ?? 0);
    const timestamps = rows.map(r => r.timestamp);

    // Calculs
    const rsi14 = calculateRSI(prices, 14);
    const ema20 = calculateEMA(prices, 20);
    const ema50 = calculateEMA(prices, 50);
    const { upper: bbUpper, middle: bbMiddle, lower: bbLower, width: bbWidth } = calculateBollingerBands(prices, 20, 2);
    const volumeRatio = calculateVolumeRatio(volumes);

    // Aligner les indices (RSI commence à l'index 14, EMA20 à 19, EMA50 à 49, BB à 19)
    const lastIdx = prices.length - 1;

    const rsiIdx = rsi14.length - 1;
    const ema20Idx = ema20.length - 1;
    const ema50Idx = ema50.length - 1;
    const bbIdx = bbMiddle.length - 1;
    const volIdx = volumeRatio.length - 1;

    const result: IndicatorResult = {
      assetId,
      timestamp: timestamps[lastIdx],
      rsi14: rsiIdx >= 0 ? rsi14[rsiIdx] : null,
      ema20: ema20Idx >= 0 ? ema20[ema20Idx] : null,
      ema50: ema50Idx >= 0 ? ema50[ema50Idx] : null,
      bbUpper: bbIdx >= 0 ? bbUpper[bbIdx] : null,
      bbMiddle: bbIdx >= 0 ? bbMiddle[bbIdx] : null,
      bbLower: bbIdx >= 0 ? bbLower[bbIdx] : null,
      bbWidth: bbIdx >= 0 ? bbWidth[bbIdx] : null,
      volumeRatio7d: volIdx >= 0 ? volumeRatio[volIdx] : null,
      price: prices[lastIdx],
    };

    return result;
  }

  /**
   * Calcule les indicateurs pour tous les assets actifs
   */
  async calculateAll(): Promise<IndicatorResult[]> {
    const db = getDb();
    const assets = db.prepare(`
      SELECT id FROM assets WHERE is_active = 1 AND type = 'crypto'
    `).all() as Array<{ id: string }>;

    const results: IndicatorResult[] = [];

    for (const asset of assets) {
      const indicators = await this.calculateForAsset(asset.id);
      if (indicators) {
        results.push(indicators);
      }
    }

    return results;
  }

  /**
   * Interprétation simple des signaux techniques
   */
  static interpretSignals(indicators: IndicatorResult): {
    rsiSignal: 'oversold' | 'overbought' | 'neutral';
    trendSignal: 'bullish' | 'bearish' | 'neutral';
    bbSignal: 'squeeze' | 'expansion' | 'normal';
    volumeSignal: 'high' | 'low' | 'normal';
  } {
    let rsiSignal: 'oversold' | 'overbought' | 'neutral' = 'neutral';
    let trendSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let bbSignal: 'squeeze' | 'expansion' | 'normal' = 'normal';
    let volumeSignal: 'high' | 'low' | 'normal' = 'normal';

    // RSI
    if (indicators.rsi14 !== null) {
      if (indicators.rsi14 < 30) rsiSignal = 'oversold';
      else if (indicators.rsi14 > 70) rsiSignal = 'overbought';
    }

    // Trend EMA
    if (indicators.ema20 !== null && indicators.ema50 !== null) {
      if (indicators.ema20 > indicators.ema50) trendSignal = 'bullish';
      else if (indicators.ema20 < indicators.ema50) trendSignal = 'bearish';
    }

    // Bollinger Bands
    if (indicators.bbWidth !== null) {
      if (indicators.bbWidth < 5) bbSignal = 'squeeze'; // Bandes très étroites
      else if (indicators.bbWidth > 20) bbSignal = 'expansion'; // Bandes très larges
    }

    // Volume
    if (indicators.volumeRatio7d !== null) {
      if (indicators.volumeRatio7d > 1.5) volumeSignal = 'high';
      else if (indicators.volumeRatio7d < 0.5) volumeSignal = 'low';
    }

    return { rsiSignal, trendSignal, bbSignal, volumeSignal };
  }

  /**
   * Vérifie si le prix touche une bande de Bollinger
   */
  static checkBBTouch(indicators: IndicatorResult): 'upper' | 'lower' | 'none' {
    if (!indicators.bbUpper || !indicators.bbLower) return 'none';

    const price = indicators.price;
    const tolerance = 0.005; // 0.5%

    if (price >= indicators.bbUpper * (1 - tolerance)) return 'upper';
    if (price <= indicators.bbLower * (1 + tolerance)) return 'lower';

    return 'none';
  }
}

// Instance singleton
export const technicalIndicators = new TechnicalIndicators();