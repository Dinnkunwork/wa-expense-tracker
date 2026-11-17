/**
 * Menentukan kategori transaksi berdasarkan keyword yang cocok
 * dengan sheet Categories. Tidak tahu apa-apa soal Google Sheets —
 * hanya menerima map keyword->category dari repository.
 *
 * Dilengkapi in-memory cache ber-TTL agar tidak memanggil Google Sheets API
 * berulang kali pada setiap pesan masuk.
 */
export class CategoryService {
  #cache = null;
  #cacheExpiresAt = 0;

  constructor(repository, { ttlMs = 5 * 60 * 1000 } = {}) {
    this.repository = repository;
    this.ttlMs = ttlMs;
  }

  async getCategoryMap({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && this.#cache && now < this.#cacheExpiresAt) {
      return this.#cache;
    }

    const map = await this.repository.getCategoryMap();
    this.#cache = map;
    this.#cacheExpiresAt = now + this.ttlMs;
    return map;
  }

  invalidateCache() {
    this.#cache = null;
    this.#cacheExpiresAt = 0;
  }

  async addCategory(keyword, category) {
    const cleanKey = String(keyword || '').trim().toLowerCase();
    const cleanCat = String(category || '').trim();
    if (!cleanKey || !cleanCat) {
      throw new Error('Keyword dan kategori tidak boleh kosong');
    }
    if (typeof this.repository.addCategoryKeyword === 'function') {
      await this.repository.addCategoryKeyword(cleanKey, cleanCat);
    } else if (this.repository.categoryMap instanceof Map) {
      this.repository.categoryMap.set(cleanKey, cleanCat);
    }
    this.invalidateCache();
    return { keyword: cleanKey, category: cleanCat };
  }

  async resolveCategory(itemName) {
    const map = await this.getCategoryMap();
    const itemLower = String(itemName || '').toLowerCase();

    // Urutkan keyword dari yang paling panjang (spesifik) ke pendek (umum)
    const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);

    // 1. Prioritaskan kecocokan batas kata (word boundary)
    for (const [keyword, category] of entries) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = new RegExp(`(^|\\s|[^a-z0-9])${escaped}($|\\s|[^a-z0-9])`, 'i');
      if (wordRegex.test(itemLower)) return category;
    }

    // 2. Fallback ke substring match
    for (const [keyword, category] of entries) {
      if (itemLower.includes(keyword)) return category;
    }

    return 'Lainnya';
  }
}
