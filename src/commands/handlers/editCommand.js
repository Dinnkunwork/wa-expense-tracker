import { parseAmount } from '../../utils/amountParser.js';
import { formatRupiah } from '../../utils/formatCurrency.js';
import { normalizeExpenseType } from '../../utils/expenseTypeResolver.js';

/**
 * Format:
 *   /edit TX-20260708-AB12 amount=50rb item=Ayam Goreng jenis=Keinginan
 *   /edit terakhir amount=50000 note=Makan berdua
 *   /edit TX-20260708-AB12 50rb
 */
export async function editCommand(expenseService, args, log, context = {}) {
  const [idOrKeyword, ...restTokens] = args;
  const rawFields = restTokens.join(' ').trim();

  if (!idOrKeyword || !rawFields) {
    return [
      'Format: `/edit <ID|terakhir> field=nilai`',
      'Contoh:',
      '• `/edit TX-20260708-AB12 amount=50rb item=Ayam Goreng`',
      '• `/edit terakhir jenis=Keinginan kategori=Makanan`',
      '',
      'Field yang didukung: `amount` (nominal), `item` (nama), `category` (kategori), `type` (jenis: Kebutuhan/Keinginan/Tagihan/Tabungan/Darurat), `date` (YYYY-MM-DD), `note` (catatan), `sender` (Suami/Istri).',
    ].join('\n');
  }

  const patch = {};

  // Kemudahan: jika user hanya mengetik "/edit TX-xxxx 50rb" tanpa key=value
  if (!rawFields.includes('=')) {
    const directAmount = parseAmount(rawFields);
    if (directAmount !== null && directAmount > 0) {
      patch.amount = directAmount;
    }
  } else {
    // Parse pasangan key=value termasuk nilai yang mengandung spasi
    const kvRegex = /\b([a-zA-Z_]+)=((?:(?!\s+[a-zA-Z_]+=).)+)/g;
    for (const match of rawFields.matchAll(kvRegex)) {
      const rawKey = match[1].trim().toLowerCase();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (!rawKey || !value) continue;

      if (['amount', 'nominal', 'harga'].includes(rawKey)) {
        const num = parseAmount(value) ?? Number(value);
        if (!Number.isFinite(num) || num <= 0) return 'Nominal tidak valid.';
        patch.amount = num;
      } else if (['item', 'nama'].includes(rawKey)) {
        patch.item = value;
      } else if (['category', 'kategori'].includes(rawKey)) {
        patch.category = value;
      } else if (['type', 'jenis', 'tipe'].includes(rawKey)) {
        const normalized = normalizeExpenseType(value);
        if (!normalized) {
          return 'Jenis pengeluaran tidak valid. Pilih: Kebutuhan, Tagihan, Keinginan, Tabungan, atau Darurat.';
        }
        patch.type = normalized;
      } else if (['note', 'catatan'].includes(rawKey)) {
        patch.note = value;
      } else if (['date', 'tanggal', 'tgl'].includes(rawKey)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return 'Format tanggal harus YYYY-MM-DD (contoh: 2026-11-11).';
        }
        patch.date = value;
      } else if (['sender', 'oleh', 'pasangan'].includes(rawKey)) {
        patch.sender = value;
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return 'Tidak ada field valid untuk diubah. Field yang didukung: amount, item, category, type (jenis), note, date, sender.';
  }

  const targetId = await expenseService.resolveTargetId(idOrKeyword, {
    sender: context.sender,
  });
  if (!targetId) {
    return `Transaksi ${idOrKeyword} tidak ditemukan.`;
  }

  const updated = await expenseService.editExpense(targetId, patch, log, {
    sender: context.sender,
  });
  if (!updated) {
    return `Transaksi ${targetId} tidak ditemukan.`;
  }

  const changedSummary = Object.entries(patch)
    .map(([k, v]) => `${k}: ${k === 'amount' ? formatRupiah(v) : v}`)
    .join(', ');

  return `✅ Transaksi ${targetId} berhasil diperbarui (${changedSummary}).`;
}
