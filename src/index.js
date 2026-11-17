import { config } from './config/config.js';
import { logger } from './utils/logger.js';
import { GoogleSheetsRepository } from './repositories/googleSheetsRepository.js';
import { CategoryService } from './services/categoryService.js';
import { ExpenseService } from './services/expenseService.js';
import { BudgetService } from './services/budgetService.js';
import { ReportService } from './services/reportService.js';
import { SchedulerService } from './services/schedulerService.js';
import { CommandRouter } from './commands/commandRouter.js';
import { MessageController } from './controllers/messageController.js';
import { WhatsAppChannel } from './channels/whatsappChannel.js';

async function main() {
  // ---- Wiring (dependency injection manual) ----
  const repository = new GoogleSheetsRepository();
  const categoryService = new CategoryService(repository, {
    ttlMs: config.googleSheets.categoryCacheTtlMs,
  });
  const expenseService = new ExpenseService(repository, categoryService);
  const budgetService = new BudgetService(repository);
  const reportService = new ReportService(repository, budgetService);
  const whatsapp = new WhatsAppChannel();
  const schedulerService = new SchedulerService({
    reportService,
    budgetService,
    sendMessage: (recipient, text) => whatsapp.sendMessage(recipient, text),
    logger,
  });
  const commandRouter = new CommandRouter({
    expenseService,
    reportService,
    budgetService,
    categoryService,
    schedulerService,
  });
  const controller = new MessageController({
    commandRouter,
    expenseService,
    reportService,
    budgetService,
  });

  // ---- Channel: WhatsApp ----
  // Untuk menambah channel baru (Telegram/REST), cukup buat adapter baru
  // yang mengikuti kontrak ChannelAdapter dan panggil controller yang sama.
  await whatsapp.start(async ({ text, senderLabel, senderNumber, reply }) => {
    const responseText = await controller.handleIncomingMessage(text, {
      senderLabel,
      senderNumber,
    });
    await reply(responseText);
  });

  schedulerService.start();

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Menerima sinyal berhenti, menutup koneksi...');
    schedulerService.stop();
    await whatsapp.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('Bot pencatatan keuangan pasangan siap menerima pesan.');
}

main().catch((err) => {
  logger.error(err, 'Gagal menjalankan aplikasi');
  process.exit(1);
});
