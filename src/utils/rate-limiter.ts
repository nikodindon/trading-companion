/**
 * Rate limiter avec backoff exponentiel et file d'attente par domaine.
 * Utilisé pour respecter les limites d'API CoinGecko, CMC, Jupiter.
 */
import { logger } from '../utils/logger';

export interface RateLimitConfig {
  maxRequestsPerWindow: number;
  windowMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface QueuedRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  fn: () => Promise<T>;
  retries: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequestsPerWindow: 30,
  windowMs: 60_000, // 1 minute
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

export class RateLimiter {
  private requests: Map<string, number[]> = new Map(); // domain -> timestamps
  private queues: Map<string, Array<{ resolve: (value: any) => void; reject: (error: Error) => void; fn: () => Promise<any>; retries: number }>> = new Map();
  private processing: Map<string, boolean> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();

  constructor() {
    // Configs par défaut par domaine
    this.setConfig('coingecko', { ...DEFAULT_CONFIG, maxRequestsPerWindow: 30 });
    this.setConfig('coinmarketcap', { ...DEFAULT_CONFIG, maxRequestsPerWindow: 30 });
    this.setConfig('jupiter', { ...DEFAULT_CONFIG, maxRequestsPerWindow: 100 });
  }

  setConfig(domain: string, config: Partial<RateLimitConfig>): void {
    this.configs.set(domain, { ...DEFAULT_CONFIG, ...config });
  }

  private getConfig(domain: string): RateLimitConfig {
    return this.configs.get(domain) ?? DEFAULT_CONFIG;
  }

  private cleanOldRequests(domain: string, now: number): void {
    const config = this.getConfig(domain);
    const timestamps = this.requests.get(domain) ?? [];
    const valid = timestamps.filter(ts => now - ts < config.windowMs);
    this.requests.set(domain, valid);
  }

  private canMakeRequest(domain: string): boolean {
    const now = Date.now();
    this.cleanOldRequests(domain, now);
    const timestamps = this.requests.get(domain) ?? [];
    const config = this.getConfig(domain);
    return timestamps.length < config.maxRequestsPerWindow;
  }

  private recordRequest(domain: string): void {
    const now = Date.now();
    const timestamps = this.requests.get(domain) ?? [];
    timestamps.push(now);
    this.requests.set(domain, timestamps);
  }

  private async waitForSlot(domain: string): Promise<void> {
    const config = this.getConfig(domain);
    while (!this.canMakeRequest(domain)) {
      const timestamps = this.requests.get(domain) ?? [];
      const oldest = timestamps[0];
      const waitMs = Math.max(0, config.windowMs - (Date.now() - oldest)) + 100;
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  private calculateBackoff(retries: number, config: RateLimitConfig): number {
    const delay = Math.min(
      config.baseDelayMs * Math.pow(2, retries) + Math.random() * 1000,
      config.maxDelayMs
    );
    return delay;
  }

  async execute<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    const config = this.getConfig(domain);

    // Si pas de contention, exécuter directement
    if (this.canMakeRequest(domain) && (this.queues.get(domain)?.length ?? 0) === 0) {
      await this.waitForSlot(domain);
      this.recordRequest(domain);
      try {
        return await fn();
      } catch (err) {
        throw err;
      }
    }

    // Sinon, mettre en file d'attente
    return new Promise<T>((resolve, reject) => {
      const queue = this.queues.get(domain) ?? [];
      queue.push({ resolve, reject, fn, retries: 0 });
      this.queues.set(domain, queue);
      this.processQueue(domain);
    });
  }

  private async processQueue(domain: string): Promise<void> {
    if (this.processing.get(domain)) return;
    this.processing.set(domain, true);

    const queue = this.queues.get(domain) ?? [];
    const config = this.getConfig(domain);

    while (queue.length > 0) {
      await this.waitForSlot(domain);

      const item = queue.shift()!;
      this.recordRequest(domain);

      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (err) {
        if (item.retries < config.maxRetries) {
          item.retries++;
          const delay = this.calculateBackoff(item.retries, config);
          logger.warn(`Rate limit retry ${item.retries}/${config.maxRetries} for ${domain} after ${delay}ms`, { error: err });
          await new Promise(r => setTimeout(r, delay));
          queue.unshift(item); // Remettre au début
        } else {
          logger.error(`Rate limit max retries exceeded for ${domain}`, { error: err });
          item.reject(err as Error);
        }
      }
    }

    this.processing.set(domain, false);
  }

  getStats(domain: string): { pending: number; recentRequests: number; windowMs: number } {
    const now = Date.now();
    this.cleanOldRequests(domain, now);
    return {
      pending: this.queues.get(domain)?.length ?? 0,
      recentRequests: (this.requests.get(domain) ?? []).length,
      windowMs: this.getConfig(domain).windowMs,
    };
  }
}

// Instance singleton
export const rateLimiter = new RateLimiter();