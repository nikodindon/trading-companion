import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

const BASE_URL = 'https://api.coingecko.com/api/v3';
const BASE_URL_PRO = 'https://pro-api.coingecko.com/api/v3';

export interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_1h_in_currency: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency: number;
  market_cap_rank: number;
  circulating_supply: number;
  ath: number;
  ath_change_percentage: number;
}

export interface MarketSummary {
  total_market_cap: number;
  total_volume: number;
  btc_dominance: number;
  market_cap_change_24h: number;
  fear_greed_index?: number;
}

export class CoinGeckoClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    const apiKey = config.apis.coingeckoKey;
    if (apiKey) {
      this.baseUrl = BASE_URL_PRO;
      this.headers = { 'x-cg-pro-api-key': apiKey };
    } else {
      this.baseUrl = BASE_URL;
      this.headers = {};
    }
  }

  async getMarketData(coinIds: string[]): Promise<CoinGeckoMarketData[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/coins/markets`, {
        headers: this.headers,
        params: {
          vs_currency: 'usd',
          ids: coinIds.join(','),
          order: 'market_cap_desc',
          per_page: 250,
          page: 1,
          sparkline: false,
          price_change_percentage: '1h,24h,7d',
        },
      });
      return response.data as CoinGeckoMarketData[];
    } catch (err) {
      logger.error('CoinGecko getMarketData error', err);
      throw err;
    }
  }

  async getGlobalMarket(): Promise<MarketSummary> {
    try {
      const response = await axios.get(`${this.baseUrl}/global`, { headers: this.headers });
      const d = response.data.data;
      return {
        total_market_cap: d.total_market_cap?.usd ?? 0,
        total_volume: d.total_volume?.usd ?? 0,
        btc_dominance: d.market_cap_percentage?.btc ?? 0,
        market_cap_change_24h: d.market_cap_change_percentage_24h_usd ?? 0,
      };
    } catch (err) {
      logger.error('CoinGecko getGlobalMarket error', err);
      throw err;
    }
  }

  async getTrendingCoins(): Promise<Array<{ id: string; symbol: string; name: string; rank: number }>> {
    try {
      const response = await axios.get(`${this.baseUrl}/search/trending`, { headers: this.headers });
      return response.data.coins.map((c: { item: { id: string; symbol: string; name: string; market_cap_rank: number } }) => ({
        id: c.item.id,
        symbol: c.item.symbol,
        name: c.item.name,
        rank: c.item.market_cap_rank,
      }));
    } catch (err) {
      logger.error('CoinGecko getTrendingCoins error', err);
      return [];
    }
  }
}
