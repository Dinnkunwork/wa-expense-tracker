import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { ExpenseService } from '../src/services/expenseService.js';
import { CategoryService } from '../src/services/categoryService.js';
import { BudgetService } from '../src/services/budgetService.js';
import { ReportService } from '../src/services/reportService.js';
import { SchedulerService } from '../src/services/schedulerService.js';
import { editCommand } from '../src/commands/handlers/editCommand.js';
import { budgetCommand } from '../src/commands/handlers/budgetCommand.js';
import { monthCommand } from '../src/commands/handlers/monthCommand.js';
import { coupleCommand } from '../src/commands/handlers/coupleCommand.js';
import { searchCommand } from '../src/commands/handlers/searchCommand.js';
import { scheduleCommand, exportCommand } from '../src/commands/handlers/scheduleCommand.js';
import { CommandRouter } from '../src/commands/commandRouter.js';
import { MessageController } from '../src/controllers/messageController.js';

/** Repository palsu di memori — pengganti GoogleSheetsRepository untuk unit test. */
class FakeRepository {
  constructor() {
    this.rows = [];
    this.categoryMap = new Map([
      ['ayam', 'Belanja'],
      ['kopi', 'Makanan'],
      ['listrik', 'Tagihan'],
    ]);
    this.settings = new Map();
  }
  async appendTransaction(tx) {
    this.rows.push(tx);
  }
  async findByDate(dateStr) {
    return this.rows.filter((r) => r.date === dateStr);
  }
  async findByDateRange(startDate, endDate) {
    return this.rows.filter((r) => r.date >= startDate && r.date <= endDate);
  }
  async findByMonth(monthStr) {
    return this.rows.filter((r) => r.date.startsWith(monthStr));
  }
  async findLastTransaction({ sender } = {}) {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (sender && this.rows[i].sender && this.rows[i].sender !== sender) continue;
      return { rowNumber: i + 2, transaction: this.rows[i] };
    }
    return null;
  }
  async updateById(id, patch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  }
  async deleteById(id) {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rows.splice(idx, 1);
    return true;
  }
  async getCategoryMap() {
    return this.categoryMap;
  }
  async getSettings() {
    return new Map(this.settings);
  }
  async setSetting(key, val) {
    this.settings.set(key, String(val));
  }
}

test('ExpenseService.addExpense: kategori & jenis pengeluaran otomatis terisi', async () => {
  const repo = new FakeRepository();
  const categoryService = new CategoryService(repo);
  const expenseService = new ExpenseService(repo, categoryService);

  const tx1 = await expenseService.addExpense({
    date: '2026-07-09',
    item: 'Ayam Goreng',
    category: null,
    type: null,
    amount: 45000,
    note: '',
    sender: 'Istri',
    source: 'regex',
  });

  assert.equal(tx1.category, 'Belanja');
  assert.equal(tx1.type, 'Kebutuhan');
  assert.equal(tx1.sender, 'Istri');
  assert.match(tx1.id, /^TX-\d{8}-[A-Z0-9]{4}$/);

  const tx2 = await expenseService.addExpense({
    date: '2026-07-09',
    item: 'Kopi Susu',
    category: null,
    type: null,
    amount: 18000,
    note: '',
    sender: 'Suami',
    source: 'regex',
  });
  assert.equal(tx2.category, 'Makanan');
  assert.equal(tx2.type, 'Keinginan');
});

test('ExpenseService.addExpense: item tak dikenal masuk kategori "Lainnya"', async () => {
  const repo = new FakeRepository();
  const categoryService = new CategoryService(repo);
  const expenseService = new ExpenseService(repo, categoryService);

  const tx = await expenseService.addExpense({
    date: '2026-07-09',
    item: 'Sepatu Baru',
    category: null,
    amount: 250000,
    note: '',
    source: 'regex',
  });

  assert.equal(tx.category, 'Lainnya');
  assert.equal(tx.type, 'Keinginan');
});

test('ExpenseService.editExpense (termasuk spasi & "terakhir") & undoLastExpense', async () => {
  const repo = new FakeRepository();
  const categoryService = new CategoryService(repo);
  const expenseService = new ExpenseService(repo, categoryService);

  const tx = await expenseService.addExpense({
    date: '2026-07-09',
    item: 'Kopi',
    category: null,
    amount: 18000,
    note: '',
    source: 'regex',
  });

  // Edit via command handler dengan spasi di nama item & shorthand 25rb
  const reply = await editCommand(expenseService, [
    'terakhir',
    'amount=25rb',
    'item=Kopi',
    'Susu',
    'Aren',
    'jenis=Keinginan',
  ]);
  assert.match(reply, /berhasil diperbarui/);
  assert.equal(repo.rows[0].amount, 25000);
  assert.equal(repo.rows[0].item, 'Kopi Susu Aren');
  assert.equal(repo.rows[0].type, 'Keinginan');

  const undone = await expenseService.undoLastExpense();
  assert.equal(undone.id, tx.id);
  assert.equal(repo.rows.length, 0);
});

