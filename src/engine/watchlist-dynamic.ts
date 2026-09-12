/**
 * Watchlist dynamique : ajoute automatiquement des assets si trending + volume fort.
 */
import { CoinGeckoClient } from '../market/coingecko';
import { getDb } from '../database';
import { logger } from '../utils/logger';

export interface TrendingAsset {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number;
  score: number; // Combinaison de volume et tendance
}

export class DynamicWatchlist {
  private cgClient: CoinGeckoClient;

  constructor() {
    this.cgClient = new CoinGeckoClient();
  }

  /**
   * Analyse les coins trending et propose des ajouts à la watchlist.
   */
  async analyzeTrending(): Promise<TrendingAsset[]> {
    const trending = await this.cgClient.getTrendingCoins();
    const db = getDb();

    // Récupérer les assets déjà suivis
    const trackedIds = db.prepare(`SELECT id FROM assets WHERE is_active = 1`).all() as Array<{ id: string }>;
    const trackedSet = new Set(trackedIds.map(t => t.id));

    // Filtrer ceux qui ne sont pas déjà suivis
    const newTrending: TrendingAsset[] = [];
    for (const t of trending) {
      if (!trackedSet.has(t.id) && t.rank <= 7) {
        // Score simple : plus le rang est bas (1 = meilleur), plus le score est élevé
        const score = (8 - t.rank) * 0.15; // 0.15 à 1.05
        newTrending.push({
          id: t.id,
          symbol: t.symbol,
          name: t.name,
          marketCapRank: t.rank,
          score: Math.min(score, 1.0),
        });
      }
    }

    logger.info('Dynamic watchlist : analyse terminée', {
      trendingCount: trending.length,
      newAssets: newTrending.length,
      topNewAssets: newTrending.map(a => `${a.symbol} (${a.score.toFixed(2)})`).join(', '),
    });

    return newTrending.sort((a, b) => b.score - a.score);
  }

  /**
   * Propose d'ajouter automatiquement un asset si son score est élevé.
   */
  async proposeAdditions(minScore: number = 0.8): Promise<TrendingAsset[]> {
    const trending = await this.analyzeTrending();
    const candidates = trending.filter(t => t.score >= minScore);

    if (candidates.length > 0) {
      logger.info('Dynamic watchlist : candidats détectés', {
        candidates: candidates.map(c => `${c.symbol}:${c.name} (score: ${c.score.toFixed(2)})`).join(', '),
      });
    }

    return candidates;
  }
}

export const dynamicWatchlist = new DynamicWatchlist();
