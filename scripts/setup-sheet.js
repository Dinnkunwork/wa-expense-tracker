/**
 * Jalankan sekali di awal untuk membuat header sheet Transactions, Categories, & Settings
 * secara otomatis di spreadsheet yang sudah kamu buat.
 *
 * Cara pakai: node scripts/setup-sheet.js
 */
import { GoogleSheetsRepository } from '../src/repositories/googleSheetsRepository.js';

const repo = new GoogleSheetsRepository();
await repo.ensureSheetsStructure();
console.log('Struktur sheet (Transactions, Categories, & Settings) siap.');
console.log('Kamu bisa mengisi sheet Categories secara manual atau langsung lewat chat WhatsApp:');
console.log('  /kategori tambah ayam Belanja');
console.log('  /kategori tambah kopi Makanan');
console.log('  /kategori tambah bensin Transport');
