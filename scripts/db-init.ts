/**
 * Peuple la base avec les assets par défaut.
 * Modifier la liste selon vos besoins.
 */
import { getDb, closeDb } from '../src/database';

const DEFAULT_ASSETS = [
  { id: 'bitcoin',   symbol: 'BTC',  name: 'Bitcoin',       type: 'crypto',            coingecko_id: 'bitcoin' },
  { id: 'ethereum',  symbol: 'ETH',  name: 'Ethereum',      type: 'crypto',            coingecko_id: 'ethereum' },
  { id: 'solana',    symbol: 'SOL',  name: 'Solana',        type: 'crypto',            coingecko_id: 'solana' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink',     type: 'crypto',            coingecko_id: 'chainlink' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche',  type: 'crypto',            coingecko_id: 'avalanche-2' },
  { id: 'usd-coin',  symbol: 'USDC', name: 'USD Coin',      type: 'stablecoin',        coingecko_id: 'usd-coin',
    mint_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  // Stocks tokénisés (prix via Jupiter on-chain — pas de coingecko_id)
  { id: 'xstock-aapl', symbol: 'xAAPL', name: 'Apple (xStock)', type: 'tokenized_stock',
    mint_address: '' /* À renseigner quand disponible */ },
  { id: 'xstock-tsla', symbol: 'xTSLA', name: 'Tesla (xStock)', type: 'tokenized_stock',
    mint_address: '' },
];

const db = getDb();
const insert = db.prepare(`
  INSERT OR IGNORE INTO assets (id, symbol, name, type, mint_address, coingecko_id)
  VALUES (@id, @symbol, @name, @type, @mint_address, @coingecko_id)
`);

for (const a of DEFAULT_ASSETS) {
  insert.run({ mint_address: null, coingecko_id: null, ...a });
  console.log(`✓ ${a.symbol} — ${a.name}`);
}

closeDb();
console.log('\n✅ Base initialisée avec les assets par défaut.');
