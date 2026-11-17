import { google } from 'googleapis';
import dayjs from 'dayjs';
import { config } from '../config/config.js';

const { spreadsheetId, sheets: sheetNames } = config.googleSheets;

/**
 * Satu-satunya komponen yang boleh berkomunikasi dengan Google Sheets API.
 * Tidak ada business logic di sini — hanya operasi baca/tulis mentah.
 */
export class GoogleSheetsRepository {
  #sheetsApi = null;
  #sheetIdCache = new Map();
  #transactionsCache = null;
  #transactionsCacheExpiresAt = 0;
  #transactionsInFlight = null;
  #transactionsCacheTtlMs = config.googleSheets.transactionsCacheTtlMs || 10_000;
  #settingsCache = null;
  #settingsCacheExpiresAt = 0;
  #settingsInFlight = null;

  constructor({ transactionsCacheTtlMs, sheetsApi = null } = {}) {
    if (transactionsCacheTtlMs !== undefined) {
      this.#transactionsCacheTtlMs = Number(transactionsCacheTtlMs);
    }
    if (sheetsApi) {
      this.#sheetsApi = sheetsApi;
    }
  }

  async #getClient() {
    if (this.#sheetsApi) return this.#sheetsApi;

    const auth = new google.auth.JWT({
      email: config.googleSheets.clientEmail,
      key: config.googleSheets.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await auth.authorize();
    this.#sheetsApi = google.sheets({ version: 'v4', auth });
    return this.#sheetsApi;
  }

  invalidateTransactionsCache() {
    this.#transactionsCache = null;
    this.#transactionsCacheExpiresAt = 0;
    this.#transactionsInFlight = null;
  }

  async #getSheetId(sheetTitle) {
    if (this.#sheetIdCache.has(sheetTitle)) {
      return this.#sheetIdCache.get(sheetTitle);
    }
    const sheets = await this.#getClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    for (const s of meta.data.sheets || []) {
      if (s.properties?.title !== undefined && s.properties?.sheetId !== undefined) {
        this.#sheetIdCache.set(s.properties.title, s.properties.sheetId);
      }
    }
    return this.#sheetIdCache.get(sheetTitle);
  }

