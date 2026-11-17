import dayjs from 'dayjs';
import { formatRupiah } from '../../utils/formatCurrency.js';

export async function weekCommand(reportService, args = []) {
  const arg = String(args[0] || '').trim().toLowerCase();
  const isLastWeek = ['lalu', 'kemarin', 'sebelumnya', 'last', 'prev'].includes(arg);
  const refDate = isLastWeek ? dayjs().subtract(7, 'day') : dayjs();
  const titleLabel = isLastWeek ? 'Minggu Lalu' : 'Minggu Ini';

  const summary = await reportService.getWeekSummary(refDate);
  if (summary.count === 0) {
    return `Belum ada transaksi di ${titleLabel.toLowerCase()} (${summary.startDate} s/d ${summary.endDate}).`;
  }

  const lines = [
    `*🗓️ Ringkasan ${titleLabel} (${summary.startDate} s/d ${summary.endDate}):*`,
    `Jumlah transaksi : ${summary.count}`,
    `Total pengeluaran: *${formatRupiah(summary.total)}*`,
  ];

  if (summary.budget && !isLastWeek) {
    const icon = summary.budget.remaining < 0 ? '🚨' : '💰';
    lines.push(
      `Jatah mingguan   : ${formatRupiah(summary.budget.limit)}`,
      `${icon} Sisa dana minggu: *${formatRupiah(summary.budget.remaining)}* (${summary.budget.usedPercent}% terpakai)`
    );
  }

  const typeLines = Object.entries(summary.byType || {})
    .sort((a, b) => b[1] - a[1])
    .map(([type, amount]) => {
      const pct = Math.round((amount / summary.total) * 100);
      return `- ${type}: ${formatRupiah(amount)} (${pct}%)`;
    });
  if (typeLines.length > 0) {
    lines.push('', '*🏷️ Per jenis pengeluaran:*', ...typeLines);
  }

  const senderLines = Object.entries(summary.bySender || {})
    .sort((a, b) => b[1].total - a[1].total)
    .map(([sender, info]) => {
      const pct = Math.round((info.total / summary.total) * 100);
      return `- ${sender}: ${formatRupiah(info.total)} (${info.count}x • ${pct}%)`;
    });
  if (senderLines.length > 0) {
    lines.push('', '*💑 Per pasangan/pencatat:*', ...senderLines);
  }

  const categoryLines = Object.entries(summary.byCategory || {})
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amount]) => `- ${cat}: ${formatRupiah(amount)}`);
  if (categoryLines.length > 0) {
    lines.push('', '*📂 Per kategori:*', ...categoryLines);
  }

  return lines.join('\n');
}

