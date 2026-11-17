import dayjs from 'dayjs';
import { formatRupiah } from '../utils/formatCurrency.js';
import { normalizeExpenseType } from '../utils/expenseTypeResolver.js';

const INDONESIAN_MONTHS = {
  januari: '01', jan: '01',
  februari: '02', feb: '02',
  maret: '03', mar: '03',
  april: '04', apr: '04',
  mei: '05',
  juni: '06', jun: '06',
  juli: '07', jul: '07',
  agustus: '08', agu: '08', ags: '08',
  september: '09', sep: '09', sept: '09',
  oktober: '10', okt: '10',
  november: '11', nov: '11',
  desember: '12', des: '12',
};

const MONTH_NAMES_ID = [
  '',
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * Laporan cepat untuk balasan chat (hari ini, minggu ini, bulan ini, bulan lalu,
 * status sisa jatah dana, serta breakdown pasangan Suami/Istri & jenis pengeluaran).
 */
export class ReportService {
  constructor(repository, budgetService = null) {
    this.repository = repository;
    this.budgetService = budgetService;
  }

  async getTodayTransactions(dateStr = dayjs().format('YYYY-MM-DD')) {
    return this.repository.findByDate(dateStr);
  }

  getWeekRange(refDate = dayjs()) {
    const d = dayjs(refDate);
    const dayOfWeek = d.day(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const start = d.add(diffToMonday, 'day');
    const end = start.add(6, 'day');
    return {
      startDate: start.format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD'),
    };
  }

  async getWeekSummary(refDate = dayjs()) {
    const { startDate, endDate } = this.getWeekRange(refDate);
    let transactions = [];

    if (typeof this.repository.findByDateRange === 'function') {
      transactions = await this.repository.findByDateRange(startDate, endDate);
    } else {
      // Fallback jika pakai FakeRepository di unit test yang hanya punya findByMonth / rows
      const startMonth = startDate.slice(0, 7);
      const endMonth = endDate.slice(0, 7);
      const m1 = await this.repository.findByMonth(startMonth);
      const m2 = endMonth !== startMonth ? await this.repository.findByMonth(endMonth) : [];
      transactions = [...m1, ...m2].filter((t) => t.date >= startDate && t.date <= endDate);
    }

    const aggregated = aggregateTransactions(transactions);
    let budget = null;
    if (this.budgetService) {
      const cfg = await this.budgetService.getBudgetConfig(startDate.slice(0, 7));
      if (cfg.weeklyBudget > 0) {
        const remaining = cfg.weeklyBudget - aggregated.total;
        const usedPercent = Math.round((aggregated.total / cfg.weeklyBudget) * 100);
        budget = {
          limit: cfg.weeklyBudget,
          remaining,
          usedPercent,
        };
      }
    }

    return {
      startDate,
      endDate,
      ...aggregated,
      budget,
      transactions,
    };
  }

  async getMonthSummary(monthStr = dayjs().format('YYYY-MM')) {
    const transactions = await this.repository.findByMonth(monthStr);
    const aggregated = aggregateTransactions(transactions);

    let budget = null;
    const typeBudgetStatus = {};
    const categoryBudgetStatus = {};

    if (this.budgetService) {
      const cfg = await this.budgetService.getBudgetConfig(monthStr);
      if (cfg.monthlyBudget > 0) {
        const remaining = cfg.monthlyBudget - aggregated.total;
        const usedPercent = Math.round((aggregated.total / cfg.monthlyBudget) * 100);
        budget = {
          limit: cfg.monthlyBudget,
          monthlyBase: cfg.monthlyBase,
          extraMonthly: cfg.extraMonthly,
          remaining,
          usedPercent,
        };
      }

      for (const [type, limit] of Object.entries(cfg.typeBudgets || {})) {
        if (limit > 0) {
          const spent = aggregated.byType[type] || 0;
          const remaining = limit - spent;
          const usedPercent = Math.round((spent / limit) * 100);
          typeBudgetStatus[type] = {
            type,
            limit,
            spent,
            remaining,
            usedPercent,
          };
        }
      }

      for (const [catLabel, limit] of Object.entries(cfg.categoryBudgets || {})) {
        if (limit > 0) {
          const catLower = catLabel.toLowerCase();
          let spent = 0;
          for (const [txCat, amt] of Object.entries(aggregated.byCategory || {})) {
            if (txCat.toLowerCase() === catLower) {
              spent += amt;
            }
          }
          const remaining = limit - spent;
          const usedPercent = Math.round((spent / limit) * 100);
          categoryBudgetStatus[catLabel] = {
            category: catLabel,
            limit,
            spent,
            remaining,
            usedPercent,
          };
        }
      }
    }

    return {
      month: monthStr,
      monthLabel: formatMonthLabel(monthStr),
      ...aggregated,
      budget,
      typeBudgetStatus,
      categoryBudgetStatus,
      transactions,
    };
  }

  async getLastMonthSummary() {
    const lastMonthStr = dayjs().subtract(1, 'month').format('YYYY-MM');
    return this.getMonthSummary(lastMonthStr);
  }

  async getAllTransactions() {
    if (typeof this.repository.getAllTransactions === 'function') {
      return this.repository.getAllTransactions();
    }
    if (typeof this.repository.findByDateRange === 'function') {
      return this.repository.findByDateRange('0000-01-01', '9999-12-31');
    }
    if (Array.isArray(this.repository.rows)) {
      return [...this.repository.rows];
    }
    return [];
  }

  /**
   * Pencarian transaksi lintas riwayat berdasarkan kata kunci bebas dan/atau filter
   * (`bulan=...`, `jenis=...`/`#...`, `kategori=...`, `oleh=...`).
   */
  async searchTransactions(rawQuery = '') {
    let working = String(rawQuery || '').trim();
    const filters = {
      month: null,
      type: null,
      category: null,
      sender: null,
    };

    // Ekstrak filter key=value (bulan=..., jenis=..., kategori=..., oleh=...)
    const kvRegex = /\b(bulan|month|jenis|tipe|type|kategori|category|oleh|sender|pasangan)\s*[:=]\s*([^\s]+)/gi;
    for (const m of working.matchAll(kvRegex)) {
      const key = m[1].toLowerCase();
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (key === 'bulan' || key === 'month') {
        const resolvedMonth = this.resolveMonthArg(val);
        if (resolvedMonth) filters.month = resolvedMonth;
      } else if (key === 'jenis' || key === 'tipe' || key === 'type') {
        const resolvedType = normalizeExpenseType(val);
        if (resolvedType) filters.type = resolvedType;
      } else if (key === 'kategori' || key === 'category') {
        filters.category = val;
      } else if (key === 'oleh' || key === 'sender' || key === 'pasangan') {
        filters.sender = val;
      }
      working = working.replace(m[0], ' ');
    }

    // Ekstrak hashtag jenis pengeluaran (#keinginan, #tagihan, dll.)
    for (const tag of working.matchAll(/#([a-zA-Z0-9_]+)/g)) {
      const resolvedType = normalizeExpenseType(tag[1]);
      if (resolvedType) {
        filters.type = resolvedType;
        working = working.replace(tag[0], ' ');
      }
    }

    const keywords = working
      .toLowerCase()
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const all = await this.getAllTransactions();
    const matched = all.filter((t) => {
      if (filters.month && !String(t.date || '').startsWith(filters.month)) {
        return false;
      }
      if (
        filters.type &&
        String(t.type || 'Kebutuhan').toLowerCase() !== filters.type.toLowerCase()
      ) {
        return false;
      }
      if (
        filters.category &&
        String(t.category || 'Lainnya').toLowerCase() !== filters.category.toLowerCase()
      ) {
        return false;
      }
      if (
        filters.sender &&
        String(t.sender || '').toLowerCase() !== filters.sender.toLowerCase()
      ) {
        return false;
      }

      if (keywords.length > 0) {
        const haystack = [
          t.item || '',
          t.category || '',
          t.type || '',
          t.note || '',
          t.sender || '',
          t.id || '',
          t.date || '',
        ]
          .join(' ')
          .toLowerCase();
        return keywords.every((kw) => haystack.includes(kw));
      }

      return true;
    });

    // Urutkan dari tanggal terbaru ke terlama
    matched.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const aggregated = aggregateTransactions(matched);
    return {
      query: String(rawQuery || '').trim(),
      keywords,
      filters,
      ...aggregated,
      transactions: matched,
    };
  }

  /**
   * Menghasilkan data CSV transaksi untuk bulan tertentu (atau seluruh riwayat jika "semua").
   */
  async exportTransactionsCsv(rawArg = '') {
    const cleanArg = String(rawArg || '').trim().toLowerCase();
    let transactions = [];
    let label = '';
    let month = null;

    if (cleanArg === 'semua' || cleanArg === 'all') {
      transactions = await this.getAllTransactions();
      label = 'Semua Periode';
    } else {
      month = this.resolveMonthArg(rawArg);
      if (!month) return null;
      transactions = await this.repository.findByMonth(month);
      label = formatMonthLabel(month);
    }

    const header = 'ID,Date,Item,Category,Type,Amount,Sender,Note';
    const csvRows = transactions.map((t) =>
      [
        escapeCsvField(t.id),
        escapeCsvField(t.date),
        escapeCsvField(t.item),
        escapeCsvField(t.category || 'Lainnya'),
        escapeCsvField(t.type || 'Kebutuhan'),
        Number(t.amount) || 0,
        escapeCsvField(t.sender || ''),
        escapeCsvField(t.note || ''),
      ].join(',')
    );

    const aggregated = aggregateTransactions(transactions);
    return {
      month,
      label,
      ...aggregated,
      csv: [header, ...csvRows].join('\n'),
      transactions,
    };
  }

  /**
   * Mengubah argumen perintah `/bulan ...` menjadi string `YYYY-MM`.
   * Mendukung: kosong/"ini", "lalu"/"kemarin", "2026-10", "10", atau nama bulan ("oktober", "okt 2026").
   */
  resolveMonthArg(rawArg = '') {
    const text = String(rawArg || '').trim().toLowerCase();
    const now = dayjs();

    if (!text || text === 'ini' || text === 'sekarang') {
      return now.format('YYYY-MM');
    }

    if (['lalu', 'kemarin', 'sebelumnya', 'last', 'prev'].includes(text)) {
      return now.subtract(1, 'month').format('YYYY-MM');
    }

    if (/^\d{4}-\d{2}$/.test(text)) {
      return text;
    }

    if (/^\d{1,2}$/.test(text)) {
      const m = Number(text);
      if (m >= 1 && m <= 12) {
        return `${now.year()}-${String(m).padStart(2, '0')}`;
      }
    }

    const parts = text.split(/\s+/);
    const monthCode = INDONESIAN_MONTHS[parts[0]];
    if (monthCode) {
      const year = parts[1] && /^\d{4}$/.test(parts[1]) ? parts[1] : String(now.year());
      return `${year}-${monthCode}`;
    }

    return null;
  }

  /**
   * Menghitung status "Dana Saat Ini" (sisa jatah minggu ini & bulan ini,
   * persentase terpakai, serta batas aman pengeluaran harian).
   */
  async getCurrentFundsStatus(now = dayjs()) {
    const monthStr = now.format('YYYY-MM');
    const [budgetCfg, monthSummary, weekSummary] = await Promise.all([
      this.budgetService
        ? this.budgetService.getBudgetConfig(monthStr)
        : { monthlyBase: 0, extraMonthly: 0, monthlyBudget: 0, weeklyBudget: 0 },
      this.getMonthSummary(monthStr),
      this.getWeekSummary(now),
    ]);

    const daysInMonth = now.daysInMonth();
    const currentDayOfMonth = now.date();
    const daysLeftInMonth = Math.max(1, daysInMonth - currentDayOfMonth + 1);

    const dayOfWeek = now.day(); // 0=Minggu .. 6=Sabtu
    const dayIndexMondayBased = dayOfWeek === 0 ? 7 : dayOfWeek; // 1..7
    const daysLeftInWeek = Math.max(1, 7 - dayIndexMondayBased + 1);

    const monthlyRemaining = budgetCfg.monthlyBudget - monthSummary.total;
    const weeklyRemaining = budgetCfg.weeklyBudget - weekSummary.total;

    return {
      month: monthStr,
      monthLabel: monthSummary.monthLabel,
      monthlyBudget: budgetCfg.monthlyBudget,
      monthlyBase: budgetCfg.monthlyBase,
      extraMonthly: budgetCfg.extraMonthly,
      monthlySpent: monthSummary.total,
      monthlyRemaining,
      monthlyUsedPercent:
        budgetCfg.monthlyBudget > 0
          ? Math.round((monthSummary.total / budgetCfg.monthlyBudget) * 100)
          : 0,
      daysLeftInMonth,
      safeDailyMonth:
        budgetCfg.monthlyBudget > 0 && monthlyRemaining > 0
          ? Math.floor(monthlyRemaining / daysLeftInMonth)
          : 0,

      weekStart: weekSummary.startDate,
      weekEnd: weekSummary.endDate,
      weeklyBudget: budgetCfg.weeklyBudget,
      weeklySpent: weekSummary.total,
      weeklyRemaining,
      weeklyUsedPercent:
        budgetCfg.weeklyBudget > 0
          ? Math.round((weekSummary.total / budgetCfg.weeklyBudget) * 100)
          : 0,
      daysLeftInWeek,
      safeDailyWeek:
        budgetCfg.weeklyBudget > 0 && weeklyRemaining > 0
          ? Math.floor(weeklyRemaining / daysLeftInWeek)
          : 0,
      bySenderMonth: monthSummary.bySender,
      byTypeMonth: monthSummary.byType,
      typeBudgetStatus: monthSummary.typeBudgetStatus || {},
      categoryBudgetStatus: monthSummary.categoryBudgetStatus || {},
    };
  }

  /**
   * Ringkasan singkat sisa dana untuk ditempelkan di bawah balasan transaksi baru.
   * Menampilkan sisa dana mingguan/bulanan serta status batas anggaran per jenis/kategori
   * jika ada yang diatur (terutama peringatan saat mendekati/melewati batas).
   */
  async buildBudgetFooter({ types = [], categories = [] } = {}) {
    if (!this.budgetService) return '';
    const status = await this.getCurrentFundsStatus();
    const lines = [];

    if (status.weeklyBudget > 0) {
      const icon =
        status.weeklyRemaining < 0 ? '🚨' : status.weeklyUsedPercent >= 80 ? '⚠️' : '💰';
      lines.push(
        `${icon} Sisa minggu ini: ${formatRupiah(status.weeklyRemaining)} (${status.weeklyUsedPercent}% dari ${formatRupiah(status.weeklyBudget)})`
      );
    }

    if (status.monthlyBudget > 0) {
      const icon =
        status.monthlyRemaining < 0 ? '🚨' : status.monthlyUsedPercent >= 80 ? '⚠️' : '🏦';
      lines.push(
        `${icon} Sisa bulan ini : ${formatRupiah(status.monthlyRemaining)} (${status.monthlyUsedPercent}% dari ${formatRupiah(status.monthlyBudget)})`
      );
    }

    const activeTypes = new Set(types.filter(Boolean).map((t) => String(t).toLowerCase()));
    for (const [type, info] of Object.entries(status.typeBudgetStatus || {})) {
      const isRelevant =
        activeTypes.size === 0 ||
        activeTypes.has(type.toLowerCase()) ||
        info.usedPercent >= 80 ||
        info.remaining < 0;
      if (!isRelevant) continue;

      if (info.remaining < 0) {
        lines.push(
          `🚨 Jatah ${type} lewat batas ${formatRupiah(Math.abs(info.remaining))}! (${info.usedPercent}% dari ${formatRupiah(info.limit)})`
        );
      } else if (info.usedPercent >= 80) {
        lines.push(
          `⚠️ Jatah ${type} hampir habis! Sisa: ${formatRupiah(info.remaining)} (${info.usedPercent}% dari ${formatRupiah(info.limit)})`
        );
      } else {
        lines.push(
          `🏷️ Sisa jatah ${type}: ${formatRupiah(info.remaining)} (${info.usedPercent}% dari ${formatRupiah(info.limit)})`
        );
      }
    }

    const activeCategories = new Set(
      categories.filter(Boolean).map((c) => String(c).toLowerCase())
    );
    for (const [cat, info] of Object.entries(status.categoryBudgetStatus || {})) {
      const isRelevant =
        activeCategories.size === 0 ||
        activeCategories.has(cat.toLowerCase()) ||
        info.usedPercent >= 80 ||
        info.remaining < 0;
      if (!isRelevant) continue;

      if (info.remaining < 0) {
        lines.push(
          `🚨 Jatah kategori ${cat} lewat batas ${formatRupiah(Math.abs(info.remaining))}! (${info.usedPercent}% dari ${formatRupiah(info.limit)})`
        );
      } else if (info.usedPercent >= 80) {
        lines.push(
          `⚠️ Jatah kategori ${cat} hampir habis! Sisa: ${formatRupiah(info.remaining)} (${info.usedPercent}% dari ${formatRupiah(info.limit)})`
        );
      } else {
        lines.push(
          `📂 Sisa kategori ${cat}: ${formatRupiah(info.remaining)} (${info.usedPercent}% dari ${formatRupiah(info.limit)})`
        );
      }
    }

    return lines.length > 0 ? '\n' + lines.join('\n') : '';
  }
}

function aggregateTransactions(transactions) {
  let total = 0;
  const byCategory = {};
  const byType = {};
  const bySender = {};

  for (const t of transactions) {
    const amt = Number(t.amount) || 0;
    total += amt;

    const cat = t.category || 'Lainnya';
    byCategory[cat] = (byCategory[cat] || 0) + amt;

    const type = t.type || 'Kebutuhan';
    byType[type] = (byType[type] || 0) + amt;

    const sender = t.sender || 'Bersama/Lainnya';
    if (!bySender[sender]) {
      bySender[sender] = { total: 0, count: 0 };
    }
    bySender[sender].total += amt;
    bySender[sender].count += 1;
  }

  return {
    total,
    count: transactions.length,
    byCategory,
    byType,
    bySender,
  };
}

export function formatMonthLabel(monthStr) {
  const [year, month] = String(monthStr || '').split('-');
  const mIdx = Number(month);
  if (mIdx >= 1 && mIdx <= 12 && year) {
    return `${MONTH_NAMES_ID[mIdx]} ${year}`;
  }
  return monthStr;
}

function escapeCsvField(val) {
  const str = String(val ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
