import { formatRupiah } from '../../utils/formatCurrency.js';

const MAX_DISPLAY_ITEMS = 15;

/**
 * Handler perintah /cari (atau /search):
 *   /cari listrik
 *   /cari kopi bulan=lalu
 *   /cari #keinginan oleh=Suami
 *   /cari kategori=Anak
 */
export async function searchCommand(reportService, args = []) {
  const rawQuery = args.join(' ').trim();
  if (!rawQuery) {
    return [
      'Format: `/cari <kata kunci atau filter>`',
      'Contoh:',
      '• `/cari listrik` — cari riwayat "listrik"',
      '• `/cari kopi bulan=lalu` — cari "kopi" di bulan lalu',
      '• `/cari #keinginan oleh=Suami` — filter jenis & pasangan',
      '• `/cari kategori=Anak bulan=2026-10` — filter kategori & bulan',
    ].join('\n');
  }

  const result = await reportService.searchTransactions(rawQuery);
  if (result.count === 0) {
    return `🔍 Tidak ditemukan transaksi yang cocok untuk pencarian *"${rawQuery}"*.`;
  }

  const shown = result.transactions.slice(0, MAX_DISPLAY_ITEMS);
  const itemLines = shown.map((t) => {
    const typeTag = t.type ? ` • ${t.type}` : '';
    const senderTag = t.sender ? ` • 👤 ${t.sender}` : '';
    const noteTag = t.note ? ` _(${t.note})_` : '';
    return `- ${t.date}: *${t.item}* (${t.category || 'Lainnya'}${typeTag}) ${formatRupiah(t.amount)}${senderTag}${noteTag} [${t.id}]`;
  });

  const lines = [
    `*🔍 Hasil Pencarian: "${rawQuery}"*`,
    `Ditemukan        : ${result.count} transaksi`,
    `Total pengeluaran: *${formatRupiah(result.total)}*`,
    '',
    ...itemLines,
  ];

  if (result.count > MAX_DISPLAY_ITEMS) {
    lines.push(
      '',
      `_(Menampilkan ${MAX_DISPLAY_ITEMS} transaksi terbaru dari total ${result.count} transaksi yang cocok)_`
    );
  }

  return lines.join('\n');
}
