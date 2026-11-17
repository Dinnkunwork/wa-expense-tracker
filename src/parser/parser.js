import { z } from 'zod';
import { parseWithRegex } from './regexParser.js';
import { parseWithAI } from './aiParser.js';

const TransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal tidak valid'),
  item: z.string().min(1, 'Nama item tidak boleh kosong'),
  category: z.string().nullable().default(null),
  type: z.string().nullable().optional().default(null),
  amount: z.number().positive('Nominal harus lebih dari 0'),
  note: z.string().default(''),
  source: z.enum(['regex', 'ai']),
});

/**
 * Orkestrasi parsing sesuai alur yang diinginkan:
 *   Incoming Message -> Regex Parser -> berhasil? -> ya: pakai hasil regex
 *                                                  -> tidak: AI Parser
 *
 * Validasi zod dijalankan di akhir supaya baik hasil regex maupun AI
 * melewati aturan yang sama sebelum disimpan.
 */
export async function parseMessage(rawMessage, log) {
  let result = parseWithRegex(rawMessage);

  if (result) {
    log?.step('parser.regex.success', { item: result.item, amount: result.amount });
  } else {
    log?.step('parser.regex.miss');
    try {
      result = await parseWithAI(rawMessage);
      if (result) {
        log?.step('parser.ai.success', { item: result.item, amount: result.amount });
      } else {
        log?.step('parser.ai.miss');
      }
    } catch (err) {
      log?.error('parser.ai', err);
      throw err;
    }
  }

  if (!result) {
    return { ok: false, reason: 'not_a_transaction' };
  }

  const validation = TransactionSchema.safeParse(result);
  if (!validation.success) {
    log?.step('parser.validation.failed', { issues: validation.error.issues });
    return { ok: false, reason: 'validation_failed', issues: validation.error.issues };
  }

  return { ok: true, data: validation.data };
}
