import dayjs from 'dayjs';

/**
 * Generate ID transaksi unik berbasis tanggal + random suffix.
 * Format: TX-YYYYMMDD-XXXX
 * Sengaja TIDAK memakai nomor baris spreadsheet, karena baris bisa
 * berubah posisinya ketika ada data yang dihapus.
 */
export function generateTransactionId(date = new Date()) {
  const datePart = dayjs(date).format('YYYYMMDD');
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TX-${datePart}-${randomPart}`;
}
