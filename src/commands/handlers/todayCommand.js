import dayjs from 'dayjs';
import { formatRupiah } from '../../utils/formatCurrency.js';

export async function todayCommand(reportService, args = []) {
  const arg = String(args[0] || '').trim().toLowerCase();
  const isYesterday = ['kemarin', 'yesterday', 'lalu'].includes(arg);
  const targetDate = isYesterday
    ? dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    : dayjs().format('YYYY-MM-DD');
  const label = isYesterday ? `kemarin (${targetDate})` : `hari ini (${targetDate})`;

  const transactions = await reportService.getTodayTransactions(targetDate);
  if (transactions.length === 0) {
    return `Belum ada transaksi ${label}.`;
  }

  const lines = transactions.map((t) => {
    const typeTag = t.type ? ` • ${t.type}` : '';
    const senderTag = t.sender ? ` • 👤 ${t.sender}` : '';
    return `- *${t.item}* (${t.category || 'Lainnya'}${typeTag}) ${formatRupiah(t.amount)}${senderTag} [${t.id}]`;
  });

  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  const footer = !isYesterday ? await reportService.buildBudgetFooter() : '';

  return [
    `*📋 Transaksi ${label}:*`,
    ...lines,
    '',
    `*Total: ${formatRupiah(total)}* (${transactions.length} transaksi)` + footer,
  ].join('\n');
}
