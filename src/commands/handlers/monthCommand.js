import dayjs from 'dayjs';
import { formatRupiah } from '../../utils/formatCurrency.js';

export async function monthCommand(reportService, args = []) {
  const rawArg = args.join(' ').trim();
  const targetMonth = reportService.resolveMonthArg(rawArg);

  if (!targetMonth) {
    return 'Format bulan tidak dikenali. Contoh: `/bulan`, `/bulan lalu`, `/bulan oktober`, atau `/bulan 2026-10`.';
  }

  const summary = await reportService.getMonthSummary(targetMonth);
  if (summary.count === 0) {
    return `Belum ada transaksi di bulan ${summary.monthLabel || summary.month}.`;
  }

  // Bandingkan dengan bulan sebelumnya
  const prevMonthStr = dayjs(`${targetMonth}-01`).subtract(1, 'month').format('YYYY-MM');
  const prevSummary = await reportService.getMonthSummary(prevMonthStr);

  const lines = [
    `*📊 Ringkasan Bulan ${summary.monthLabel || summary.month}:*`,
    `Jumlah transaksi : ${summary.count}`,
    `Total pengeluaran: *${formatRupiah(summary.total)}*`,
  ];

  if (prevSummary && prevSummary.total > 0) {
    const diff = summary.total - prevSummary.total;
    const diffPct = Math.round((Math.abs(diff) / prevSummary.total) * 100);
    if (diff > 0) {
      lines.push(
        `📈 Naik ${formatRupiah(diff)} (+${diffPct}%) dibanding ${prevSummary.monthLabel || prevMonthStr} (${formatRupiah(prevSummary.total)})`
      );
    } else if (diff < 0) {
      lines.push(
        `📉 Lebih hemat ${formatRupiah(Math.abs(diff))} (-${diffPct}%) dibanding ${prevSummary.monthLabel || prevMonthStr} (${formatRupiah(prevSummary.total)})`
      );
    } else {
      lines.push(`➖ Sama persis dengan bulan ${prevSummary.monthLabel || prevMonthStr}`);
    }
  }

  if (summary.budget) {
    const icon = summary.budget.remaining < 0 ? '🚨' : '🏦';
    lines.push(
      `Jatah bulanan    : ${formatRupiah(summary.budget.limit)}`,
      `${icon} Sisa dana bulan : *${formatRupiah(summary.budget.remaining)}* (${summary.budget.usedPercent}% terpakai)`
    );
  }

  const typeLines = Object.entries(summary.byType || {})
    .sort((a, b) => b[1] - a[1])
    .map(([type, amount]) => {
      const pct = Math.round((amount / summary.total) * 100);
      const tBudget = summary.typeBudgetStatus?.[type];
      if (tBudget) {
        const icon = tBudget.remaining < 0 ? '🚨' : tBudget.usedPercent >= 80 ? '⚠️' : '💰';
        return `- ${type}: ${formatRupiah(amount)} (${pct}%) • ${icon} Kuota ${tBudget.usedPercent}% dari ${formatRupiah(tBudget.limit)}`;
      }
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
    .map(([cat, amount]) => {
      const pct = Math.round((amount / summary.total) * 100);
      const cBudget = Object.values(summary.categoryBudgetStatus || {}).find(
        (b) => b.category.toLowerCase() === cat.toLowerCase()
      );
      if (cBudget) {
        const icon = cBudget.remaining < 0 ? '🚨' : cBudget.usedPercent >= 80 ? '⚠️' : '📂';
        return `- ${cat}: ${formatRupiah(amount)} (${pct}%) • ${icon} Kuota ${cBudget.usedPercent}% dari ${formatRupiah(cBudget.limit)}`;
      }
      return `- ${cat}: ${formatRupiah(amount)} (${pct}%)`;
    });
  if (categoryLines.length > 0) {
    lines.push('', '*📂 Per kategori:*', ...categoryLines);
  }

  return lines.join('\n');
}
