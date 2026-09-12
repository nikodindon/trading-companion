/**
 * Notificateur pour trades réels (Discord, Telegram, webhook custom).
 */
import { logger } from '../utils/logger';

export interface NotifierConfig {
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  customWebhookUrl?: string;
  enabled: boolean;
}

const DEFAULT_CONFIG: NotifierConfig = {
  enabled: false,
};

export interface TradeNotification {
  action: 'buy' | 'sell';
  assetSymbol: string;
  quantity: number;
  priceUsd: number;
  totalUsd: number;
  txSignature: string | null;
  dryRun: boolean;
  timestamp: string;
  explorerUrl?: string;
}

export class Notifier {
  private config: NotifierConfig;

  constructor(config?: Partial<NotifierConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config, ...this.loadFromEnv() };
  }

  private loadFromEnv(): Partial<NotifierConfig> {
    return {
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
      customWebhookUrl: process.env.CUSTOM_WEBHOOK_URL,
      enabled: process.env.NOTIFICATIONS_ENABLED === 'true',
    };
  }

  async notifyTrade(notification: TradeNotification): Promise<void> {
    if (!this.config.enabled || notification.dryRun) {
      return; // Ne pas notifier en mode simulation
    }

    const messageLines = [
      `🤖 *Trade Companion — Trade ${notification.dryRun ? 'DRY' : 'REAL'}*`,
      `*Action:* ${notification.action.toUpperCase()}`,
      `*Asset:* ${notification.assetSymbol}`,
      `*Quantité:* ${notification.quantity.toFixed(6)}`,
      `*Prix:* $${notification.priceUsd.toFixed(4)}`,
      `*Total:* $${notification.totalUsd.toFixed(2)}`,
      `*Date:* ${notification.timestamp}`,
    ];

    if (notification.txSignature) {
      const explorerUrl = notification.explorerUrl ??
        `https://solscan.io/tx/${notification.txSignature}`;
      messageLines.push(`*Tx:* ${explorerUrl}`);
    }

    const messageText = messageLines.join('\n');

    // Discord
    if (this.config.discordWebhookUrl) {
      try {
        const axios = (await import('axios')).default;
        await axios.post(this.config.discordWebhookUrl, {
          content: messageText,
          username: 'Trader Companion',
        });
        logger.info('Notification Discord envoyée', { tx: notification.txSignature });
      } catch (err) {
        logger.error('Notification Discord échouée', err);
      }
    }

    // Telegram
    if (this.config.telegramBotToken && this.config.telegramChatId) {
      try {
        const axios = (await import('axios')).default;
        const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;
        await axios.post(url, {
          chat_id: this.config.telegramChatId,
          text: messageText,
          parse_mode: 'Markdown',
        });
        logger.info('Notification Telegram envoyée', { tx: notification.txSignature });
      } catch (err) {
        logger.error('Notification Telegram échouée', err);
      }
    }

    // Webhook custom
    if (this.config.customWebhookUrl) {
      try {
        const axios = (await import('axios')).default;
        await axios.post(this.config.customWebhookUrl, {
          event: 'trade_executed',
          data: notification,
          timestamp: new Date().toISOString(),
        }, {
          headers: { 'Content-Type': 'application/json' },
        });
        logger.info('Notification webhook custom envoyée', { tx: notification.txSignature });
      } catch (err) {
        logger.error('Notification webhook custom échouée', err);
      }
    }
  }

  // Notification pour risque / alertes
  async notifyAlert(severity: 'info' | 'warn' | 'critical', message: string): Promise<void> {
    if (!this.config.enabled) return;

    const text = `🚨 *ALERTE [${severity.toUpperCase()}]*\n${message}`;
    const payload = { content: text, username: 'Trader Companion — Alertes' };

    if (this.config.discordWebhookUrl) {
      try {
        const axios = (await import('axios')).default;
        await axios.post(this.config.discordWebhookUrl, payload);
      } catch (err) {
        logger.error('Notification Discord alert échouée', err);
      }
    }

    if (this.config.telegramBotToken && this.config.telegramChatId) {
      try {
        const axios = (await import('axios')).default;
        const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;
        await axios.post(url, { chat_id: this.config.telegramChatId, text, parse_mode: 'Markdown' });
      } catch (err) {
        logger.error('Notification Telegram alert échouée', err);
      }
    }
  }
}

export const notifier = new Notifier();