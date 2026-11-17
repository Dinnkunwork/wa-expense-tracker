import { formatRupiah } from '../../utils/formatCurrency.js';

/**
 * Handler perintah /pasangan untuk manajemen keuangan Suami & Istri:
 *   /pasangan                      -> lihat ringkasan pengeluaran Suami vs Istri & daftar nomor
 *   /pasangan saya Suami           -> tandai nomor pengirim saat ini sebagai "Suami"
 *   /pasangan saya Istri           -> tandai nomor pengirim saat ini sebagai "Istri"
 *   /pasangan set 628xxx Suami     -> tandai nomor tertentu sebagai "Suami" / "Istri"
 */
export async function coupleCommand(budgetService, reportService, args = [], context = {}) {
  const sub = String(args[0] || '').trim().toLowerCase();

  if (sub === 'saya' || sub === 'aku') {
    const role = args.slice(1).join(' ').trim();
    if (!role) {
      return 'Format: `/pasangan saya Suami` atau `/pasangan saya Istri`';
    }
    if (!context.senderNumber) {
      return 'Nomor pengirim tidak terdeteksi. Gunakan `/pasangan set <nomor> <Suami/Istri>`.';
    }
    const saved = await budgetService.setCoupleRole(context.senderNumber, role);
    return `💑 Nomor kamu (${saved.number}) sekarang tercatat sebagai *${saved.role}*. Semua transaksi darimu akan otomatis ditandai atas nama *${saved.role}*.`;
  }

  if (sub === 'set') {
    const phone = args[1];
    const role = args.slice(2).join(' ').trim();
    if (!phone || !role) {
      return 'Format: `/pasangan set <nomorWA> <Suami/Istri>` (contoh: `/pasangan set 628123456789 Suami`)';
    }
    const saved = await budgetService.setCoupleRole(phone, role);
    return `💑 Nomor ${saved.number} berhasil diatur sebagai *${saved.role}*.`;
  }

  const [roles, thisMonth, lastMonth] = await Promise.all([
    budgetService.getCoupleRoles(),
    reportService.getMonthSummary(),
    reportService.getLastMonthSummary(),
  ]);

  const lines = ['*💑 Manajemen Keuangan Pasangan (Suami & Istri)*'];

  const roleEntries = Object.entries(roles);
  if (roleEntries.length > 0) {
    lines.push('', '*📱 Nomor Terdaftar:*');
    for (const [num, role] of roleEntries) {
      lines.push(`- *${role}*: ${num}`);
    }
  } else {
    lines.push(
      '',
      '_(Belum ada peran nomor yang diatur. Ketik `/pasangan saya Suami` dari WA Suami dan `/pasangan saya Istri` dari WA Istri)_'
    );
  }

  lines.push('', `*📊 Bulan Ini (${thisMonth.monthLabel || thisMonth.month}):*`);
  if (thisMonth.count === 0) {
    lines.push('- Belum ada transaksi bulan ini.');
  } else {
    for (const [sender, info] of Object.entries(thisMonth.bySender).sort(
      (a, b) => b[1].total - a[1].total
    )) {
      const pct = Math.round((info.total / thisMonth.total) * 100);
      lines.push(`- *${sender}*: ${formatRupiah(info.total)} (${info.count} transaksi • ${pct}%)`);
    }
    lines.push(`Total Bersama: *${formatRupiah(thisMonth.total)}*`);
  }

  if (lastMonth.count > 0) {
    lines.push('', `*🗓️ Bulan Lalu (${lastMonth.monthLabel || lastMonth.month}):*`);
    for (const [sender, info] of Object.entries(lastMonth.bySender).sort(
      (a, b) => b[1].total - a[1].total
    )) {
      const pct = Math.round((info.total / lastMonth.total) * 100);
      lines.push(`- *${sender}*: ${formatRupiah(info.total)} (${info.count} transaksi • ${pct}%)`);
    }
    lines.push(`Total Bulan Lalu: *${formatRupiah(lastMonth.total)}*`);
  }

  lines.push(
    '',
    '_Pengaturan pasangan:_',
    '• `/pasangan saya Suami` / `/pasangan saya Istri`',
    '• `/pasangan set 628xxx Suami`'
  );

  return lines.join('\n');
}

