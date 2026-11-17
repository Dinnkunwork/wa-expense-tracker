import { generateTransactionId } from '../utils/idGenerator.js';
import { resolveExpenseType, normalizeExpenseType } from '../utils/expenseTypeResolver.js';

/**
 * Business logic pencatatan transaksi. Tidak mengetahui implementasi
 * Google Sheets — hanya bicara lewat repository & categoryService.
 */
export class ExpenseService {
  #lastTransaction = null;

  constructor(repository, categoryService) {
    this.repository = repository;
    this.categoryService = categoryService;
  }

  async addExpense(parsedTransaction, log) {
    const category =
      parsedTransaction.category ??
      (await this.categoryService.resolveCategory(parsedTransaction.item));
    log?.step('service.category.resolved', { category });

    const type = resolveExpenseType(
      parsedTransaction.item,
      category,
      parsedTransaction.type
    );
    log?.step('service.type.resolved', { type });

    const id = generateTransactionId();
    const transaction = {
      id,
      ...parsedTransaction,
      category,
      type,
      sender: parsedTransaction.sender || '',
    };

    await this.repository.appendTransaction(transaction);
    this.#lastTransaction = transaction;
    log?.step('service.sheets.saved', { id });

    return transaction;
  }

  async resolveTargetId(idOrKeyword, { sender } = {}) {
    if (!idOrKeyword) return null;
    const lower = String(idOrKeyword).trim().toLowerCase();
    if (['terakhir', 'last', 'barusan'].includes(lower)) {
      if (typeof this.repository.findLastTransaction === 'function') {
        const found = await this.repository.findLastTransaction({ sender });
        if (found?.transaction?.id) return found.transaction.id;
      }
      if (
        this.#lastTransaction &&
        (!sender ||
          !this.#lastTransaction.sender ||
          this.#lastTransaction.sender.toLowerCase() === sender.toLowerCase())
      ) {
        return this.#lastTransaction.id;
      }
      return null;
    }
    return String(idOrKeyword).trim().toUpperCase();
  }

  async editExpense(id, patch, log, { sender } = {}) {
    const targetId = await this.resolveTargetId(id, { sender });
    if (!targetId) return false;

    const normalizedPatch = { ...patch };
    if (normalizedPatch.type) {
      normalizedPatch.type = normalizeExpenseType(normalizedPatch.type) || normalizedPatch.type;
    }

    const updated = await this.repository.updateById(targetId, normalizedPatch);
    if (updated && this.#lastTransaction?.id === targetId) {
      this.#lastTransaction = { ...this.#lastTransaction, ...normalizedPatch };
    }
    log?.step(updated ? 'service.edit.success' : 'service.edit.notfound', { id: targetId });
    return updated;
  }

  async deleteExpense(id, log, { sender } = {}) {
    const targetId = await this.resolveTargetId(id, { sender });
    if (!targetId) return false;

    const deleted = await this.repository.deleteById(targetId);
    if (deleted && this.#lastTransaction?.id === targetId) {
      this.#lastTransaction = null;
    }
    log?.step(deleted ? 'service.delete.success' : 'service.delete.notfound', { id: targetId });
    return deleted;
  }

  async undoLastExpense({ sender } = {}, log) {
    let targetTx = null;
    if (typeof this.repository.findLastTransaction === 'function') {
      const found = await this.repository.findLastTransaction({ sender });
      targetTx = found?.transaction || null;
    }
    if (
      !targetTx &&
      this.#lastTransaction &&
      (!sender ||
        !this.#lastTransaction.sender ||
        this.#lastTransaction.sender.toLowerCase() === sender.toLowerCase())
    ) {
      targetTx = this.#lastTransaction;
    }
    if (!targetTx) return null;

    const deleted = await this.repository.deleteById(targetTx.id);
    if (!deleted) return null;

    if (this.#lastTransaction?.id === targetTx.id) {
      this.#lastTransaction = null;
    }
    log?.step('service.undo.success', { id: targetTx.id });
    return targetTx;
  }
}