test('BudgetService & ReportService: jatah dana minggu/bulan, laporan bulan lalu, & pasangan', async () => {
  const repo = new FakeRepository();
  const categoryService = new CategoryService(repo);
  const expenseService = new ExpenseService(repo, categoryService);
  const budgetService = new BudgetService(repo);
  const reportService = new ReportService(repo, budgetService);

  const thisMonth = dayjs().format('YYYY-MM');
  const today = dayjs().format('YYYY-MM-DD');
  const lastMonthDate = dayjs().subtract(1, 'month').format('YYYY-MM-10');

  // Set jatah bulan ini 5 juta & minggu ini 1.2 juta
  await budgetCommand(budgetService, reportService, ['bulan', '5jt']);
  await budgetCommand(budgetService, reportService, ['minggu', '1.2jt']);

  // Transaksi bulan lalu
  await expenseService.addExpense({
    date: lastMonthDate,
    item: 'Listrik',
    category: null,
    amount: 500000,
    sender: 'Suami',
    source: 'regex',
  });

  // Transaksi bulan ini (Suami & Istri)
  await expenseService.addExpense({
    date: today,
    item: 'Ayam',
    category: null,
    amount: 100000,
    sender: 'Istri',
    source: 'regex',
  });
  await expenseService.addExpense({
    date: today,
    item: 'Kopi',
    category: null,
    amount: 50000,
    sender: 'Suami',
    source: 'regex',
  });

  const status = await reportService.getCurrentFundsStatus();
  assert.equal(status.monthlyBudget, 5000000);
  assert.equal(status.monthlySpent, 150000);
  assert.equal(status.monthlyRemaining, 4850000);
  assert.equal(status.weeklyBudget, 1200000);
  assert.equal(status.weeklyRemaining, 1050000);

  // Cek laporan bulan ini & bulan lalu
  const monthThisReply = await monthCommand(reportService, []);
  assert.match(monthThisReply, new RegExp(thisMonth.slice(0, 4)));
  assert.match(monthThisReply, /Istri/);
  assert.match(monthThisReply, /Suami/);

  const monthLastReply = await monthCommand(reportService, ['lalu']);
  assert.match(monthLastReply, /500\.000/);

  // Cek pengaturan & rekap pasangan
  await coupleCommand(budgetService, reportService, ['saya', 'Suami'], {
    senderNumber: '628111111111',
  });
  const role = await budgetService.resolveSenderRole('628111111111', 'Budi');
  assert.equal(role, 'Suami');
});

test('MessageController: mendukung batch input multi-baris, info sisa dana, dan command lengkap', async () => {
  const repo = new FakeRepository();
  const categoryService = new CategoryService(repo);
  const expenseService = new ExpenseService(repo, categoryService);
  const budgetService = new BudgetService(repo);
  const reportService = new ReportService(repo, budgetService);
  const commandRouter = new CommandRouter({
    expenseService,
    reportService,
    budgetService,
    categoryService,
  });
  const controller = new MessageController({
    commandRouter,
    expenseService,
    reportService,
    budgetService,
  });

  // Set peran Istri & jatah mingguan
  await controller.handleIncomingMessage('/pasangan saya Istri', {
    senderNumber: '628222222222',
    senderLabel: 'Siti',
  });
  await controller.handleIncomingMessage('/dana minggu 1jt', {
    senderNumber: '628222222222',
    senderLabel: 'Siti',
  });

  // Kirim 2 transaksi sekaligus dalam 1 pesan multi-baris
  const batchReply = await controller.handleIncomingMessage(
    'beli ayam 45rb\nkopi 18k #keinginan',
    {
      senderNumber: '628222222222',
      senderLabel: 'Siti',
    }
  );

  assert.match(batchReply, /2 Transaksi berhasil dicatat/);
  assert.match(batchReply, /Oleh: Istri/);
  assert.match(batchReply, /Sisa minggu ini/);
  assert.equal(repo.rows.length, 2);

  // Tambah kategori baru via chat
  const catReply = await controller.handleIncomingMessage('/kategori tambah popok Anak', {
    senderNumber: '628222222222',
  });
  assert.match(catReply, /Anak/);

  const singleReply = await controller.handleIncomingMessage('beli popok 85rb', {
    senderNumber: '628222222222',
  });
  assert.match(singleReply, /Kategori: Anak/);

  // Batalkan transaksi terakhir dengan /undo
  const undoReply = await controller.handleIncomingMessage('/undo', {
    senderNumber: '628222222222',
  });
  assert.match(undoReply, /Popok/);
  assert.equal(repo.rows.length, 2);
});

