import dayjs from 'dayjs';
import { config, normalizePhoneNumber } from '../config/config.js';
import { EXPENSE_TYPES, normalizeExpenseType } from '../utils/expenseTypeResolver.js';

/**
 * Mengelola Jatah Dana (Budget Mingguan, Bulanan, per Jenis, & per Kategori),
 * Sisa Dana Saat Ini, serta identifikasi peran pasangan (Suami / Istri).
 *
 * Seluruh konfigurasi disimpan secara persisten di sheet "Settings" lewat repository,
 * sehingga tidak hilang meskipun bot di-restart.
 */
export class BudgetService {
  #fallbackStore = new Map();

  constructor(repository) {
    this.repository = repository;
  }

  async #getSettingsMap() {
    if (typeof this.repository.getSettings === 'function') {
      return this.repository.getSettings();
    }
    return new Map(this.#fallbackStore);
  }

  async #saveSetting(key, value) {
    this.#fallbackStore.set(key, String(value));
    if (typeof this.repository.setSetting === 'function') {
      await this.repository.setSetting(key, String(value));
    }
  }

  async getSetting(key) {
    const settings = await this.#getSettingsMap();
    return settings.get(key);
  }

  async setSetting(key, value) {
    await this.#saveSetting(key, value);
  }

  async getBudgetConfig(monthStr = dayjs().format('YYYY-MM')) {
    const settings = await this.#getSettingsMap();

    const rawMonthly = settings.get('monthly_budget');
    const rawWeekly = settings.get('weekly_budget');
    const rawExtra = settings.get(`extra_monthly_${monthStr}`);

    const monthlyBase =
      rawMonthly !== undefined ? Number(rawMonthly) || 0 : config.budget.defaultMonthly || 0;
    const weeklyBudget =
      rawWeekly !== undefined ? Number(rawWeekly) || 0 : config.budget.defaultWeekly || 0;
    const extraMonthly = rawExtra !== undefined ? Number(rawExtra) || 0 : 0;

    // Batas anggaran bulanan per Jenis Pengeluaran (mis. Keinginan, Tagihan, Kebutuhan)
    const typeBudgets = {};
    for (const type of EXPENSE_TYPES) {
      const rawLimit = settings.get(`type_budget_${type.toLowerCase()}`);
      const limit = Number(rawLimit) || 0;
      if (limit > 0) {
        typeBudgets[type] = limit;
      }
    }

    // Batas anggaran bulanan per Kategori (mis. Makanan, Belanja, Anak)
    const categoryBudgets = {};
    for (const [key, val] of settings.entries()) {
      if (key.startsWith('cat_budget_')) {
        const catKey = key.slice('cat_budget_'.length);
        const limit = Number(val) || 0;
        if (catKey && limit > 0) {
          const label =
            settings.get(`cat_label_${catKey}`) ||
            catKey
              .split(/\s+/)
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');
          categoryBudgets[label] = limit;
        }
      }
    }

    return {
      monthlyBase,
      extraMonthly,
      monthlyBudget: monthlyBase + extraMonthly,
      weeklyBudget,
      typeBudgets,
      categoryBudgets,
    };
  }

  async setMonthlyBudget(amount) {
    const num = Math.max(0, Math.round(Number(amount) || 0));
    await this.#saveSetting('monthly_budget', num);
    return num;
  }

  async setWeeklyBudget(amount) {
    const num = Math.max(0, Math.round(Number(amount) || 0));
    await this.#saveSetting('weekly_budget', num);
    return num;
  }

  async setTypeBudget(rawType, amount) {
    const normalized = normalizeExpenseType(rawType);
    if (!normalized) {
      throw new Error(
        `Jenis pengeluaran tidak dikenal. Gunakan salah satu: ${EXPENSE_TYPES.join(', ')}`
      );
    }
    const num = Math.max(0, Math.round(Number(amount) || 0));
    await this.#saveSetting(`type_budget_${normalized.toLowerCase()}`, num);
    return { type: normalized, amount: num };
  }

  async setCategoryBudget(rawCategory, amount) {
    const cleanCat = String(rawCategory || '').trim();
    if (!cleanCat) {
      throw new Error('Nama kategori tidak boleh kosong');
    }
    const catKey = cleanCat.toLowerCase();
    const label = cleanCat
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    const num = Math.max(0, Math.round(Number(amount) || 0));
    await this.#saveSetting(`cat_budget_${catKey}`, num);
    await this.#saveSetting(`cat_label_${catKey}`, label);
    return { category: label, amount: num };
  }

  async addExtraMonthlyFunds(amount, monthStr = dayjs().format('YYYY-MM')) {
    const current = await this.getBudgetConfig(monthStr);
    const nextExtra = Math.max(0, current.extraMonthly + Math.round(Number(amount) || 0));
    await this.#saveSetting(`extra_monthly_${monthStr}`, nextExtra);
    return {
      monthlyBase: current.monthlyBase,
      extraMonthly: nextExtra,
      monthlyBudget: current.monthlyBase + nextExtra,
    };
  }

  async resetExtraMonthlyFunds(monthStr = dayjs().format('YYYY-MM')) {
    await this.#saveSetting(`extra_monthly_${monthStr}`, 0);
  }

  /**
   * Menentukan label peran pengirim (misal "Suami" atau "Istri") berdasarkan nomor WA.
   */
  async resolveSenderRole(senderNumber, senderLabel) {
    const cleanNum = normalizePhoneNumber(senderNumber);
    if (cleanNum) {
      const settings = await this.#getSettingsMap();
      const dynamicRole = settings.get(`role_${cleanNum}`);
      if (dynamicRole) return dynamicRole;

      const envRole = config.whatsapp.coupleRoles?.[cleanNum];
      if (envRole) return envRole;
    }
    return senderLabel || cleanNum || '';
  }

  async setCoupleRole(senderNumber, roleName) {
    const cleanNum = normalizePhoneNumber(senderNumber);
    if (!cleanNum) {
      throw new Error('Nomor WhatsApp tidak valid');
    }
    const cleanRole = String(roleName || '').trim();
    await this.#saveSetting(`role_${cleanNum}`, cleanRole);
    return { number: cleanNum, role: cleanRole };
  }

  async getCoupleRoles() {
    const settings = await this.#getSettingsMap();
    const roles = { ...(config.whatsapp.coupleRoles || {}) };
    for (const [key, val] of settings.entries()) {
      if (key.startsWith('role_') && val) {
        roles[key.slice(5)] = val;
      }
    }
    return roles;
  }
}

