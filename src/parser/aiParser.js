import dayjs from 'dayjs';
import { config } from '../config/config.js';
import { normalizeExpenseType } from '../utils/expenseTypeResolver.js';

/**
 * AI Parser: dipakai hanya sebagai FALLBACK ketika regex parser gagal
 * memahami pesan (misal bahasa yang lebih bebas/natural).
 * Tujuannya menjaga biaya tetap rendah karena tidak setiap pesan
 * memanggil AI.
 */
export async function parseWithAI(rawMessage) {
  if (!config.aiParser.enabled || !config.aiParser.apiKey) {
    return null;
  }

  const today = dayjs().format('YYYY-MM-DD');
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

  const systemPrompt = `Kamu adalah parser transaksi keuangan rumah tangga (pasangan suami istri). Ubah pesan WhatsApp berbahasa Indonesia menjadi JSON transaksi.
Balas HANYA dengan JSON valid, tanpa teks lain, tanpa markdown code fence.
Format:
{"item": "Nama Item", "amount": 45000, "date": "${today}", "type": "Kebutuhan", "category": null, "note": ""}

Keterangan field:
- "type": pilih salah satu dari ["Kebutuhan", "Tagihan", "Keinginan", "Tabungan", "Darurat"].
- "date": format YYYY-MM-DD. Hari ini adalah ${today}, kemarin adalah ${yesterday}.

Jika pesan BUKAN transaksi keuangan (misalnya obrolan biasa, pertanyaan, atau tidak ada nominal yang jelas), balas dengan:
{"item": null, "amount": null, "date": null, "type": null, "category": null, "note": null}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.aiParser.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.aiParser.model,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: rawMessage }],
    }),
    signal: AbortSignal.timeout(config.aiParser.timeoutMs || 10_000),
  });

  if (!response.ok) {
    throw new Error(`AI Parser API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((b) => b.type === 'text');
  if (!textBlock) return null;

  let parsed;
  try {
    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    return null;
  }

  if (!parsed.item || !parsed.amount) return null;

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : today;

  return {
    date: validDate,
    item: parsed.item,
    category: parsed.category || null,
    type: normalizeExpenseType(parsed.type),
    amount: Number(parsed.amount),
    note: parsed.note || '',
    source: 'ai',
  };
}