  async appendTransaction({ id, date, item, category, amount, note, type = 'Kebutuhan', sender = '' }) {
    const sheets = await this.#getClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetNames.transactions}!A:H`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[id, date, item, category, amount, note || '', type || 'Kebutuhan', sender || '']],
      },
    });
    this.invalidateTransactionsCache();
  }

  /**
   * Ambil semua transaksi mentah (termasuk header) sebagai array of arrays.
   * Dilengkapi short-lived in-memory cache + deduplikasi request paralel
   * agar operasi laporan ganda (mis. getMonthSummary + getWeekSummary) tidak
   * memanggil Google Sheets API berkali-kali.
   */
  async #getAllRows({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && this.#transactionsCache && now < this.#transactionsCacheExpiresAt) {
      return this.#transactionsCache;
    }
    if (!forceRefresh && this.#transactionsInFlight) {
      return this.#transactionsInFlight;
    }

    const fetchPromise = (async () => {
      const sheets = await this.#getClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetNames.transactions}!A:H`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      });
      const rows = res.data.values || [];
      if (this.#transactionsCacheTtlMs > 0) {
        this.#transactionsCache = rows;
        this.#transactionsCacheExpiresAt = Date.now() + this.#transactionsCacheTtlMs;
      }
      return rows;
    })();

    this.#transactionsInFlight = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      if (this.#transactionsInFlight === fetchPromise) {
        this.#transactionsInFlight = null;
      }
    }
  }

  async getAllTransactions() {
    const rows = await this.#getAllRows();
    return stripTransactionHeader(rows)
      .filter((row) => row && row[0])
      .map(rowToTransaction);
  }

  async findByDate(dateStr) {
    const rows = await this.#getAllRows();
    return stripTransactionHeader(rows)
      .filter((row) => normalizeSheetDate(row[1], row[0]) === dateStr)
      .map(rowToTransaction);
  }

  async findByDateRange(startDate, endDate) {
    const rows = await this.#getAllRows();
    return stripTransactionHeader(rows)
      .filter((row) => {
        const d = normalizeSheetDate(row[1], row[0]);
        return d >= startDate && d <= endDate;
      })
      .map(rowToTransaction);
  }

  async findByMonth(monthStr) {
    // monthStr format: YYYY-MM
    const rows = await this.#getAllRows();
    return stripTransactionHeader(rows)
      .filter((row) => normalizeSheetDate(row[1], row[0]).startsWith(monthStr))
      .map(rowToTransaction);
  }

  async findById(id) {
    const rows = await this.#getAllRows();
    const targetId = String(id).trim().toUpperCase();
    const index = rows.findIndex(
      (row, idx) =>
        !(idx === 0 && isTransactionHeaderRow(row)) &&
        String(row?.[0] || '').trim().toUpperCase() === targetId
    );
    if (index < 0) return null;
    return { rowNumber: index + 1, transaction: rowToTransaction(rows[index]) }; // 1-indexed di Google Sheets
  }

  async findLastTransaction({ sender } = {}) {
    const rows = await this.#getAllRows();
    const minIdx = isTransactionHeaderRow(rows[0]) ? 1 : 0;
    for (let i = rows.length - 1; i >= minIdx; i -= 1) {
      if (!rows[i] || !rows[i][0]) continue;
      const tx = rowToTransaction(rows[i]);
      if (sender && tx.sender && tx.sender.toLowerCase() !== sender.toLowerCase()) {
        continue;
      }
      return { rowNumber: i + 1, transaction: tx };
    }
    return null;
  }

  async updateById(id, patch) {
    const found = await this.findById(id);
    if (!found) return false;

    const merged = { ...found.transaction, ...patch };
    const sheets = await this.#getClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetNames.transactions}!A${found.rowNumber}:H${found.rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          merged.id,
          merged.date,
          merged.item,
          merged.category,
          merged.amount,
          merged.note || '',
          merged.type || 'Kebutuhan',
          merged.sender || '',
        ]],
      },
    });
    this.invalidateTransactionsCache();
    return true;
  }

  async deleteById(id) {
    const found = await this.findById(id);
    if (!found) return false;

    const sheets = await this.#getClient();
    const sheetId = await this.#getSheetId(sheetNames.transactions);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: found.rowNumber - 1,
                endIndex: found.rowNumber,
              },
            },
          },
        ],
      },
    });
    this.invalidateTransactionsCache();
    return true;
  }

  /** Ambil mapping keyword -> kategori dari sheet Categories. */
  async getCategoryMap() {
    const sheets = await this.#getClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetNames.categories}!A:B`,
    });
    const rows = res.data.values || [];
    const map = new Map();
    for (const [keyword, category] of rows.slice(1)) {
      if (keyword && category) map.set(String(keyword).trim().toLowerCase(), String(category).trim());
    }
    return map;
  }

  /** Tambah atau perbarui mapping keyword -> kategori di sheet Categories. */
  async addCategoryKeyword(keyword, category) {
    const cleanKey = String(keyword).trim().toLowerCase();
    const cleanCat = String(category).trim();
    const sheets = await this.#getClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetNames.categories}!A:B`,
    });
    const rows = res.data.values || [];
    const existingIdx = rows.findIndex(
      (r, idx) => idx > 0 && String(r[0] || '').trim().toLowerCase() === cleanKey
    );

    if (existingIdx > 0) {
      const rowNum = existingIdx + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetNames.categories}!A${rowNum}:B${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[cleanKey, cleanCat]] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetNames.categories}!A:B`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[cleanKey, cleanCat]] },
      });
    }
  }

  /**
   * Ambil konfigurasi dinamis (jatah budget mingguan/bulanan, nama pasangan, dll.)
   * dari sheet Settings. Jika sheet Settings belum ada, kembalikan Map kosong.
   */
  async getSettings() {
    if (this.#settingsCache && Date.now() < this.#settingsCacheExpiresAt) {
      return new Map(this.#settingsCache);
    }
    if (this.#settingsInFlight) {
      const sharedMap = await this.#settingsInFlight;
      return new Map(sharedMap);
    }

    const fetchPromise = (async () => {
      const sheets = await this.#getClient();
      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetNames.settings}!A:B`,
          valueRenderOption: 'UNFORMATTED_VALUE',
        });
        const rows = res.data.values || [];
        const map = new Map();
        for (const [key, val] of rows.slice(1)) {
          if (key !== undefined && key !== '') {
            map.set(String(key).trim(), val !== undefined ? String(val).trim() : '');
          }
        }
        this.#settingsCache = map;
        this.#settingsCacheExpiresAt = Date.now() + 2 * 60 * 1000;
        return map;
      } catch {
        return new Map();
      }
    })();

    this.#settingsInFlight = fetchPromise;
    try {
      const map = await fetchPromise;
      return new Map(map);
    } finally {
      if (this.#settingsInFlight === fetchPromise) {
        this.#settingsInFlight = null;
      }
    }
  }

  /** Simpan konfigurasi dinamis ke sheet Settings (otomatis buat sheet jika belum ada). */
  async setSetting(key, value) {
    const cleanKey = String(key).trim();
    const cleanVal = String(value ?? '').trim();
    const sheets = await this.#getClient();

    await this.#ensureSettingsSheetExists();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetNames.settings}!A:B`,
    });
    const rows = res.data.values || [];
    const existingIdx = rows.findIndex(
      (r, idx) => idx > 0 && String(r[0] || '').trim() === cleanKey
    );

    if (existingIdx > 0) {
      const rowNum = existingIdx + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetNames.settings}!A${rowNum}:B${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[cleanKey, cleanVal]] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetNames.settings}!A:B`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[cleanKey, cleanVal]] },
      });
    }

    if (this.#settingsCache) {
      this.#settingsCache.set(cleanKey, cleanVal);
    }
  }

  async #ensureSettingsSheetExists() {
    const sheetId = await this.#getSheetId(sheetNames.settings);
    if (sheetId !== undefined) return;

    const sheets = await this.#getClient();
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetNames.settings } } }],
      },
    });
    const newId = res.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (newId !== undefined) {
      this.#sheetIdCache.set(sheetNames.settings, newId);
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetNames.settings}!A1:B1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Key', 'Value']] },
    });
  }

  /** Buat spreadsheet baru dengan struktur sheet + header sesuai spesifikasi. Dipakai oleh script setup. */
  async ensureSheetsStructure() {
    const sheets = await this.#getClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = meta.data.sheets.map((s) => s.properties.title);

    const requests = [];
    if (!existingTitles.includes(sheetNames.transactions)) {
      requests.push({ addSheet: { properties: { title: sheetNames.transactions } } });
    }
    if (!existingTitles.includes(sheetNames.categories)) {
      requests.push({ addSheet: { properties: { title: sheetNames.categories } } });
    }
    if (!existingTitles.includes(sheetNames.settings)) {
      requests.push({ addSheet: { properties: { title: sheetNames.settings } } });
    }
    if (requests.length) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetNames.transactions}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['ID', 'Date', 'Item', 'Category', 'Amount', 'Note', 'Type', 'Sender']],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetNames.categories}!A1:B1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Keyword', 'Category']] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetNames.settings}!A1:B1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Key', 'Value']] },
    });
  }
}

function isTransactionHeaderRow(row) {
  if (!row || !row[0]) return false;
  const firstCol = String(row[0]).trim().toLowerCase();
  return firstCol === 'id' || firstCol === 'id transaksi';
}

function stripTransactionHeader(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return isTransactionHeaderRow(rows[0]) ? rows.slice(1) : rows;
}

const MONTH_NAME_MAP = {
  januari: '01', january: '01', jan: '01',
  februari: '02', february: '02', feb: '02',
  maret: '03', march: '03', mar: '03',
  april: '04', apr: '04',
  mei: '05', may: '05',
  juni: '06', june: '06', jun: '06',
  juli: '07', july: '07', jul: '07',
  agustus: '08', august: '08', agu: '08', ags: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  oktober: '10', october: '10', okt: '10', oct: '10',
  november: '11', nov: '11', nopember: '11', nop: '11',
  desember: '12', december: '12', des: '12', dec: '12',
};

/**
 * Normalisasi nilai tanggal dari Google Sheets menjadi format ISO `YYYY-MM-DD`.
 * Menangani:
 *   1. Serial number tanggal Google Sheets/Excel (mis. 46343 -> "2026-11-17")
 *   2. String ISO `YYYY-MM-DD` atau `YYYY/MM/DD`
 *   3. String tanggal format lokal `DD/MM/YYYY` atau `DD-MM-YYYY`
 *   4. String tanggal panjang Bahasa Indonesia / Inggris (mis. "Selasa, 17 November 2026")
 *   5. Fallback ekstraksi tanggal dari ID transaksi (`TX-YYYYMMDD-XXXX`)
 */
export function normalizeSheetDate(val, fallbackId = '') {
  if (val !== null && val !== undefined && val !== '') {
    if (
      typeof val === 'number' ||
      (/^\d+(\.\d+)?$/.test(String(val).trim()) && Number(val) > 20000 && Number(val) < 100000)
    ) {
      const serial = Math.floor(Number(val));
      const utcMs = Date.UTC(1899, 11, 30) + serial * 86_400_000;
      return new Date(utcMs).toISOString().slice(0, 10);
    }

    const str = String(val).trim();

    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    m = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
    if (m) {
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }

    m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }

    // Format "Selasa, 17 November 2026", "17 November 2026", "17 Nov 2026"
    m = str.match(/(\d{1,2})[\s/-]+([a-zA-Z]+)[\s,/-]+(\d{4})/);
    if (m) {
      const monthNum = MONTH_NAME_MAP[m[2].toLowerCase()];
      if (monthNum) {
        return `${m[3]}-${monthNum}-${m[1].padStart(2, '0')}`;
      }
    }

    // Format "November 17, 2026"
    m = str.match(/([a-zA-Z]+)[\s-]+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
      const monthNum = MONTH_NAME_MAP[m[1].toLowerCase()];
      if (monthNum) {
        return `${m[3]}-${monthNum}-${m[2].padStart(2, '0')}`;
      }
    }
  }

  const idMatch = String(fallbackId || '').match(/^TX-(\d{4})(\d{2})(\d{2})-/i);
  if (idMatch) {
    return `${idMatch[1]}-${idMatch[2]}-${idMatch[3]}`;
  }

  return val !== null && val !== undefined ? String(val).trim() : '';
}

function parseRawAmount(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let str = String(val).trim();
  // Jika mengandung pemisah ribuan titik ala Rupiah (mis. "Rp20.000" atau "1.250.000"), buang titiknya
  if (/\d\.\d{3}(\b|$)/.test(str)) {
    str = str.replace(/\./g, '').replace(/,/g, '.');
  }
  const cleaned = str.replace(/[^0-9.-]/g, '');
  return Number(cleaned) || 0;
}

function extractSenderFromNote(note) {
  if (!note) return '';
  const m = String(note).match(/via\s+([^()]+)\)?$/i);
  return m ? m[1].trim() : '';
}

function rowToTransaction([id, date, item, category, amount, note, type, sender]) {
  const cleanNote = note ? String(note) : '';
  const resolvedSender = sender ? String(sender).trim() : extractSenderFromNote(cleanNote);
  return {
    id: String(id || ''),
    date: normalizeSheetDate(date, id),
    item: String(item || ''),
    category: category ? String(category) : null,
    amount: parseRawAmount(amount),
    note: cleanNote,
    type: type ? String(type) : 'Kebutuhan',
    sender: resolvedSender,
  };
}

export function currentMonthStr() {
  return dayjs().format('YYYY-MM');
}
