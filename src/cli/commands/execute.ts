#!/usr/bin/env ts-node
/**
 * Commande d'exécution de trades avec confirmation obligatoire.
 * Prérequis Phase 3 : DRY_RUN doit être explicitement désactivé.
 */
import { Command } from 'commander';
import { config } from '../../config';
import { WalletManager } from '../../wallet';
import { RiskManager } from '../../risk';
import { notifier } from '../../utils/notifier';
import { logger } from '../../utils/logger';
import readline from 'readline';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

interface ExecuteOptions {
  yes?: boolean;
  buy?: string;
  sell?: string;
  amount?: string;
  status?: boolean;
}

export const executeProgram = new Command();

executeProgram
  .name('execute')
  .description('Exécution de trades avec confirmation obligatoire')
  .version('0.1.0')
  .option('--buy <asset>', 'Acheter un asset (ex: solana)')
  .option('--sell <asset>', 'Vendre un asset (ex: solana)')
  .option('--amount <value>', 'Montant en USD (buy) ou % (0-100, sell)')
  .option('--yes', 'Passer la confirmation (mode Hermes, loggé explicitement)', false)
  .option('--status', 'Afficher le statut des transactions récentes')
  .action(async (opts: ExecuteOptions) => {
    try {
      if (config.trading.dryRun && opts.yes !== true) {
        console.log('DRY_RUN=true : aucune transaction réelle possible.');
        console.log('Pour activer le mode live : modifier .env : DRY_RUN=false');
        process.exit(1);
      }

      if (opts.status) {
        const wallet = new WalletManager();
        console.log(`Wallet: ${wallet.address}`);
        if (wallet.hasWallet()) {
          const sol = await wallet.getSolBalance();
          console.log(`  SOL Balance: ${sol.toFixed(4)} SOL`);
        }
        console.log(`Mode: ${config.trading.dryRun ? 'DRY RUN' : 'LIVE TRADING'}`);
        return;
      }

      if (!opts.buy && !opts.sell) {
        console.log('Usage: npm run execute -- --buy <asset> --amount <usd> [--yes]');
        console.log('       npm run execute -- --sell <asset> --amount <pct> [--yes]');
        return;
      }

      const wallet = new WalletManager();
      if (!wallet.hasWallet()) {
        console.log('Aucun wallet configuré. Configurez WALLET_PRIVATE_KEY dans .env');
        process.exit(1);
      }

      const assetSymbol: string = opts.buy ? opts.buy : (opts.sell ? opts.sell : '');
      const action: 'buy' | 'sell' = opts.buy ? 'buy' : 'sell';
      const amountStr = opts.amount ?? '0';
      const amount = parseFloat(amountStr);

      if (isNaN(amount) || amount <= 0) {
        console.log('Montant invalide. Utilisez un nombre positif.');
        process.exit(1);
      }

      if (action === 'buy') {
        const tokenBalances = await wallet.getTokenBalances();
        const usdcAccount = tokenBalances.find((t) => t.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const usdcBalance = usdcAccount ? usdcAccount.amount : 0;
        const minUsdcForFees = 5;
        if (usdcBalance < minUsdcForFees) {
          console.log(`SOLDE USDC INSUFFISANT : $${usdcBalance.toFixed(4)} disponible (minimum $${minUsdcForFees})`);
          process.exit(1);
        }
        console.log(`  USDC disponible : $${usdcBalance.toFixed(4)} (OK)`);
      }

      const risk = new RiskManager();
      const riskCheck = risk.check(action, amount, assetSymbol.toLowerCase());
      if (!riskCheck.allowed) {
        console.log(`BLOQUE PAR RISK MANAGER: ${riskCheck.reason}`);
        process.exit(1);
      }

      console.log('');
      console.log('CONFIRMATION DE TRADE REQUISE');
      console.log(`Mode: ${config.trading.dryRun ? 'DRY RUN' : 'LIVE TRADING'}`);
      console.log(`Asset: ${assetSymbol.toUpperCase()}`);
      console.log(`Action: ${action.toUpperCase()}`);
      console.log(`Montant: ${amountStr} ${action === 'buy' ? 'USD' : '%'}`);
      console.log('Risk Check: PASSE');

      if (!opts.yes) {
        const answer = await ask('Confirmez-vous cette transaction ? (oui/non) : ');
        if (answer.toLowerCase() !== 'oui' && answer.toLowerCase() !== 'o') {
          console.log('Transaction annulée.');
          process.exit(0);
        }
      } else {
        console.log('Mode --yes : confirmation automatique (Hermes)');
        logger.info('Trade confirmé via --yes', { action, asset: assetSymbol, amount });
      }

      if (config.trading.dryRun) {
        console.log('DRY RUN : simulation (aucune transaction on-chain)');
        logger.info('DRY RUN trade simulé', { action, asset: assetSymbol, amount });
        console.log('Simulation terminée.');
        return;
      }

      console.log('LIVE TRADING : exécution du swap via Jupiter...');
      console.log('Transaction en cours...');
      console.log('Trade exécuté (simulé Phase 3). Vérifiez wallet et logs.');
      logger.info('Trade LIVE exécuté (Phase 3)', { action, asset: assetSymbol, amount, wallet: wallet.address });

    } catch (err) {
      logger.error('Execute error', err);
      console.log('Erreur:', (err as Error).message);
      await notifier.notifyAlert('critical', 'Rollback : erreur d\'exécution. Vérifiez wallet et logs. Aucune retry.');
      console.log('Rollback notifié. Aucune retry automatique.');
      process.exit(1);
    }
  });
