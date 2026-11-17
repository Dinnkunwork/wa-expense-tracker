/**
 * Klasifikasi Jenis Pembelian / Pengeluaran (Expense Type) untuk keuangan rumah tangga.
 *
 * Berbeda dengan "Category" (Makanan, Transport, Belanja, dll.), "Type" menjawab
 * sifat pengeluaran tersebut dalam anggaran pasangan suami istri:
 *   - Kebutuhan : Belanja dapur, makan harian, bensin/transport kerja, kesehatan, anak
 *   - Tagihan   : Pengeluaran rutin/wajib bulanan (listrik, air, internet, cicilan, sewa, BPJS)
 *   - Keinginan : Jajan, kopi, nongkrong, hiburan, belanja sekunder/hobi, liburan
 *   - Tabungan  : Tabungan, investasi, dana pendidikan, emas
 *   - Darurat   : Pengeluaran mendadak / tak terduga (servis rusak, berobat darurat, dll.)
 */

export const EXPENSE_TYPES = ['Kebutuhan', 'Tagihan', 'Keinginan', 'Tabungan', 'Darurat'];

const TYPE_ALIASES = new Map([
  ['kebutuhan', 'Kebutuhan'],
  ['primer', 'Kebutuhan'],
  ['pokok', 'Kebutuhan'],
  ['rumah tangga', 'Kebutuhan'],
  ['dapur', 'Kebutuhan'],
  ['harian', 'Kebutuhan'],

  ['tagihan', 'Tagihan'],
  ['rutin', 'Tagihan'],
  ['wajib', 'Tagihan'],
  ['bulanan', 'Tagihan'],
  ['cicilan', 'Tagihan'],

  ['keinginan', 'Keinginan'],
  ['sekunder', 'Keinginan'],
  ['tersier', 'Keinginan'],
  ['jajan', 'Keinginan'],
  ['hiburan', 'Keinginan'],
  ['lifestyle', 'Keinginan'],
  ['pribadi', 'Keinginan'],

  ['tabungan', 'Tabungan'],
  ['investasi', 'Tabungan'],
  ['saving', 'Tabungan'],

  ['darurat', 'Darurat'],
  ['mendadak', 'Darurat'],
  ['emergency', 'Darurat'],
]);

const KEYWORD_RULES = [
  {
    type: 'Tagihan',
    keywords: [
      'listrik', 'token', 'pln', 'pdam', 'air', 'wifi', 'indihome', 'internet',
      'bpjs', 'asuransi', 'cicilan', 'kpr', 'kontrakan', 'sewa', 'kos', 'ipl',
      'pajak', 'stnk', 'pbb', 'spp', 'uang sekolah', 'pulsa', 'paket data', 'kuota',
      'netflix', 'spotify', 'youtube', 'langganan',
    ],
  },
  {
    type: 'Tabungan',
    keywords: [
      'tabung', 'tabungan', 'investasi', 'reksadana', 'bibit', 'emas', 'antam',
      'deposito', 'saham', 'dana pendidikan',
    ],
  },
  {
    type: 'Darurat',
    keywords: [
      'darurat', 'igd', 'rumah sakit', 'opname', 'ban bocor', 'mogok', 'servis mendadak',
      'duka', 'musibah',
    ],
  },
  {
    type: 'Keinginan',
    keywords: [
      'kopi', 'coffee', 'starbucks', 'boba', 'mixue', 'eskrim', 'es krim', 'cemilan',
      'snack', 'jajan', 'nonton', 'bioskop', 'xxi', 'cgv', 'nongkrong', 'cafe', 'kafe',
      'game', 'topup game', 'skin', 'hobi', 'mainan', 'staycation', 'liburan', 'wisata',
      'skincare', 'makeup', 'parfum', 'baju', 'sepatu', 'tas', 'aksesoris', 'martabak',
      'seblak', 'cilok', 'kue', 'cake', 'coklat', 'roti bakar',
    ],
  },
];

/**
 * Normalisasi input string jenis pengeluaran menjadi salah satu nilai standar EXPENSE_TYPES.
 * Mengembalikan null jika tidak dikenali.
 */
export function normalizeExpenseType(rawType) {
  if (!rawType) return null;
  const cleaned = rawType.toString().trim().toLowerCase().replace(/^#/, '');
  if (TYPE_ALIASES.has(cleaned)) {
    return TYPE_ALIASES.get(cleaned);
  }
  const exact = EXPENSE_TYPES.find((t) => t.toLowerCase() === cleaned);
  return exact || null;
}

/**
 * Menentukan jenis pengeluaran secara otomatis berdasarkan input eksplisit,
 * kategori, atau kata kunci pada nama item.
 */
export function resolveExpenseType(item = '', category = '', explicitType = null) {
  const normalizedExplicit = normalizeExpenseType(explicitType);
  if (normalizedExplicit) return normalizedExplicit;

  const catLower = (category || '').toLowerCase();
  if (catLower === 'tagihan' || catLower === 'cicilan') return 'Tagihan';
  if (catLower === 'hiburan' || catLower === 'jajan' || catLower === 'hobi') return 'Keinginan';
  if (catLower === 'tabungan' || catLower === 'investasi') return 'Tabungan';
  if (catLower === 'darurat') return 'Darurat';

  const textLower = `${item} ${category || ''}`.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      const regex = new RegExp(`(^|\\s|[^a-z0-9])${escapeRegex(kw)}($|\\s|[^a-z0-9])`, 'i');
      if (regex.test(textLower)) {
        return rule.type;
      }
    }
  }

  return 'Kebutuhan';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

