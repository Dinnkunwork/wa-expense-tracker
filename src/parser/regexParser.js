import dayjs from 'dayjs';
import { extractAmountFromText } from '../utils/amountParser.js';
import { normalizeExpenseType } from '../utils/expenseTypeResolver.js';

// Kata kerja pembuka yang sering dipakai lalu dibuang dari nama item.
const LEADING_VERBS = [
  'beli',
  'bayar',
  'isi',
  'top up',
  'topup',
  'jajan',
  'bayarin',
  'belanja',
  'ongkos',
];

/**
 * Regex parser: menangani pola-pola umum seperti
 *   "beli ayam 45000"
 *   "ayam 45rb"
 *   "kopi 18k #keinginan"
 *   "kemarin isi bensin 100000"
 *   "bayar listrik Rp 350.000 (token rumah)"
 *   "beli 2 ayam goreng 45rb"
 *
 * Return null kalau polanya tidak dikenali -> nanti fallback ke AI parser.
 */
export function parseWithRegex(rawMessage) {
  let workingText = rawMessage.trim();
  if (!workingText) return null;

  // 1. Ekstrak catatan opsional di dalam tanda kurung (...)
  let note = '';
  const parenMatch = workingText.match(/\(([^()]+)\)/);
  if (parenMatch) {
    note = parenMatch[1].trim();
    workingText = (
      workingText.slice(0, parenMatch.index) +
      ' ' +
      workingText.slice(parenMatch.index + parenMatch[0].length)
    ).trim();
  }

  // 2. Ekstrak jenis pengeluaran dari hashtag (#keinginan, #kebutuhan, #tagihan, dll.) atau jenis:...
  let explicitType = null;
  const typeKvMatch = workingText.match(/\b(?:jenis|tipe|type)\s*[:=]\s*([a-zA-Z_]+)/i);
  if (typeKvMatch) {
    explicitType = normalizeExpenseType(typeKvMatch[1]);
    workingText = (
      workingText.slice(0, typeKvMatch.index) +
      ' ' +
      workingText.slice(typeKvMatch.index + typeKvMatch[0].length)
    ).trim();
  }

  const hashtags = [...workingText.matchAll(/#([a-zA-Z0-9_]+)/g)];
  for (const tag of hashtags) {
    const resolved = normalizeExpenseType(tag[1]);
    if (resolved) {
      explicitType = resolved;
      workingText = workingText.replace(tag[0], ' ').trim();
    }
  }

  // 3. Ekstrak tanggal relatif ("kemarin lusa", "kemarin", "N hari lalu") atau tanggal eksplisit
  const dateExtraction = extractDateFromText(workingText);
  const date = dateExtraction.date;
  workingText = dateExtraction.remainingText;

  // 4. Ekstrak nominal (menggunakan posisi index yang presisi agar angka di nama item tidak ikut terhapus)
  const amountInfo = extractAmountFromText(workingText);
  if (!amountInfo) return null;

  let itemText = (
    workingText.slice(0, amountInfo.index) +
    ' ' +
    workingText.slice(amountInfo.index + amountInfo.length)
  )
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // 5. Buang kata kerja pembuka (beli, bayar, isi, dst).
  for (const verb of LEADING_VERBS) {
    if (itemText.startsWith(verb + ' ')) {
      itemText = itemText.slice(verb.length).trim();
      break;
    }
  }

  // Bersihkan tanda baca sisa di ujung nama item
  itemText = itemText.replace(/^[-:,.\s]+|[-:,.\s]+$/g, '').trim();
  if (!itemText) return null;

  // Title case sederhana untuk nama item.
  const item = itemText
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return {
    date,
    item,
    category: null, // diisi belakangan oleh CategoryService berdasarkan sheet Categories
    type: explicitType, // diisi belakangan oleh ExpenseService jika masih null
    amount: amountInfo.amount,
    note,
    source: 'regex',
  };
}

function extractDateFromText(text) {
  let remaining = text;
  const now = dayjs();

  // Format eksplisit YYYY-MM-DD
  let m = remaining.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (m) {
    return {
      date: m[1],
      remainingText: remaining.replace(m[0], ' ').trim(),
    };
  }

  // Format eksplisit DD/MM/YYYY atau DD/MM
  m = remaining.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (m) {
    const day = String(m[1]).padStart(2, '0');
    const month = String(m[2]).padStart(2, '0');
    const year = m[3] || String(now.year());
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return {
        date: `${year}-${month}-${day}`,
        remainingText: remaining.replace(m[0], ' ').trim(),
      };
    }
  }

  // "kemarin lusa" (2 hari lalu)
  m = remaining.match(/\bkemarin\s+lusa\b/i);
  if (m) {
    return {
      date: now.subtract(2, 'day').format('YYYY-MM-DD'),
      remainingText: remaining.replace(m[0], ' ').trim(),
    };
  }

  // "N hari (yang) lalu"
  m = remaining.match(/\b(\d+)\s+hari\s+(?:yang\s+)?lalu\b/i);
  if (m) {
    const daysAgo = Number(m[1]);
    return {
      date: now.subtract(daysAgo, 'day').format('YYYY-MM-DD'),
      remainingText: remaining.replace(m[0], ' ').trim(),
    };
  }

  // "kemarin"
  m = remaining.match(/\bkemarin\b/i);
  if (m) {
    return {
      date: now.subtract(1, 'day').format('YYYY-MM-DD'),
      remainingText: remaining.replace(m[0], ' ').trim(),
    };
  }

  // "hari ini"
  m = remaining.match(/\bhari\s+ini\b/i);
  if (m) {
    return {
      date: now.format('YYYY-MM-DD'),
      remainingText: remaining.replace(m[0], ' ').trim(),
    };
  }

  return {
    date: now.format('YYYY-MM-DD'),
    remainingText: remaining,
  };
}
