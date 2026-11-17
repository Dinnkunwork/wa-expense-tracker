import { helpCommand } from './handlers/helpCommand.js';
import { todayCommand } from './handlers/todayCommand.js';
import { weekCommand } from './handlers/weekCommand.js';
import { monthCommand } from './handlers/monthCommand.js';
import { budgetCommand } from './handlers/budgetCommand.js';
import { deleteCommand, undoCommand } from './handlers/deleteCommand.js';
import { editCommand } from './handlers/editCommand.js';
import { categoryCommand } from './handlers/categoryCommand.js';
import { coupleCommand } from './handlers/coupleCommand.js';
import { searchCommand } from './handlers/searchCommand.js';
import { scheduleCommand, exportCommand } from './handlers/scheduleCommand.js';

/**
 * Router perintah. Pesan yang diawali "/" dianggap perintah,
 * selain itu dianggap kandidat transaksi (diteruskan ke parser).
 */
export class CommandRouter {
  constructor({
    expenseService,
    reportService,
    budgetService = null,
    categoryService = null,
    schedulerService = null,
  }) {
    this.expenseService = expenseService;
    this.reportService = reportService;
    this.budgetService = budgetService;
    this.categoryService = categoryService;
    this.schedulerService = schedulerService;
  }

  isCommand(text) {
    return text.trim().startsWith('/');
  }

  async handle(text, log, context = {}) {
    const [cmd, ...args] = text.trim().slice(1).split(/\s+/);

    switch (cmd.toLowerCase()) {
      case 'help':
      case 'bantuan':
      case 'menu':
        return helpCommand();
      case 'hari':
        return todayCommand(this.reportService, args);
      case 'kemarin':
        return todayCommand(this.reportService, ['kemarin']);
      case 'minggu':
      case 'pekan':
        return weekCommand(this.reportService, args);
      case 'bulan':
        return monthCommand(this.reportService, args);
      case 'bulanlalu':
      case 'bulankemarin':
        return monthCommand(this.reportService, ['lalu']);
      case 'dana':
      case 'jatah':
      case 'budget':
      case 'saldo':
        if (!this.budgetService) {
          return 'Fitur dana/budget belum diinisialisasi.';
        }
        return budgetCommand(this.budgetService, this.reportService, args);
      case 'hapus':
        return deleteCommand(this.expenseService, args[0], log, context);
      case 'undo':
      case 'batal':
        return undoCommand(this.expenseService, context, log);
      case 'edit':
      case 'ubah':
        return editCommand(this.expenseService, args, log, context);
      case 'kategori':
        if (!this.categoryService) {
          return 'Fitur kategori belum diinisialisasi.';
        }
        return categoryCommand(this.categoryService, args);
      case 'pasangan':
      case 'suamiistri':
        if (!this.budgetService) {
          return 'Fitur pasangan belum diinisialisasi.';
        }
        return coupleCommand(this.budgetService, this.reportService, args, context);
      case 'cari':
      case 'search':
      case 'filter':
        return searchCommand(this.reportService, args);
      case 'export':
      case 'ekspor':
      case 'csv':
      case 'unduh':
        return exportCommand(this.reportService, args);
      case 'jadwal':
      case 'schedule':
      case 'otomatis':
        if (!this.schedulerService) {
          return 'Fitur jadwal laporan otomatis belum diinisialisasi.';
        }
        return scheduleCommand(this.schedulerService, args, context);
      default:
        return `Perintah "/${cmd}" tidak dikenal. Ketik /help untuk melihat daftar perintah.`;
    }
  }
}
