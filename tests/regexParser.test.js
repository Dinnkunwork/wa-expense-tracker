import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { parseWithRegex } from '../src/parser/regexParser.js';
import { parseAmount, extractAmountFromText } from '../src/utils/amountParser.js';

test('parseAmount: angka polos & dengan prefix Rp', () => {
  assert.equal(parseAmount('45000'), 45000);
  assert.equal(parseAmount('Rp45.000'), 45000);
  assert.equal(parseAmount('rp 18k'), 18000);
});

test('parseAmount: format ribuan dengan titik', () => {
  assert.equal(parseAmount('15.000'), 15000);
});

test('parseAmount: rb / ribu / k', () => {
  assert.equal(parseAmount('45rb'), 45000);
  assert.equal(parseAmount('45 ribu'.replace(/\s+/g, '')), 45000);
  assert.equal(parseAmount('18k'), 18000);
});

test('parseAmount: jt / juta dengan desimal', () => {
  assert.equal(parseAmount('1.5jt'), 1500000);
  assert.equal(parseAmount('2juta'), 2000000);
});

test('parseAmount: teks tidak valid mengembalikan null', () => {
  assert.equal(parseAmount('abc'), null);
});

test('extractAmountFromText: ambil token nominal dari kalimat & abaikan angka kecil tanpa satuan', () => {
  const result = extractAmountFromText('beli ayam 45000');
  assert.equal(result.amount, 45000);

  // Kalimat biasa dengan angka kecil (< 100) tanpa satuan tidak boleh dianggap transaksi
  assert.equal(extractAmountFromText('beli 2 kopi'), null);
  assert.equal(extractAmountFromText('ketemu jam 7 malam'), null);
});

test('parseWithRegex: "beli ayam 45000"', () => {
  const result = parseWithRegex('beli ayam 45000');
  assert.equal(result.item, 'Ayam');
  assert.equal(result.amount, 45000);
  assert.equal(result.source, 'regex');
  assert.match(result.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('parseWithRegex: kuantitas di nama item tidak ikut terhapus ("beli 2 ayam goreng 45rb")', () => {
  const result = parseWithRegex('beli 2 ayam goreng 45rb');
  assert.equal(result.item, '2 Ayam Goreng');
  assert.equal(result.amount, 45000);
});

test('parseWithRegex: mendukung tanggal relatif "kemarin", jenis #keinginan, dan catatan dalam kurung', () => {
  const result = parseWithRegex('kemarin beli kopi 18k #keinginan (sama istri)');
  assert.equal(result.item, 'Kopi');
  assert.equal(result.amount, 18000);
  assert.equal(result.type, 'Keinginan');
  assert.equal(result.note, 'sama istri');
  assert.equal(result.date, dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
});

test('parseWithRegex: "kopi 18k" (tanpa kata kerja pembuka)', () => {
  const result = parseWithRegex('kopi 18k');
  assert.equal(result.item, 'Kopi');
  assert.equal(result.amount, 18000);
});

test('parseWithRegex: "isi bensin 100000"', () => {
  const result = parseWithRegex('isi bensin 100000');
  assert.equal(result.item, 'Bensin');
  assert.equal(result.amount, 100000);
});

test('parseWithRegex: "bayar listrik 350000"', () => {
  const result = parseWithRegex('bayar listrik 350000');
  assert.equal(result.item, 'Listrik');
  assert.equal(result.amount, 350000);
});

test('parseWithRegex: pesan tanpa nominal mengembalikan null (lanjut ke AI parser)', () => {
  const result = parseWithRegex('halo apa kabar');
  assert.equal(result, null);
});

test('parseWithRegex: nominal saja tanpa nama item mengembalikan null', () => {
  const result = parseWithRegex('45000');
  assert.equal(result, null);
});
