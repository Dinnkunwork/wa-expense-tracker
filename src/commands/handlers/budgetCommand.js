import { formatRupiah } from '../../utils/formatCurrency.js';
import { parseAmount } from '../../utils/amountParser.js';
import { normalizeExpenseType } from '../../utils/expenseTypeResolver.js';

/**
 * Handler untuk perintah /dana, /jatah, atau /budget:
 *   /dana                           -> lihat sisa dana & jatah minggu/bulan/jenis/kategori saat ini
 *   /dana minggu 1.2jt              -> atur jatah pengeluaran mingguan
 *   /dana bulan 5jt                 -> atur jatah pengeluaran bulanan
 *   /dana tambah 500rb              -> tambah dana ekstra khusus bulan ini
 *   /dana reset                     -> reset dana tambahan bulan ini
 *   /dana keinginan 1jt             -> atur batas anggaran bulanan untuk jenis (Keinginan/Tagihan/Kebutuhan/dll.)
 *   /dana kategori Makanan 1.5jt    -> atur batas anggaran bulanan untuk kategori tertentu
 */
export async function budgetCommand(budgetService, reportService, args = []) {
  const sub = String(args[0] || '').trim().toLowerCase();
  const valueRaw = args.slice(1).join('').trim();

  if (['minggu', 'mingguan', 'week', 'weekly'].includes(sub)) {
    const amount = parseAmount(valueRaw);
    if (amount === null || amount < 0) {
      return 'Format: `/dana minggu <nominal>` (contoh: `/dana minggu 1.2jt` atau `/dana minggu 1200000`)';
    }
    await budgetService.setWeeklyBudget(amount);
    const status = await reportService.getCurrentFundsStatus();
    return [
      `✅ *Jatah mingguan berhasil diatur ke ${formatRupiah(amount)}*`,
      `Terpakai minggu ini: ${formatRupiah(status.weeklySpent)}`,
      `💰 *Sisa dana minggu ini: ${formatRupiah(status.weeklyRemaining)}*`,
      status.safeDailyWeek > 0
        ? `💡 Batas aman harian (${status.daysLeftInWeek} hari tersisa): ${formatRupiah(status.safeDailyWeek)}/hari`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (['bulan', 'bulanan', 'month', 'monthly'].includes(sub)) {
    const amount = parseAmount(valueRaw);
    if (amount === null || amount < 0) {
      return 'Format: `/dana bulan <nominal>` (contoh: `/dana bulan 5jt` atau `/dana bulan 5000000`)';
    }
    await budgetService.setMonthlyBudget(amount);
    const status = await reportService.getCurrentFundsStatus();
    return [
      `✅ *Jatah bulanan berhasil diatur ke ${formatRupiah(amount)}*`,
      `Terpakai bulan ini: ${formatRupiah(status.monthlySpent)}`,
      `🏦 *Sisa dana bulan ini: ${formatRupiah(status.monthlyRemaining)}*`,
      status.safeDailyMonth > 0
        ? `💡 Batas aman harian (${status.daysLeftInMonth} hari tersisa): ${formatRupiah(status.safeDailyMonth)}/hari`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (['tambah', 'topup', 'ekstra', 'extra'].includes(sub)) {
    const amount = parseAmount(valueRaw);
    if (amount === null || amount <= 0) {
      return 'Format: `/dana tambah <nominal>` (contoh: `/dana tambah 500rb`)';
    }
    await budgetService.addExtraMonthlyFunds(amount);
    const status = await reportService.getCurrentFundsStatus();
    return [
      `✅ *Tambahan dana bulan ini sebesar ${formatRupiah(amount)} berhasil dicatat!*`,
      `Total jatah bulan ini: ${formatRupiah(status.monthlyBudget)} (Pokok ${formatRupiah(status.monthlyBase)} + Tambahan ${formatRupiah(status.extraMonthly)})`,
      `Terpakai bulan ini   : ${formatRupiah(status.monthlySpent)}`,
      `🏦 *Sisa dana saat ini: ${formatRupiah(status.monthlyRemaining)}*`,
    ].join('\n');
  }

  if (sub === 'reset') {
    await budgetService.resetExtraMonthlyFunds();
    return '✅ Dana tambahan bulan ini telah direset ke Rp0.';
  }

  // Batas anggaran per Kategori: "/dana kategori Makanan 1.5jt"
  if (['kategori', 'kat', 'category'].includes(sub)) {
    if (args.length < 3) {
      return 'Format: `/dana kategori <NamaKategori> <nominal>` (contoh: `/dana kategori Makanan 1.5jt` atau `/dana kategori Makanan 0` untuk hapus)';
    }
    const rawAmountToken = args[args.length - 1];
    const catName = args.slice(1, -1).join(' ').trim();
    const amount = parseAmount(rawAmountToken);
    if (!catName || amount === null || amount < 0) {
      return 'Format: `/dana kategori <NamaKategori> <nominal>` (contoh: `/dana kategori Makanan 1.5jt`)';
    }
    const saved = await budgetService.setCategoryBudget(catName, amount);
    if (saved.amount === 0) {
      return `✅ Batas anggaran untuk kategori *${saved.category}* telah dinonaktifkan.`;
    }
    const status = await reportService.getCurrentFundsStatus();
    const catInfo = status.categoryBudgetStatus?.[saved.category];
    return [
      `✅ *Batas bulanan kategori ${saved.category} diatur ke ${formatRupiah(saved.amount)}*`,
      catInfo ? `Terpakai bulan ini: ${formatRupiah(catInfo.spent)} (${catInfo.usedPercent}%)` : '',
      catInfo ? `📂 *Sisa jatah ${saved.category}: ${formatRupiah(catInfo.remaining)}*` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Batas anggaran per Jenis Pengeluaran: "/dana keinginan 1jt" atau "/dana jenis keinginan 1jt"
  const isExplicitTypeCmd = ['jenis', 'tipe', 'type'].includes(sub);
  const candidateTypeRaw = isExplicitTypeCmd ? args[1] : sub;
  const resolvedType = normalizeExpenseType(candidateTypeRaw);
  if (resolvedType) {
    const rawTypeAmount = isExplicitTypeCmd
      ? args.slice(2).join('').trim()
      : args.slice(1).join('').trim();
    const amount = parseAmount(rawTypeAmount);
    if (amount === null || amount < 0) {
      return `Format: \`/dana ${resolvedType.toLowerCase()} <nominal>\` (contoh: \`/dana ${resolvedType.toLowerCase()} 1jt\` atau \`0\` untuk menonaktifkan)`;
    }
    const saved = await budgetService.setTypeBudget(resolvedType, amount);
    if (saved.amount === 0) {
      return `✅ Batas anggaran untuk jenis *${saved.type}* telah dinonaktifkan.`;
    }
    const status = await reportService.getCurrentFundsStatus();
    const typeInfo = status.typeBudgetStatus?.[saved.type];
    return [
      `✅ *Batas bulanan jenis ${saved.type} diatur ke ${formatRupiah(saved.amount)}*`,
      typeInfo ? `Terpakai bulan ini: ${formatRupiah(typeInfo.spent)} (${typeInfo.usedPercent}%)` : '',
      typeInfo ? `🏷️ *Sisa jatah ${saved.type}: ${formatRupiah(typeInfo.remaining)}*` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Tanpa subcommand (atau "/dana info"): tampilkan status dana & jatah saat ini
  const status = await reportService.getCurrentFundsStatus();
  const lines = ['*💼 Status Dana & Jatah Keuangan Saat Ini*'];

  // Bagian Minggu Ini
  lines.push('', `*🗓️ Minggu Ini (${status.weekStart} s/d ${status.weekEnd}):*`);
  if (status.weeklyBudget > 0) {
    const icon =
      status.weeklyRemaining < 0 ? '🚨' : status.weeklyUsedPercent >= 80 ? '⚠️' : '💰';
    lines.push(
      `Jatah Minggu Ini : ${formatRupiah(status.weeklyBudget)}`,
      `Sudah Terpakai   : ${formatRupiah(status.weeklySpent)} (${status.weeklyUsedPercent}%)`,
      `${icon} *Sisa Dana Minggu : ${formatRupiah(status.weeklyRemaining)}*`
    );
    if (status.weeklyRemaining > 0) {
      lines.push(
        `💡 Batas aman harian: ${formatRupiah(status.safeDailyWeek)}/hari (${status.daysLeftInWeek} hari lagi)`
      );
    } else {
      lines.push(`🚨 *Perhatian: Pengeluaran minggu ini sudah melewati jatah sebesar ${formatRupiah(Math.abs(status.weeklyRemaining))}!*`);
    }
  } else {
    lines.push(
      `Sudah Terpakai   : ${formatRupiah(status.weeklySpent)}`,
      `_(Jatah mingguan belum diatur. Ketik: /dana minggu 1.2jt)_`
    );
  }

  // Bagian Bulan Ini
  lines.push('', `*📊 Bulan ${status.monthLabel}:*`);
  if (status.monthlyBudget > 0) {
    const icon =
      status.monthlyRemaining < 0 ? '🚨' : status.monthlyUsedPercent >= 80 ? '⚠️' : '🏦';
    const extraNote =
      status.extraMonthly > 0
        ? ` (Pokok ${formatRupiah(status.monthlyBase)} + Tambahan ${formatRupiah(status.extraMonthly)})`
        : '';
    lines.push(
      `Jatah Bulan Ini  : ${formatRupiah(status.monthlyBudget)}${extraNote}`,
      `Sudah Terpakai   : ${formatRupiah(status.monthlySpent)} (${status.monthlyUsedPercent}%)`,
      `${icon} *Sisa Dana Bulan  : ${formatRupiah(status.monthlyRemaining)}*`
    );
    if (status.monthlyRemaining > 0) {
      lines.push(
        `💡 Batas aman harian: ${formatRupiah(status.safeDailyMonth)}/hari (${status.daysLeftInMonth} hari lagi)`
      );
    } else {
      lines.push(`🚨 *Perhatian: Pengeluaran bulan ini sudah melewati jatah sebesar ${formatRupiah(Math.abs(status.monthlyRemaining))}!*`);
    }
  } else {
    lines.push(
      `Sudah Terpakai   : ${formatRupiah(status.monthlySpent)}`,
      `_(Jatah bulanan belum diatur. Ketik: /dana bulan 5jt)_`
    );
  }

  // Ringkasan batas anggaran per Jenis & Kategori bulan ini (jika diatur)
  const typeBudgetEntries = Object.values(status.typeBudgetStatus || {});
  const catBudgetEntries = Object.values(status.categoryBudgetStatus || {});
  if (typeBudgetEntries.length > 0 || catBudgetEntries.length > 0) {
    lines.push('', '*🏷️ Batas Anggaran per Jenis / Kategori Bulan Ini:*');
    for (const info of typeBudgetEntries) {
      const icon = info.remaining < 0 ? '🚨' : info.usedPercent >= 80 ? '⚠️' : '💰';
      lines.push(
        `- *${info.type}*: Terpakai ${formatRupiah(info.spent)} / ${formatRupiah(info.limit)} (${info.usedPercent}%) • ${icon} Sisa *${formatRupiah(info.remaining)}*`
      );
    }
    for (const info of catBudgetEntries) {
      const icon = info.remaining < 0 ? '🚨' : info.usedPercent >= 80 ? '⚠️' : '📂';
      lines.push(
        `- *Kategori ${info.category}*: Terpakai ${formatRupiah(info.spent)} / ${formatRupiah(info.limit)} (${info.usedPercent}%) • ${icon} Sisa *${formatRupiah(info.remaining)}*`
      );
    }
  }

  // Ringkasan kontribusi pasangan bulan ini
  const senderEntries = Object.entries(status.bySenderMonth || {});
  if (senderEntries.length > 0 && status.monthlySpent > 0) {
    lines.push('', '*💑 Pemakaian Dana Pasangan Bulan Ini:*');
    for (const [sender, info] of senderEntries.sort((a, b) => b[1].total - a[1].total)) {
      const pct = Math.round((info.total / status.monthlySpent) * 100);
      lines.push(`- ${sender}: ${formatRupiah(info.total)} (${info.count}x • ${pct}%)`);
    }
  }

  lines.push(
    '',
    '_Pengaturan cepat:_',
    '• `/dana minggu 1.2jt` — set jatah mingguan',
    '• `/dana bulan 5jt` — set jatah bulanan',
    '• `/dana keinginan 1jt` — batasi jenis pengeluaran',
    '• `/dana kategori Makanan 1.5jt` — batasi kategori',
    '• `/dana tambah 500rb` — tambah dana ekstra bulan ini'
  );

  return lines.join('\n');
}

