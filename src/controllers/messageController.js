import { randomUUID } from 'crypto';
import { stepLogger } from '../utils/logger.js';
import { parseMessage } from '../parser/parser.js';
import { formatRupiah } from '../utils/formatCurrency.js';
import { config } from '../config/config.js';

/**
 * Controller ini TIDAK tahu channel apa yang mengirim pesan
 * (WhatsApp, Telegram, REST API, dst) — ia hanya menerima teks pesan
 * dan mengembalikan teks balasan. Ini yang membuat business logic
 * bisa dipakai ulang lintas channel.
 *
 * Controller juga tidak menyimpan data apapun — hanya meneruskan ke service.
 */
export class MessageController {
  constructor({ commandRouter, expenseService, reportService = null, budgetService = null }) {
    this.commandRouter = commandRouter;
    this.expenseService = expenseService;
    this.reportService = reportService;
    this.budgetService = budgetService;
  }

  async handleIncomingMessage(rawText, { senderLabel, senderNumber } = {}) {
    const traceId = randomUUID().slice(0, 8);
    const log = stepLogger(traceId);

    const senderRole = this.budgetService
      ? await this.budgetService.resolveSenderRole(senderNumber, senderLabel)
      : senderLabel || senderNumber || '';

    log.step('incoming.message', { text: rawText, senderLabel, senderNumber, senderRole });

    try {
      if (this.commandRouter.isCommand(rawText)) {
        const reply = await this.commandRouter.handle(rawText, log, {
          sender: senderRole,
          senderLabel,
          senderNumber,
        });
        log.step('reply.sent');
        return reply;
      }

      // Dukung input satu baris maupun banyak baris sekaligus (batch input)
      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const savedTransactions = [];

      for (const line of lines) {
        const parsed = await parseMessage(line, log);
        if (!parsed.ok) continue;

        parsed.data.sender = senderRole;
        if (config.whatsapp.tagSenderInNote && senderRole) {
          const tag = `via ${senderRole}`;
          parsed.data.note = parsed.data.note ? `${parsed.data.note} (${tag})` : tag;
        }

        const tx = await this.expenseService.addExpense(parsed.data, log);
        savedTransactions.push(tx);
      }

      if (savedTransactions.length === 0) {
        log.step('reply.ignored', { reason: 'not_a_transaction' });
        return null;
      }

      const budgetFooter = this.reportService
        ? await this.reportService.buildBudgetFooter({
            types: savedTransactions.map((t) => t.type),
            categories: savedTransactions.map((t) => t.category),
          })
        : '';

      if (savedTransactions.length === 1) {
        const transaction = savedTransactions[0];
        log.step('reply.sent', { id: transaction.id });

        const replyLines = [
          '✅ *Transaksi tercatat*',
          `Tanggal : ${transaction.date}`,
          `Item    : ${transaction.item}`,
          `Kategori: ${transaction.category}`,
          `Jenis   : ${transaction.type || 'Kebutuhan'}`,
          `Nominal : ${formatRupiah(transaction.amount)}`,
        ];
        if (transaction.sender) {
          replyLines.push(`Oleh    : ${transaction.sender}`);
        }
        replyLines.push(`ID      : ${transaction.id}`);

        return replyLines.join('\n') + budgetFooter;
      }

      // Balasan jika user mengirim beberapa transaksi sekaligus (multi-baris)
      const totalBatch = savedTransactions.reduce((sum, t) => sum + t.amount, 0);
      log.step('reply.sent.batch', { count: savedTransactions.length, totalBatch });

      const itemLines = savedTransactions.map(
        (t, idx) =>
          `${idx + 1}. *${t.item}* (${t.category} • ${t.type || 'Kebutuhan'}) — ${formatRupiah(t.amount)} [${t.id}]`
      );

      const batchLines = [
        `✅ *${savedTransactions.length} Transaksi berhasil dicatat:*`,
        ...itemLines,
        '',
        `*Total input: ${formatRupiah(totalBatch)}*`,
      ];
      if (senderRole) {
        batchLines.push(`Oleh: ${senderRole}`);
      }

      return batchLines.join('\n') + budgetFooter;
    } catch (err) {
      log.error('unhandled', err);
      return '⚠️ Terjadi kesalahan saat memproses pesan. Coba lagi beberapa saat.';
    }
  }
}
