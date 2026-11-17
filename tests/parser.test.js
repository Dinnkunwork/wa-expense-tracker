import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../src/parser/parser.js';

test('parseMessage: pesan valid via regex, tidak sampai panggil AI', async () => {
  const result = await parseMessage('beli ayam 45000');
  assert.equal(result.ok, true);
  assert.equal(result.data.item, 'Ayam');
  assert.equal(result.data.amount, 45000);
  assert.equal(result.data.source, 'regex');
});

test('parseMessage: pesan bukan transaksi dan AI parser nonaktif -> not_a_transaction', async () => {
  // AI_PARSER_ENABLED default true di config, tapi tanpa ANTHROPIC_API_KEY
  // aiParser akan langsung return null (lihat aiParser.js), jadi aman dites tanpa network.
  const result = await parseMessage('halo, apa kabar hari ini?');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_a_transaction');
});
