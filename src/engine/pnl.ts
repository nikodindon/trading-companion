/**
 * Calcul de PnL réalisé (FIFO) et non-réalisé à partir de l'historique des trades.
 * Gère les positions partielles correctement.
 */
import { getDb } from '../database';
import { logger } from '../utils/logger';

export interface TradeRecord {
  id: number;
  assetId: string;
  side: 'buy' | 'sell';
  quantity: number;
  priceUsd: number;
  totalUsd: number;
  feesUsd: number;
  executedAt: string;
  dryRun: number;
  symbol?: string; // Optionnel, ajouté via JOIN
}

export interface PositionLot {
  quantity: number;
  buyPrice: number;
  feesUsd: number;
  buyDate: string;
  tradeId: number;
}

export interface RealizedPnlResult {
  assetId: string;
  symbol: string;
  realizedPnlUsd: number;
  realizedPnlPct: number;
  totalFeesUsd: number;
  tradesCount: number;
  winningTrades: number;
  losingTrades: number;
  avgWinUsd: number;
  avgLossUsd: number;
  winRate: number;
}

export interface UnrealizedPnlResult {
  assetId: string;
  symbol: string;
  quantity: number;
  avgBuyPrice: number;
  currentPrice: number;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  lots: PositionLot[];
}

export interface PortfolioPnlSummary {
  totalRealizedPnlUsd: number;
  totalRealizedPnlPct: number;
  totalUnrealizedPnlUsd: number;
  totalUnrealizedPnlPct: number;
  totalFeesUsd: number;
  totalInvestedUsd: number;
  currentValueUsd: number;
  assets: Array<RealizedPnlResult & UnrealizedPnlResult>;
}

/**
 * Calcule le PnL réalisé (FIFO) pour un asset donné.
 * Retourne aussi les lots restants (position ouverte) pour le PnL non-réalisé.
 */