test('Budget per Jenis & Kategori, Pencarian (/cari), Export CSV (/export), dan Jadwal Otomatis (/jadwal)', async () => {
  const repo = new FakeRepository();
  const categoryService = new CategoryService(repo);
  const expenseService = new ExpenseService(repo, categoryService);
  const budgetService = new BudgetService(repo);
  const reportService = new ReportService(repo, budgetService);

  const sentMessages = [];
  const schedulerService = new SchedulerService({
    reportService,
    budgetService,
    sendMessage: async (recipient, text) => {
      sentMessages.push({ recipient, text });
    },
  });

  const commandRouter = new CommandRouter({
    expenseService,
    reportService,
    budgetService,
    categoryService,
    schedulerService,
  });
  const controller = new MessageController({
    commandRouter,
    expenseService,
    reportService,
    budgetService,
  });

  // 1. Set batas anggaran per jenis (Keinginan 100rb) & per kategori (Makanan 80rb)
  const typeBudgetReply = await controller.handleIncomingMessage('/dana keinginan 100rb', {
    senderNumber: '628111111111',
    senderLabel: 'Suami',
  });
  assert.match(typeBudgetReply, /Batas bulanan jenis Keinginan diatur ke Rp100\.000/);

  const catBudgetReply = await controller.handleIncomingMessage('/dana kategori Makanan 80rb', {
    senderNumber: '628111111111',
    senderLabel: 'Suami',
  });
  assert.match(catBudgetReply, /Batas bulanan kategori Makanan diatur ke Rp80\.000/);

  // 2. Catat transaksi Kopi 70rb -> memicu peringatan >= 80% untuk kategori Makanan (88%)
  const txReply = await controller.handleIncomingMessage('kopi kenangan 70rb #keinginan', {
    senderNumber: '628111111111',
    senderLabel: 'Suami',
  });
  assert.match(txReply, /Sisa jatah Keinginan: Rp30\.000/);
  assert.match(txReply, /Jatah kategori Makanan hampir habis! Sisa: Rp10\.000/);

  // Catat transaksi Listrik 350rb oleh Istri
  await controller.handleIncomingMessage('bayar listrik 350rb (token rumah)', {
    senderNumber: '628222222222',
    senderLabel: 'Istri',
  });

  // 3. Uji pencarian /cari dengan kata kunci & filter
  const searchReply1 = await controller.handleIncomingMessage('/cari listrik');
  assert.match(searchReply1, /Ditemukan\s*:\s*1 transaksi/);
  assert.match(searchReply1, /Listrik/);

  const searchReply2 = await searchCommand(reportService, ['#keinginan', 'oleh=Suami']);
  assert.match(searchReply2, /Kopi Kenangan/);
  assert.doesNotMatch(searchReply2, /Listrik/);

  // 4. Uji export CSV (/export)
  const exportReply = await controller.handleIncomingMessage('/export');
  assert.match(exportReply, /Export Transaksi/);
  assert.match(exportReply, /ID,Date,Item,Category,Type,Amount,Sender,Note/);
  assert.match(exportReply, /Kopi Kenangan,Makanan,Keinginan,70000,Suami/);

  const exportAllReply = await exportCommand(reportService, ['semua']);
  assert.match(exportAllReply, /Semua Periode/);

  // 5. Uji pengaturan & eksekusi jadwal otomatis (/jadwal)
  await controller.handleIncomingMessage('/jadwal on', {
    senderNumber: '628111111111',
  });
  await controller.handleIncomingMessage('/jadwal penerima 628111111111', {
    senderNumber: '628111111111',
  });
  const jamReply = await scheduleCommand(schedulerService, ['jam', '7']);
  assert.match(jamReply, /07:00/);

  // Simulasikan tanggal 1 sekaligus hari Senin pukul 08:00 pagi (mis. Senin, 2026-06-01 08:30)
  // Tambahkan 1 transaksi di bulan Mei 2026 (2026-05-28) agar laporan mingguan & bulanan terisi
  await expenseService.addExpense({
    date: '2026-05-28',
    item: 'Ayam Potong',
    category: 'Belanja',
    type: 'Kebutuhan',
    amount: 60000,
    sender: 'Istri',
    source: 'regex',
  });

  const dueResult1 = await schedulerService.checkAndSendDueReports('2026-06-01T08:30:00');
  assert.equal(dueResult1.monthlySent, true);
  assert.equal(dueResult1.weeklySent, true);
  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[0].text, /Rekap Otomatis Akhir Bulan/);
  assert.match(sentMessages[1].text, /Rekap Otomatis Mingguan/);

  // Panggilan kedua di hari/bulan yang sama tidak boleh mengirim ulang (idempoten)
  const dueResult2 = await schedulerService.checkAndSendDueReports('2026-06-01T09:00:00');
  assert.equal(dueResult2.monthlySent, false);
  assert.equal(dueResult2.weeklySent, false);
  assert.equal(sentMessages.length, 2);
});
