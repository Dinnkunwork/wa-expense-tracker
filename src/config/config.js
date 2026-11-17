import dotenv from 'dotenv';

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.execArgv.some((arg) => arg.startsWith('--test')) ||
  process.argv.some((arg) => arg.startsWith('--test') || /\.test\.[cm]?js$/.test(arg));

dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH || (isTestEnv ? 'tests/.env.test' : '.env'),
});

const timezone = process.env.TIMEZONE || 'Asia/Jakarta';
// Pastikan timezone proses selalu mengikuti konfigurasi (termasuk saat dijalankan di luar Docker).
process.env.TZ = timezone;

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Environment variable ${name} wajib diisi. Cek file .env kamu.`);
  }
  return value;
}

export const config = {
  whatsapp: {
    // Daftar nomor yang boleh mengirim transaksi, dipisah koma di .env, mis:
    //   WA_ALLOWED_NUMBERS=6285178249700,628xxxxxxxxxx,628yyyyyyyyyy
    // Array kosong = terima dari semua nomor (TIDAK disarankan).
    allowedNumbers: parseAllowedNumbers(process.env.WA_ALLOWED_NUMBERS ?? process.env.WA_ALLOWED_NUMBER),
    // Mapping opsional nomor WA ke peran pasangan (mis. "628111:Suami,628222:Istri").
    // Juga bisa diatur langsung dari chat menggunakan perintah /pasangan.
    coupleRoles: parseCoupleRoles(process.env.WA_COUPLE_ROLES),
    // Izinkan pencatatan dari grup WhatsApp (mis. grup khusus Suami & Istri).
    // Tetap memvalidasi nomor pengirim terhadap WA_ALLOWED_NUMBERS jika diisi.
    allowGroups: (process.env.WA_ALLOW_GROUPS ?? 'false') === 'true',
    // Kalau true, nama/peran pengirim otomatis ditambahkan ke kolom Note & Sender,
    // supaya transaksi dari pasangan tetap bisa dibedakan sumbernya.
    tagSenderInNote: (process.env.WA_TAG_SENDER_IN_NOTE ?? 'true') === 'true',
    authFolder: 'auth_session',
    // Override manual versi WA Web, format "mayor,minor,build" (mis. "2,3000,1037641644").
    // Dipakai kalau fetchLatestWaWebVersion/fetchLatestBaileysVersion masih menghasilkan
    // versi yang ditolak WhatsApp (error 405 Connection Failure). Lihat README bagian Troubleshooting.
    baileysVersionOverride: process.env.WA_BAILEYS_VERSION || null,
  },
  googleSheets: {
    spreadsheetId: required('GOOGLE_SHEETS_ID'),
    clientEmail: required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    privateKey: required('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    sheets: {
      transactions: 'Transactions',
      categories: 'Categories',
      settings: 'Settings',
    },
    categoryCacheTtlMs: Number(process.env.CATEGORY_CACHE_TTL_MS) || 5 * 60 * 1000,
    transactionsCacheTtlMs: Number(process.env.TRANSACTIONS_CACHE_TTL_MS) || 10 * 1000,
  },
  budget: {
    defaultMonthly: Number(process.env.DEFAULT_MONTHLY_BUDGET) || 0,
    defaultWeekly: Number(process.env.DEFAULT_WEEKLY_BUDGET) || 0,
  },
  scheduler: {
    enabled: (process.env.AUTO_REPORT_ENABLED ?? 'true') === 'true',
    hour: Number.isFinite(Number(process.env.AUTO_REPORT_HOUR))
      ? Number(process.env.AUTO_REPORT_HOUR)
      : 8,
    checkIntervalMs: Number(process.env.AUTO_REPORT_CHECK_INTERVAL_MS) || 60 * 1000,
    recipients: parseAllowedNumbers(process.env.WA_REPORT_RECIPIENTS),
  },
  aiParser: {
    enabled: (process.env.AI_PARSER_ENABLED ?? 'true') === 'true',
    apiKey: process.env.ANTHROPIC_API_KEY || null,
    model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 10_000,
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  timezone,
};

function parseAllowedNumbers(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((n) => normalizePhoneNumber(n))
    .filter(Boolean);
}

function parseCoupleRoles(raw) {
  if (!raw) return {};
  const roles = {};
  for (const entry of raw.split(',')) {
    const [num, role] = entry.split(':').map((s) => s?.trim());
    if (num && role) {
      roles[normalizePhoneNumber(num)] = role;
    }
  }
  return roles;
}

export function normalizePhoneNumber(raw) {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/^\+/, '').replace(/[\s-]/g, '');
  if (cleaned.startsWith('08')) {
    return '62' + cleaned.slice(1);
  }
  return cleaned;
}