export function calculateRealizedPnlFifo(
  assetId: string,
  currentPrice: number
): { realized: RealizedPnlResult; unrealized: UnrealizedPnlResult | null } {
  const db = getDb();

  // Récupérer tous les trades (buy/sell) pour cet asset, ordre chronologique
  const trades = db.prepare(`
    SELECT t.*, a.symbol
    FROM trades t
    JOIN assets a ON a.id = t.asset_id
    WHERE t.asset_id = ? AND t.dry_run = 0
    ORDER BY t.executed_at ASC
  `).all(assetId) as TradeRecord[];

  if (trades.length === 0) {
    return {
      realized: {
        assetId,
        symbol: '',
        realizedPnlUsd: 0,
        realizedPnlPct: 0,
        totalFeesUsd: 0,
        tradesCount: 0,
        winningTrades: 0,
        losingTrades: 0,
        avgWinUsd: 0,
        avgLossUsd: 0,
        winRate: 0,
      },
      unrealized: null,
    };
  }

  const symbol = trades[0].symbol;
  const lots: PositionLot[] = []; // File FIFO des lots d'achat
  let totalRealizedPnl = 0;
  let totalFees = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let sumWins = 0;
  let sumLosses = 0;
  let closedTradesCount = 0;

  for (const trade of trades) {
    totalFees += trade.feesUsd;

    if (trade.side === 'buy') {
      // Ajouter à la file FIFO
      lots.push({
        quantity: trade.quantity,
        buyPrice: trade.priceUsd,
        feesUsd: trade.feesUsd,
        buyDate: trade.executedAt,
        tradeId: trade.id,
      });
    } else if (trade.side === 'sell') {
      // Vendre depuis la file FIFO (premiers achetés = premiers vendus)
      let remainingToSell = trade.quantity;
      const sellPrice = trade.priceUsd;

      while (remainingToSell > 0 && lots.length > 0) {
        const lot = lots[0];
        const qtyToClose = Math.min(remainingToSell, lot.quantity);

        // PnL sur ce lot partiel
        const costBasis = qtyToClose * lot.buyPrice;
        const proceeds = qtyToClose * sellPrice;
        const pnl = proceeds - costBasis;

        totalRealizedPnl += pnl;
        closedTradesCount++;

        if (pnl > 0) {
          winningTrades++;
          sumWins += pnl;
        } else if (pnl < 0) {
          losingTrades++;
          sumLosses += Math.abs(pnl);
        }

        // Mettre à jour le lot
        lot.quantity -= qtyToClose;
        remainingToSell -= qtyToClose;

        // Si lot épuisé, le retirer
        if (lot.quantity <= 0.000001) {
          lots.shift();
        }
      }

      // Si on a vendu plus qu'on avait (erreur data), logger
      if (remainingToSell > 0.000001) {
        logger.warn(`PnL FIFO: sell exceeds holdings for ${assetId}`, {
          remainingToSell,
          tradeId: trade.id,
        });
      }
    }
  }

  // Calculer PnL non-réalisé sur les lots restants
  let unrealized: UnrealizedPnlResult | null = null;
  if (lots.length > 0) {
    const totalQty = lots.reduce((sum, l) => sum + l.quantity, 0);
    const weightedBuyPrice =
      lots.reduce((sum, l) => sum + l.quantity * l.buyPrice, 0) / totalQty;
    const currentValue = totalQty * currentPrice;
    const investedValue = lots.reduce((sum, l) => sum + l.quantity * l.buyPrice, 0);
    const unrealizedPnl = currentValue - investedValue;

    unrealized = {
      assetId,
      symbol: symbol ?? assetId,
      quantity: totalQty,
      avgBuyPrice: weightedBuyPrice,
      currentPrice,
      currentValueUsd: currentValue,
      unrealizedPnlUsd: unrealizedPnl,
      unrealizedPnlPct: investedValue > 0 ? (unrealizedPnl / investedValue) * 100 : 0,
      lots: [...lots], // Copy pour ne pas muter l'original
    };
  }

  const investedTotal = trades
    .filter(t => t.side === 'buy')
    .reduce((sum, t) => sum + t.totalUsd, 0);

  return {
    realized: {
      assetId,
      symbol: symbol ?? assetId,
      realizedPnlUsd: totalRealizedPnl,
      realizedPnlPct: investedTotal > 0 ? (totalRealizedPnl / investedTotal) * 100 : 0,
      totalFeesUsd: totalFees,
      tradesCount: closedTradesCount,
      winningTrades,
      losingTrades,
      avgWinUsd: winningTrades > 0 ? sumWins / winningTrades : 0,
      avgLossUsd: losingTrades > 0 ? sumLosses / losingTrades : 0,
      winRate: closedTradesCount > 0 ? (winningTrades / closedTradesCount) * 100 : 0,
    },
    unrealized,
  };
}

/**
 * Calcule le PnL complet du portfolio (réalisé + non-réalisé) pour tous les assets.
 */
