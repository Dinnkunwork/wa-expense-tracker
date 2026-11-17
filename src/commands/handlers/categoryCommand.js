/**
 * Handler perintah /kategori:
 *   /kategori                           -> lihat semua mapping keyword -> kategori
 *   /kategori tambah <keyword> <kat>    -> tambah keyword kategori otomatis
 */
export async function categoryCommand(categoryService, args = []) {
  const sub = String(args[0] || '').trim().toLowerCase();

  if (['tambah', 'add', 'set'].includes(sub)) {
    const keyword = args[1];
    const category = args.slice(2).join(' ').trim();
    if (!keyword || !category) {
      return 'Format: `/kategori tambah <keyword> <Nama Kategori>` (contoh: `/kategori tambah popok Anak`)';
    }
    const saved = await categoryService.addCategory(keyword, category);
    return `✅ Keyword *"${saved.keyword}"* sekarang otomatis masuk ke kategori *${saved.category}*.`;
  }

  if (sub === 'reload' || sub === 'refresh') {
    await categoryService.getCategoryMap({ forceRefresh: true });
    return '🔄 Cache kategori berhasil dimuat ulang dari Google Sheets.';
  }

  const map = await categoryService.getCategoryMap();
  if (map.size === 0) {
    return [
      'Belum ada aturan kategori otomatis di sheet Categories.',
      'Tambahkan langsung lewat chat:',
      '`/kategori tambah ayam Belanja`',
      '`/kategori tambah kopi Makanan`',
    ].join('\n');
  }

  const grouped = {};
  for (const [kw, cat] of map.entries()) {
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(kw);
  }

  const lines = ['*📂 Daftar Kategori Otomatis:*'];
  for (const [cat, keywords] of Object.entries(grouped)) {
    lines.push(`- *${cat}*: ${keywords.join(', ')}`);
  }
  lines.push('', '_Tambah baru: `/kategori tambah <kata> <Kategori>`_');
  return lines.join('\n');
}

