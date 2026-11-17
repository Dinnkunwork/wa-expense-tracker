import dayjs from 'dayjs';
import { config, normalizePhoneNumber } from '../config/config.js';
import { monthCommand } from '../commands/handlers/monthCommand.js';
import { weekCommand } from '../commands/handlers/weekCommand.js';

/**
 * Mengelola pengiriman ringkasan otomatis terjadwal (Scheduled Report):
 * - Setiap Senin pagi: rekap pengeluaran Minggu Lalu
 * - Setiap tanggal 1 pagi: rekap pengeluaran Bulan Lalu (akhir bulan)
 *
 * Status pengiriman terakhir disimpan di sheet Settings agar tidak pernah
 * terkirim ganda meskipun bot di-restart.
 */
export class SchedulerService {
  #timer = null;

  constructor({ reportService, budgetService, sendMessage = null, logger = null }) {
    this.reportService = reportService;
    this.budgetService = budgetService;
    this.sendMessage = sendMessage;
    this.logger = logger;
  }

  setSendMessageCallback(fn) {
    this.sendMessage = fn;
  }

  async getScheduleStatus() {
    const rawEnabled = this.budgetService
      ? await this.budgetService.getSetting('auto_report_enabled')
      : undefined;
    const enabled =
      rawEnabled !== undefined
        ? rawEnabled === 'true'
        : Boolean(config.scheduler?.enabled ?? true);

    const rawHour = this.budgetService
      ? await this.budgetService.getSetting('auto_report_hour')
      : undefined;
    const parsedHour = rawHour !== undefined ? Number(rawHour) : config.scheduler?.hour ?? 8;
    const hour = Number.isFinite(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 8;

    const recipients = await this.resolveRecipients();
    const lastWeeklyDate =
      (this.budgetService && (await this.budgetService.getSetting('last_weekly_report_date'))) ||
      null;
    const lastMonthlyMonth =
      (this.budgetService && (await this.budgetService.getSetting('last_monthly_report_month'))) ||
      null;

    return {
      enabled,
      hour,
      recipients,
      lastWeeklyDate,
      lastMonthlyMonth,
    };
  }

  async resolveRecipients() {
    const set = new Set();

    const savedRaw = this.budgetService
      ? await this.budgetService.getSetting('auto_report_recipients')
      : '';
    if (savedRaw) {
      for (const item of String(savedRaw).split(',')) {
        const clean = normalizeRecipient(item);
        if (clean) set.add(clean);
      }
    }

    if (set.size === 0) {
      for (const num of config.scheduler?.recipients || []) {
        const clean = normalizeRecipient(num);
        if (clean) set.add(clean);
      }
    }

    if (set.size === 0) {
      for (const num of config.whatsapp?.allowedNumbers || []) {
        const clean = normalizeRecipient(num);
        if (clean) set.add(clean);
      }
    }

    if (set.size === 0 && this.budgetService) {
      const roles = await this.budgetService.getCoupleRoles();
      for (const num of Object.keys(roles)) {
        const clean = normalizeRecipient(num);
        if (clean) set.add(clean);
      }
    }

    return [...set];
  }

  async setEnabled(enabled, fallbackRecipient = null) {
    if (this.budgetService) {
      await this.budgetService.setSetting('auto_report_enabled', enabled ? 'true' : 'false');
    }
    if (enabled && fallbackRecipient) {
      const current = await this.resolveRecipients();
      if (current.length === 0) {
        await this.addRecipient(fallbackRecipient);
      }
    }
    return this.getScheduleStatus();
  }

  async setHour(hour) {
    const num = Number(hour);
    if (!Number.isInteger(num) || num < 0 || num > 23) {
      throw new Error('Jam harus berupa angka bulat antara 0 sampai 23');
    }
    if (this.budgetService) {
      await this.budgetService.setSetting('auto_report_hour', String(num));
    }
    return this.getScheduleStatus();
  }

  async addRecipient(rawRecipient) {
    const clean = normalizeRecipient(rawRecipient);
    if (!clean) throw new Error('Nomor penerima tidak valid');

    const current = new Set(await this.resolveRecipients());
    current.add(clean);
    if (this.budgetService) {
      await this.budgetService.setSetting('auto_report_recipients', [...current].join(','));
    }
    return [...current];
  }

  async buildWeeklyAutoReport() {
    const body = await weekCommand(this.reportService, ['lalu']);
    return `🔔 *Rekap Otomatis Mingguan (Senin Pagi)*\n\n${body}`;
  }

  async buildMonthlyAutoReport() {
    const body = await monthCommand(this.reportService, ['lalu']);
    return `🔔 *Rekap Otomatis Akhir Bulan*\n\n${body}`;
  }

  /**
   * Mengecek apakah waktu saat ini sudah memasuki jadwal pengiriman
   * laporan mingguan (Senin) atau bulanan (tanggal 1) dan belum dikirim.
   */
  async checkAndSendDueReports(now = dayjs()) {
    const d = dayjs(now);
    const status = await this.getScheduleStatus();

    if (!status.enabled || status.recipients.length === 0 || typeof this.sendMessage !== 'function') {
      return { weeklySent: false, monthlySent: false, recipients: status.recipients };
    }

    if (d.hour() < status.hour) {
      return { weeklySent: false, monthlySent: false, recipients: status.recipients };
    }

    let monthlySent = false;
    let weeklySent = false;

    const currentMonthKey = d.format('YYYY-MM');
    const currentDateKey = d.format('YYYY-MM-DD');

    // 1. Setiap tanggal 1 pagi -> kirim rekap bulan lalu
    if (d.date() === 1 && status.lastMonthlyMonth !== currentMonthKey) {
      const text = await this.buildMonthlyAutoReport();
      for (const recipient of status.recipients) {
        await this.sendMessage(recipient, text);
      }
      if (this.budgetService) {
        await this.budgetService.setSetting('last_monthly_report_month', currentMonthKey);
      }
      monthlySent = true;
      this.logger?.info({ month: currentMonthKey, recipients: status.recipients }, 'Laporan bulanan otomatis terkirim');
    }

    // 2. Setiap hari Senin pagi (day === 1) -> kirim rekap minggu lalu
    if (d.day() === 1 && status.lastWeeklyDate !== currentDateKey) {
      const text = await this.buildWeeklyAutoReport();
      for (const recipient of status.recipients) {
        await this.sendMessage(recipient, text);
      }
      if (this.budgetService) {
        await this.budgetService.setSetting('last_weekly_report_date', currentDateKey);
      }
      weeklySent = true;
      this.logger?.info({ date: currentDateKey, recipients: status.recipients }, 'Laporan mingguan otomatis terkirim');
    }

    return { weeklySent, monthlySent, recipients: status.recipients };
  }

  start(intervalMs = config.scheduler?.checkIntervalMs || 60_000) {
    this.stop();
    this.#timer = setInterval(() => {
      this.checkAndSendDueReports().catch((err) => {
        this.logger?.error({ err: err?.message }, 'Gagal menjalankan pengecekan laporan terjadwal');
      });
    }, intervalMs);
    if (typeof this.#timer.unref === 'function') {
      this.#timer.unref();
    }
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}

function normalizeRecipient(raw) {
  const str = String(raw || '').trim();
  if (!str) return '';
  if (str.includes('@')) return str;
  return normalizePhoneNumber(str);
}
