/**
 * Mengubah representasi nominal dalam teks Bahasa Indonesia sehari-hari
 * menjadi angka murni.
 *
 * Mendukung:
 *   45000        -> 45000
 *   Rp45.000     -> 45000
 *   45rb / 45 rb -> 45000
 *   45ribu       -> 45000
 *   18k          -> 18000
 *   1.5jt        -> 1500000
 *   2juta        -> 2000000
 *   15.000       -> 15000  (titik sebagai pemisah ribuan)
 */
export function parseAmount(rawText) {
  if (!rawText) return null;
  const text = rawText
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^rp\.?\s*/, '')
    .replace(/,/g, '.');

  // juta / jt
  let match = text.match(/^(\d+(?:\.\d+)?)\s*(jt|juta)$/);
  if (match) return Math.round(parseFloat(match[1]) * 1_000_000);

  // ribu / rb / k
  match = text.match(/^(\d+(?:\.\d+)?)\s*(rb|ribu|k)$/);
  if (match) return Math.round(parseFloat(match[1]) * 1_000);

  // angka biasa dengan titik sebagai pemisah ribuan (15.000 atau 1.250.000)
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    return parseInt(text.replace(/\./g, ''), 10);
  }

  // angka polos
  if (/^\d+$/.test(text)) {
    return parseInt(text, 10);
  }

  return null;
}

/**
 * Cari token nominal di dalam sebuah kalimat bebas (diutamakan dari belakang).
 * Mengabaikan angka kecil (< 100) tanpa satuan/prefix Rp agar kalimat biasa seperti
 * "beli 2 kopi" atau "jam 7 malam" tidak salah dikenali sebagai transaksi Rp2 / Rp7.
 */
export function extractAmountFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const tokenRegex = /(?:rp\.?\s*)?\d+(?:[.,]\d+)*(?:\s*(?:jt|juta|rb|ribu|k))?\b/gi;
  const matches = [...lower.matchAll(tokenRegex)];

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const m = matches[i];
    const rawMatch = m[0];
    const startIdx = m.index ?? 0;
    const endIdx = startIdx + rawMatch.length;

    // Abaikan angka yang merupakan bagian dari format tanggal (mis. 10/11 atau 2026-11-10)
    const charBefore = startIdx > 0 ? lower[startIdx - 1] : '';
    const charAfter = endIdx < lower.length ? lower[endIdx] : '';
    if (charBefore === '/' || charBefore === '-' || charAfter === '/' || charAfter === '-') {
      continue;
    }

    const cleaned = rawMatch.replace(/\s+/g, '');
    const amount = parseAmount(cleaned);
    if (amount === null || amount <= 0) continue;

    const hasUnitOrPrefix = /(?:^rp|jt|juta|rb|ribu|k|\.\d{3})/i.test(cleaned);
    // Angka polos di bawah 100 (misal jumlah barang "2" atau jam "7") bukan nominal Rupiah
    if (!hasUnitOrPrefix && amount < 100) {
      continue;
    }

    return {
      amount,
      rawToken: rawMatch.trim(),
      index: startIdx,
      length: rawMatch.length,
    };
  }
  return null;
}
