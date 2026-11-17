import { formatRupiah } from '../../utils/formatCurrency.js';

const MAX_CSV_PREVIEW_ROWS = 30;

/**
 * Handler perintah /jadwal (pengaturan Ringkasan Otomatis Akhir Bulan & Mingguan):
 *   /jadwal                     -> lihat status jadwal laporan otomatis
 *   /jadwal on / aktif          -> aktifkan laporan otomatis
 *   /jadwal off / nonaktif      -> matikan laporan otomatis
 *   /jadwal jam 8               -> ubah jam pengiriman (0-23)
 *   /jadwal penerima 628xxx     -> tambah nomor penerima laporan otomatis
 *   /jadwal kirim minggu|bulan  -> kirim/tampilkan rekap otomatis sekarang
 */
export async function scheduleCommand(schedulerService, args = [], context = {}) {
  const sub = String(args[0] || '').trim().toLowerCase();

  if (['on', 'aktif', 'enable', 'nyala'].includes(sub)) {
    const status = await schedulerService.setEnabled(true, context.senderNumber);
    return [
      '✅ *Ringkasan otomatis terjadwal telah DIAKTIFKAN!*',
      `⏰ Jam pengiriman : Setiap pukul ${String(status.hour).padStart(2, '0')}:00`,
      `📅 Jadwal         : Senin pagi (Minggu Lalu) & Tanggal 1 pagi (Bulan Lalu)`,
      `📱 Penerima       : ${status.recipients.join(', ') || '(belum ada)'}`,
    ].join('\n');
  }

  if (['off', 'nonaktif', 'disable', 'mati'].includes(sub)) {
    await schedulerService.setEnabled(false);
    return '🔕 Ringkasan otomatis terjadwal telah *dinonaktifkan*. Ketik `/jadwal on` untuk mengaktifkan kembali.';
  }

  if (['jam', 'hour', 'waktu'].includes(sub)) {
    const rawHour = String(args[1] || '').split(':')[0];
    const hourNum = Number(rawHour);
    if (!rawHour || !Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
      return 'Format: `/jadwal jam <0-23>` (contoh: `/jadwal jam 8` untuk pukul 08:00 pagi)';
    }
    const status = await schedulerService.setHour(hourNum);
    return `✅ Jam pengiriman laporan otomatis diatur ke pukul *${String(status.hour).padStart(2, '0')}:00*.`;
  }

  if (['penerima', 'recipient', 'tambah'].includes(sub)) {
    const target = args[1] || context.senderNumber;
    if (!target) {
      return 'Format: `/jadwal penerima <nomorWA>` (contoh: `/jadwal penerima 628123456789`)';
    }
    const recipients = await schedulerService.addRecipient(target);
    return `✅ Penerima laporan otomatis diperbarui: *${recipients.join(', ')}*`;
  }

  if (['kirim', 'test', 'tes', 'sekarang'].includes(sub)) {
    const mode = String(args[1] || 'bulan').trim().toLowerCase();
    if (['minggu', 'mingguan', 'pekan', 'week'].includes(mode)) {
      return schedulerService.buildWeeklyAutoReport();
    }
    return schedulerService.buildMonthlyAutoReport();
  }

  const status = await schedulerService.getScheduleStatus();
  return [
    '*⏰ Pengaturan Ringkasan Otomatis (Scheduled Report)*',
    '',
    `Status           : ${status.enabled ? '✅ *Aktif*' : '🔕 *Nonaktif*'}`,
    `Jam Pengiriman   : Pukul ${String(status.hour).padStart(2, '0')}:00`,
    `Rekap Mingguan   : Setiap Senin pagi (ringkasan minggu lalu)`,
    `Rekap Bulanan    : Setiap tanggal 1 pagi (ringkasan akhir bulan lalu)`,
    `Penerima         : ${status.recipients.length > 0 ? status.recipients.join(', ') : '_(belum diatur)_'}`,
    status.lastWeeklyDate ? `Terakhir Mingguan: ${status.lastWeeklyDate}` : '',
    status.lastMonthlyMonth ? `Terakhir Bulanan : ${status.lastMonthlyMonth}` : '',
    '',
    '_Perintah pengaturan:_',
    '• `/jadwal on` / `/jadwal off` — aktifkan/matikan rekap otomatis',
    '• `/jadwal jam 8` — atur jam pengiriman (0–23)',
    '• `/jadwal penerima 628xxx` — tambah nomor penerima',
    '• `/jadwal kirim bulan` — lihat/uji rekap akhir bulan sekarang',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Handler perintah /export (atau /csv, /unduh):
 *   /export                -> export CSV transaksi bulan ini
 *   /export lalu           -> export CSV transaksi bulan lalu
 *   /export oktober        -> export CSV bulan tertentu
 *   /export semua          -> export seluruh transaksi
 */
export async function exportCommand(reportService, args = []) {
  const rawArg = args.join(' ').trim();
  const exported = await reportService.exportTransactionsCsv(rawArg);

  if (!exported) {
    return 'Format periode tidak dikenali. Contoh: `/export`, `/export lalu`, `/export oktober`, `/export 2026-10`, atau `/export semua`.';
  }

  if (exported.count === 0) {
    return `Belum ada transaksi untuk diekspor pada periode *${exported.label}*.`;
  }

  const allCsvLines = exported.csv.split('\n');
  const headerLine = allCsvLines[0];
  const dataLines = allCsvLines.slice(1);
  const previewLines = dataLines.slice(0, MAX_CSV_PREVIEW_ROWS);

  const lines = [
    `*📤 Export Transaksi — ${exported.label}*`,
    `Jumlah transaksi : ${exported.count}`,
    `Total pengeluaran: *${formatRupiah(exported.total)}*`,
    '',
    '```',
    headerLine,
    ...previewLines,
    '```',
  ];

  if (dataLines.length > MAX_CSV_PREVIEW_ROWS) {
    lines.push(
      `_(Menampilkan ${MAX_CSV_PREVIEW_ROWS} baris pertama dari total ${dataLines.length} transaksi)_`
    );
  }

  return lines.join('\n');
}
