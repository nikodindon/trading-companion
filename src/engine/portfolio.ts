import { getDb } from '../database';

export interface PortfolioSummary {
  totalInvestedUsd: number;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  positions: PositionSummary[];
}

export interface PositionSummary {
  assetId: string;
  symbol: string;
  quantity: number;
  avgBuyPrice: number;
  currentPrice: number;
  currentValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
}

export function getPortfolioSummary(priceMap: Map<string, number>): PortfolioSummary {
  const db = getDb();
  const positions = db.prepare(`
    SELECT p.*, a.symbol FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.status='open'
  `).all() as Array<{
    asset_id: string; symbol: string; quantity: number;
    avg_buy_price: number; total_invested_usd: number;
  }>;

  let totalInvested = 0;
  let currentValue = 0;
  const summaries: PositionSummary[] = [];

  for (const pos of positions) {
    const price = priceMap.get(pos.asset_id) ?? pos.avg_buy_price;
    const val = pos.quantity * price;
    const pnlUsd = val - pos.total_invested_usd;
    const pnlPct = (pnlUsd / pos.total_invested_usd) * 100;

    totalInvested += pos.total_invested_usd;
    currentValue += val;

    summaries.push({
      assetId: pos.asset_id,
      symbol: pos.symbol,
      quantity: pos.quantity,
      avgBuyPrice: pos.avg_buy_price,
      currentPrice: price,
      currentValueUsd: val,
      pnlUsd,
      pnlPct,
    });
  }

  return {
    totalInvestedUsd: totalInvested,
    currentValueUsd: currentValue,
    unrealizedPnlUsd: currentValue - totalInvested,
    unrealizedPnlPct: totalInvested > 0 ? ((currentValue - totalInvested) / totalInvested) * 100 : 0,
    positions: summaries.sort((a, b) => b.pnlPct - a.pnlPct),
  };
}
