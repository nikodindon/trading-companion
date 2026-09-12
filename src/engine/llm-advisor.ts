/**
 * Intégration LLM optionnelle : analyse du contexte marché + positions.
 * Utilisable avec un modèle local (Ollama) ou via API externe.
 */
import { getDb } from '../database';
import { logger } from '../utils/logger';

export interface LLMContext {
  marketSummary: string;
  portfolioSummary: string;
  recommendations: string;
  riskStatus: string;
  recentEvents: string;
  timestamp: string;
}

export interface LLMAnalysis {
  summary: string; // Analyse en langage naturel
  suggestions: string[]; // Suggestions structurées
  riskAssessment: 'low' | 'medium' | 'high';
  confidenceScore: number; // 0-1 basé sur cohérence des données
  generatedAt: string;
}

export class LLMAdvisor {
  private provider: 'ollama' | 'api';
  private baseUrl: string;
  private modelName: string;

  constructor(options?: { provider?: 'ollama' | 'api'; baseUrl?: string; model?: string }) {
    this.provider = options?.provider ?? (process.env.LLM_PROVIDER as 'ollama' | 'api') ?? 'api';
    this.baseUrl = options?.baseUrl ?? process.env.LLM_BASE_URL ?? 'http://localhost:11434';
    this.modelName = options?.model ?? process.env.LLM_MODEL ?? 'llama3';
  }

  /**
   * Construit le contexte à envoyer au LLM.
   */
  async buildContext(): Promise<LLMContext> {
    const db = getDb();

    // Résumé marché : prix des 3 principaux assets suivis
    const assets = db.prepare(`SELECT id, symbol, name FROM assets WHERE is_active = 1 LIMIT 5`).all() as Array<{ id: string; symbol: string; name: string }>;
    const marketSummary = assets.map(a => `${a.symbol}: en cours d'analyse`).join(', ');

    // Portfolio : positions ouvertes
    const positions = db.prepare(`SELECT p.*, a.symbol FROM positions p JOIN assets a ON a.id = p.asset_id WHERE p.status = 'open'`).all() as Array<any>;
    const portfolioSummary = positions.length > 0
      ? positions.map(p => `- ${p.symbol}: qty ${p.quantity}, entry $${p.avg_buy_price}`).join('\n')
      : 'Aucune position ouverte.';

    // Recommandations récentes
    const recs = db.prepare(`SELECT r.*, a.symbol FROM recommendations r JOIN assets a ON a.id = r.asset_id ORDER BY r.generated_at DESC LIMIT 5`).all() as Array<any>;
    const recommendations = recs.map(r => `- ${r.symbol}: ${r.action.toUpperCase()} (conf: ${(r.confidence * 100).toFixed(0)}%) — ${r.reason}`).join('\n');

    // Alertes récentes
    const events = db.prepare(`SELECT * FROM events WHERE created_at >= datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 5`).all() as Array<any>;
    const riskStatus = events.length > 0 ? events.map(e => `${e.severity.toUpperCase()}: ${e.message}`).join('\n') : 'Aucune alerte récente.';

    const recentEvents = events.map(e => `- [${e.severity.toUpperCase()}] ${e.message} (${e.created_at.slice(0, 16)})`).join('\n');

    return {
      marketSummary,
      portfolioSummary,
      recommendations: recommendations || 'Aucune recommandation récente.',
      riskStatus,
      recentEvents: recentEvents || 'Aucun événement ces 7 derniers jours.',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Génère une analyse en langage naturel basée sur le contexte.
   * Note : cette version fournit une analyse structurée prête pour un LLM.
   * En production, elle serait envoyée à un endpoint LLM (Ollama / OpenRouter / OpenAI).
   */
  async generateAnalysis(): Promise<LLMAnalysis> {
    try {
      const context = await this.buildContext();

      // Pour la Phase 4, on fournit une analyse structurée basée sur le contexte,
      // prête à être enrichie par un LLM externe.
      const summary = "Analyse du marché au " + new Date(context.timestamp).toLocaleString("fr-FR") + ". Portfolio : " + (context.portfolioSummary.includes("Aucune") ? "vide" : "actif") + ". Recommandations récentes disponibles. Alertes : " + (context.riskStatus.includes("Aucune") ? "aucune" : "présentes") + ".";

      const suggestions: string[] = [];
      if (context.portfolioSummary.includes('Aucune')) {
        suggestions.push('Aucune position ouverte — considérer une analyse des signaux techniques avant tout achat.');
      }
      if (context.recommendations.includes('BUY') || context.recommendations.includes('WATCH')) {
        suggestions.push('Signaux positifs détectés - vérifier la corrélation BTC avant d\'ouvrir une position.');
      }
      if (!context.riskStatus.includes('Aucune')) {
        suggestions.push('Alertes actives détectées - vérifier le statut des risques avant d\'exécuter un trade.');
      }

      // Déterminer le score de confiance basé sur la cohérence du contexte
      const confidenceScore = Math.min(0.9, Math.max(0.3, 0.5 + (suggestions.length * 0.05)));

      logger.info('LLM Advisor : analyse générée', {
        provider: this.provider,
        model: this.modelName,
        suggestionsCount: suggestions.length,
        confidenceScore,
      });

      return {
        summary,
        suggestions,
        riskAssessment: suggestions.length > 2 ? 'high' : (suggestions.length > 0 ? 'medium' : 'low'),
        confidenceScore,
        generatedAt: context.timestamp,
      };
    } catch (err) {
      logger.error('LLM Advisor error', err);
      return {
        summary: "Erreur lors de la generation de l\'analyse LLM.",
        suggestions: ['Vérifier la connexion au service LLM et réessayer.'],
        riskAssessment: 'high',
        confidenceScore: 0,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Envoie le contexte à un endpoint LLM et retourne une analyse enrichie.
   * Cette méthode est prête pour être branchée sur un endpoint externe (Ollama, OpenRouter, etc.).
   */
  async queryLLM(prompt: string): Promise<string | null> {
    if (this.provider === 'ollama') {
      try {
        const axios = (await import('axios')).default;
        const response = await axios.post(`${this.baseUrl}/api/generate`, {
          model: this.modelName,
          prompt,
          stream: false,
        }, { timeout: 30000 });
        return response.data?.response ?? null;
      } catch (err) {
        logger.error('LLM Advisor : erreur de requête Ollama', err);
        return null;
      }
    } else {
      logger.info('LLM Advisor : requête API non implémentée (utiliser provider ollama)', { baseUrl: this.baseUrl });
      return null;
    }
  }
}

export const llmAdvisor = new LLMAdvisor();
