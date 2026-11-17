import { formatRupiah } from '../../utils/formatCurrency.js';

export async function deleteCommand(expenseService, idOrKeyword, log, context = {}) {
  if (!idOrKeyword) return 'Format: `/hapus TX-XXXXXXXX-XXXX` atau `/hapus terakhir`';

  const targetId = await expenseService.resolveTargetId(idOrKeyword, {
    sender: context.sender,
  });
  if (!targetId) {
    return `Transaksi ${idOrKeyword} tidak ditemukan.`;
  }

  const deleted = await expenseService.deleteExpense(targetId, log, {
    sender: context.sender,
  });
  return deleted
    ? `🗑️ Transaksi ${targetId} berhasil dihapus.`
    : `Transaksi ${targetId} tidak ditemukan.`;
}

export async function undoCommand(expenseService, context = {}, log) {
  const deletedTx = await expenseService.undoLastExpense({ sender: context.sender }, log);
  if (!deletedTx) {
    return 'Tidak ada transaksi terakhir yang bisa dibatalkan.';
  }
  return [
    '↩️ *Transaksi terakhir berhasil dibatalkan:*',
    `Item    : ${deletedTx.item}`,
    `Nominal : ${formatRupiah(deletedTx.amount)}`,
    `ID      : ${deletedTx.id}`,
  ].join('\n');
}
