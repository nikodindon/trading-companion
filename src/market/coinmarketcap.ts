import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

const BASE_URL = 'https://pro-api.coinmarketcap.com/v1';

export interface CMCQuote {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  cmc_rank: number;
  quote: {
    USD: {
      price: number;
      volume_24h: number;
      percent_change_1h: number;
      percent_change_24h: number;
      percent_change_7d: number;
      market_cap: number;
      last_updated: string;
    };
  };
}

export class CoinMarketCapClient {
  private apiKey: string;

  constructor() {
    this.apiKey = config.apis.coinmarketcapKey ?? '';
    if (!this.apiKey) logger.warn('CMC API key not configured');
  }

  async getLatestQuotes(slugs: string[]): Promise<CMCQuote[]> {
    if (!this.apiKey) throw new Error('CMC API key required');
    try {
      const response = await axios.get(`${BASE_URL}/cryptocurrency/quotes/latest`, {
        headers: { 'X-CMC_PRO_API_KEY': this.apiKey },
        params: { slug: slugs.join(','), convert: 'USD' },
      });
      return Object.values(response.data.data) as CMCQuote[];
    } catch (err) {
      logger.error('CMC getLatestQuotes error', err);
      throw err;
    }
  }

  async getFearGreedIndex(): Promise<number | null> {
    // CMC Pro fournit le Fear & Greed via /fear-and-greed/latest
    if (!this.apiKey) return null;
    try {
      const response = await axios.get(`${BASE_URL}/fear-and-greed/latest`, {
        headers: { 'X-CMC_PRO_API_KEY': this.apiKey },
      });
      return response.data.data?.value ?? null;
    } catch {
      return null;
    }
  }
}
