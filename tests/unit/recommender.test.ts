import { Recommender } from '../../src/engine/recommender';

// Mock DB pour ne pas dépendre de SQLite en test unitaire
jest.mock('../../src/database', () => ({
  getDb: () => ({
    prepare: () => ({ run: jest.fn() }),
  }),
}));

describe('Recommender', () => {
  const rec = new Recommender();

  const baseSnapshot = {
    assetId: 'solana',
    symbol: 'SOL',
    priceUsd: 100,
    change1h: 0,
    change24h: 0,
    change7d: 0,
    volume24h: 1_000_000_000,
    marketCap: 40_000_000_000,
  };

  it('recommande BUY sur momentum positif fort', () => {
    const r = rec.analyze({ ...baseSnapshot, change1h: 2, change24h: 5, change7d: 10 }, null);
    expect(r.action).toBe('buy');
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it('recommande SELL sur stop-loss -10%', () => {
    const pos = { assetId: 'solana', quantity: 1, avgBuyPrice: 111.11, totalInvestedUsd: 111.11 };
    const r = rec.analyze({ ...baseSnapshot, priceUsd: 99 }, pos); // PnL ≈ -10.9%
    expect(r.action).toBe('sell');
  });

  it('recommande SELL sur target +20%', () => {
    const pos = { assetId: 'solana', quantity: 1, avgBuyPrice: 80, totalInvestedUsd: 80 };
    const r = rec.analyze({ ...baseSnapshot, priceUsd: 100 }, pos);
    expect(r.action).toBe('sell');
    expect(r.reason).toContain('+20%');
  });

  it('recommande WATCH sans signal fort', () => {
    const r = rec.analyze({ ...baseSnapshot, change24h: -1 }, null);
    expect(['watch', 'hold']).toContain(r.action);
  });
});