export function calculatePortfolioPnl(
  priceMap: Map<string, number>
): PortfolioPnlSummary {
  const db = getDb();

  // Récupérer tous les assets qui ont des trades
  const assetsWithTrades = db.prepare(`
    SELECT DISTINCT t.asset_id, a.symbol
    FROM trades t
    JOIN assets a ON a.id = t.asset_id
    WHERE t.dry_run = 0
  `).all() as Array<{ asset_id: string; symbol: string }>;

  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let totalFees = 0;
  let totalInvested = 0;
  let currentValue = 0;
  const assets: Array<RealizedPnlResult & UnrealizedPnlResult> = [];

  for (const { asset_id, symbol } of assetsWithTrades) {
    const currentPrice = priceMap.get(asset_id) ?? 0;
    const { realized, unrealized } = calculateRealizedPnlFifo(asset_id, currentPrice);

    totalRealizedPnl += realized.realizedPnlUsd;
    totalFees += realized.totalFeesUsd;

    if (unrealized) {
      totalUnrealizedPnl += unrealized.unrealizedPnlUsd;
      totalInvested += unrealized.quantity * unrealized.avgBuyPrice;
      currentValue += unrealized.currentValueUsd;

      assets.push({
        ...realized,
        ...unrealized,
      });
    } else {
      // Position fermée complètement
      const invested = realized.realizedPnlUsd / (realized.realizedPnlPct / 100 || 1);
      totalInvested += invested;
    }
  }

  // Ajouter aussi les assets avec positions ouvertes mais pas de trades réalisés
  const openPositions = db.prepare(`
    SELECT p.asset_id, a.symbol, p.quantity, p.avg_buy_price, p.total_invested_usd
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

  for (const pos of openPositions) {
    // Vérifier si déjà traité
    if (assets.find(a => a.assetId === pos.asset_id)) continue;

    const currentPrice = priceMap.get(pos.asset_id) ?? pos.avg_buy_price;
    const currentValueUsd = pos.quantity * currentPrice;
    const unrealizedPnl = currentValueUsd - pos.total_invested_usd;

    totalUnrealizedPnl += unrealizedPnl;
    totalInvested += pos.total_invested_usd;
    currentValue += currentValueUsd;

    assets.push({
      assetId: pos.asset_id,
      symbol: pos.symbol,
      realizedPnlUsd: 0,
      realizedPnlPct: 0,
      totalFeesUsd: 0,
      tradesCount: 0,
      winningTrades: 0,
      losingTrades: 0,
      avgWinUsd: 0,
      avgLossUsd: 0,
      winRate: 0,
      quantity: pos.quantity,
      avgBuyPrice: pos.avg_buy_price,
      currentPrice,
      currentValueUsd,
      unrealizedPnlUsd: unrealizedPnl,
      unrealizedPnlPct: pos.total_invested_usd > 0 ? (unrealizedPnl / pos.total_invested_usd) * 100 : 0,
      lots: [],
    });
  }

  return {
    totalRealizedPnlUsd: totalRealizedPnl,
    totalRealizedPnlPct: totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0,
    totalUnrealizedPnlUsd: totalUnrealizedPnl,
    totalUnrealizedPnlPct: totalInvested > 0 ? (totalUnrealizedPnl / totalInvested) * 100 : 0,
    totalFeesUsd: totalFees,
    totalInvestedUsd: totalInvested,
    currentValueUsd: currentValue,
    assets: assets.sort((a, b) => b.unrealizedPnlPct - a.unrealizedPnlPct),
  };
}

/**
 * Calcule le PnL d'une session (depuis le dernier démarrage Hermes).
 */
export function calculateSessionPnl(sessionId: number): {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  tradesCount: number;
} {
  const db = getDb();

  const session = db.prepare(`SELECT started_at FROM sessions WHERE id = ?`).get(sessionId) as
    | { started_at: string }
    | undefined;

  if (!session) return { realizedPnlUsd: 0, unrealizedPnlUsd: 0, tradesCount: 0 };

  const trades = db.prepare(`
    SELECT side, total_usd, fees_usd
    FROM trades
    WHERE dry_run = 0 AND executed_at >= ?
  `).all(session.started_at) as Array<{ side: string; total_usd: number; fees_usd: number }>;

  let realizedPnl = 0;
  for (const t of trades) {
    if (t.side === 'sell') realizedPnl += t.total_usd;
    else realizedPnl -= t.total_usd;
  }

  return {
    realizedPnlUsd: realizedPnl,
    unrealizedPnlUsd: 0, // Nécessiterait prix actuels
    tradesCount: trades.length,
  };
}

/**
 * Met à jour la table sessions avec le PnL de la session.
 */
export function updateSessionPnl(sessionId: number, priceMap: Map<string, number>): void {
  const db = getDb();
  const pnl = calculatePortfolioPnl(priceMap);

  db.prepare(`
    UPDATE sessions
    SET portfolio_value_usd = ?, pnl_session_usd = ?, ended_at = datetime('now')
    WHERE id = ?
  `).run(pnl.currentValueUsd, pnl.totalRealizedPnlUsd + pnl.totalUnrealizedPnlUsd, sessionId);
}