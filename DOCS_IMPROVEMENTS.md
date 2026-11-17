# Dokumentasi Perubahan & Peningkatan (Improvements) — WA Expense Tracker

Dokumen ini merangkum seluruh perbaikan bug, peningkatan arsitektur/performa, serta fitur baru yang telah diimplementasikan pada project **`wa-expense-tracker`**, khususnya untuk kebutuhan **Manajemen Keuangan Pasangan Suami Istri**.

---

## 1. Ringkasan Fitur Baru (Manajemen Keuangan Suami & Istri)

### 1.1. Jatah Dana (Budget) Mingguan, Bulanan, Per Jenis, & Per Kategori + Sisa Dana Saat Ini
Fitur untuk mengatur jatah pengeluaran mingguan, bulanan, maupun batas spesifik per jenis/kategori dan memantau sisa anggaran secara *real-time*.
- **File terkait:**
  - [`src/services/budgetService.js`](./src/services/budgetService.js)
  - [`src/commands/handlers/budgetCommand.js`](./src/commands/handlers/budgetCommand.js)
  - [`src/services/reportService.js`](./src/services/reportService.js)
- **Kemampuan utama:**
  - Menyimpan jatah mingguan (`weekly_budget`), jatah bulanan (`monthly_budget`), tambahan dana bulan berjalan (`extra_monthly_YYYY-MM`), batas per jenis (`type_budget_<jenis>`), dan batas per kategori (`cat_budget_<kategori>`) secara persisten di sheet `Settings`.
  - Menghitung **Sisa Dana Saat Ini**, persentase pemakaian, serta **Batas Aman Pengeluaran Harian** (`sisa dana ÷ sisa hari`) untuk minggu dan bulan berjalan.
  - Menampilkan *footer* sisa dana otomatis setiap kali transaksi baru dicatat, lengkap dengan indikator visual (`💰` aman, `⚠️` pemakaian `>= 80%`, `🚨` *overbudget*).
- **Perintah Chat:**
  | Perintah | Fungsi |
  | :--- | :--- |
  | `/dana` (atau `/jatah`, `/budget`, `/saldo`) | Menampilkan status sisa dana minggu ini & bulan ini, batas jenis/kategori, batas aman harian, dan porsi pemakaian Suami vs Istri |
  | `/dana minggu 1.2jt` | Mengatur jatah pengeluaran mingguan sebesar Rp1.200.000 |
  | `/dana bulan 5jt` | Mengatur jatah pengeluaran bulanan sebesar Rp5.000.000 |
  | `/dana keinginan 1jt` | Mengatur batas anggaran bulanan untuk jenis pengeluaran tertentu (`Keinginan`, `Tagihan`, `Kebutuhan`, dll.) |
  | `/dana kategori Makanan 1.5jt` | Mengatur batas anggaran bulanan untuk kategori tertentu |
  | `/dana tambah 500rb` | Menambahkan dana ekstra khusus untuk bulan berjalan |
  | `/dana reset` | Mereset dana tambahan bulan berjalan ke Rp0 |

---

### 1.2. Manajemen Pasangan (Suami & Istri)
Membedakan dan merekap pengeluaran berdasarkan siapa yang melakukan transaksi (**Suami** vs **Istri**).
- **File terkait:**
  - [`src/commands/handlers/coupleCommand.js`](./src/commands/handlers/coupleCommand.js)
  - [`src/services/budgetService.js`](./src/services/budgetService.js)
  - [`src/config/config.js`](./src/config/config.js)
- **Kemampuan utama:**
  - Setiap nomor WhatsApp dapat dipetakan ke peran pasangan (`Suami` / `Istri`) langsung dari chat WhatsApp (tersimpan di sheet `Settings`) atau melalui environment variable `WA_COUPLE_ROLES` di `.env`.
  - Mendukung pencatatan di **Grup WhatsApp Pasangan** jika `WA_ALLOW_GROUPS=true` di `.env`, dengan tetap memvalidasi nomor anggota pengirim terhadap `WA_ALLOWED_NUMBERS`.
  - Kolom khusus `Sender` (Kolom H) di sheet `Transactions` mencatat siapa yang menginput transaksi.
- **Perintah Chat:**
  | Perintah | Fungsi |
  | :--- | :--- |
  | `/pasangan` | Menampilkan nomor pasangan terdaftar serta perbandingan pengeluaran Suami vs Istri di **Bulan Ini** dan **Bulan Lalu** |
  | `/pasangan saya Suami` | Menandai nomor pengirim saat ini sebagai **Suami** |
  | `/pasangan saya Istri` | Menandai nomor pengirim saat ini sebagai **Istri** |
  | `/pasangan set 628xxx Suami` | Menandai nomor WhatsApp tertentu sebagai **Suami** / **Istri** |

---

### 1.3. Klasifikasi Jenis Pembelian / Pengeluaran (`Type`)
Selain **Kategori** barang/jasa (`Makanan`, `Belanja`, `Transport`, `Tagihan`, `Anak`, dll.), setiap transaksi kini dikelompokkan berdasarkan **Sifat / Jenis Pengeluaran** rumah tangga.
- **File terkait:**
  - [`src/utils/expenseTypeResolver.js`](./src/utils/expenseTypeResolver.js)
  - [`src/parser/regexParser.js`](./src/parser/regexParser.js)
  - [`src/services/expenseService.js`](./src/services/expenseService.js)
- **5 Jenis Pengeluaran Standar:**
  1. **`Kebutuhan`** — Belanja dapur, beras, lauk, makan harian, bensin/transport kerja, obat, kebutuhan anak (alias: `#kebutuhan`, `#primer`, `#pokok`).
  2. **`Tagihan`** — Pengeluaran rutin/wajib bulanan seperti listrik, air/PDAM, internet/wifi, cicilan, KPR, sewa, BPJS, pulsa (alias: `#tagihan`, `#rutin`, `#wajib`, `#cicilan`).
  3. **`Keinginan`** — Jajan, kopi, boba, cemilan, nongkrong, bioskop, hiburan, hobi, belanja sekunder (alias: `#keinginan`, `#sekunder`, `#jajan`, `#hiburan`).
  4. **`Tabungan`** — Tabungan, investasi, reksadana, emas, dana pendidikan (alias: `#tabungan`, `#investasi`).
  5. **`Darurat`** — Biaya darurat/mendadak seperti servis mogok, IGD/rumah sakit (alias: `#darurat`, `#mendadak`).
- **Cara Kerja:**
  - **Otomatis:** Dikenali dari kata kunci item atau kategori (misal `"kopi 18k"` otomatis masuk `Keinginan`, `"bayar listrik 350rb"` otomatis masuk `Tagihan`, `"beli ayam 45rb"` otomatis masuk `Kebutuhan`).
  - **Manual via Hashtag / Key-Value:** Tambahkan `#keinginan`, `#tagihan`, `#kebutuhan`, atau `jenis=Keinginan` di pesan transaksi.

---

### 1.4. Laporan Lengkap: Bulan Ini, Bulan Lalu, Mingguan, & Harian
- **File terkait:**
  - [`src/services/reportService.js`](./src/services/reportService.js)
  - [`src/commands/handlers/monthCommand.js`](./src/commands/handlers/monthCommand.js)
  - [`src/commands/handlers/weekCommand.js`](./src/commands/handlers/weekCommand.js)
  - [`src/commands/handlers/todayCommand.js`](./src/commands/handlers/todayCommand.js)
- **Peningkatan Laporan:**
  - **Perbandingan Antar Bulan:** Saat membuka `/bulan` atau `/bulan lalu`, bot otomatis membandingkan total pengeluaran dengan bulan sebelumnya (menampilkan kenaikan `📈` atau penghematan `📉` dalam Rupiah dan persentase).
  - **3 Dimensi Breakdown:** Setiap laporan mingguan dan bulanan menampilkan rincian:
    1. **Per Jenis Pengeluaran** (`Kebutuhan`, `Tagihan`, `Keinginan`, `Tabungan`, `Darurat`) beserta persentase.
    2. **Per Pasangan/Pencatat** (`Suami`, `Istri`) beserta jumlah transaksi & persentase.
    3. **Per Kategori** (diurutkan dari pengeluaran terbesar ke terkecil).
- **Perintah Chat:**
  | Perintah | Fungsi |
  | :--- | :--- |
  | `/hari` | Daftar transaksi hari ini + sisa jatah dana |
  | `/hari kemarin` (atau `/kemarin`) | Daftar transaksi kemarin |
  | `/minggu` (atau `/pekan`) | Ringkasan pengeluaran minggu ini (Senin–Minggu) + sisa jatah mingguan |
  | `/minggu lalu` | Ringkasan pengeluaran minggu lalu |
  | `/bulan` | Ringkasan pengeluaran bulan ini + perbandingan dengan bulan lalu |
  | `/bulan lalu` (atau `/bulanlalu`) | Ringkasan pengeluaran bulan lalu + perbandingan dengan 2 bulan lalu |
  | `/bulan oktober` / `/bulan 2026-10` | Ringkasan pengeluaran pada bulan tertentu |

---

### 1.5. Pengeditan Fleksibel (`/edit`), Pembatalan Cepat (`/undo`), & Manajemen Kategori (`/kategori`)
- **File terkait:**
  - [`src/commands/handlers/editCommand.js`](./src/commands/handlers/editCommand.js)
  - [`src/commands/handlers/deleteCommand.js`](./src/commands/handlers/deleteCommand.js)
  - [`src/commands/handlers/categoryCommand.js`](./src/commands/handlers/categoryCommand.js)
- **Kemampuan baru:**
  - **Edit transaksi terakhir tanpa ketik ID:** `/edit terakhir amount=50rb item=Ayam Bakar Madu jenis=Keinginan`.
  - **Mendukung spasi pada nilai field:** Nilai seperti `item=Ayam Goreng Madu` atau `note=Makan malam berdua` kini terbaca utuh tanpa terpotong di spasi pertama.
  - **Mendukung format nominal singkat di `/edit`:** Bisa menulis `amount=50rb`, `nominal=1.5jt`, atau langsung `/edit TX-20261111-AB12 50rb`.
  - **Perintah `/undo` / `/batal`:** Menghapus transaksi terakhir yang baru dicatat tanpa perlu mencari/menyalin ID `TX-...`.
  - **Perintah `/kategori`:** Melihat semua aturan keyword kategori atau menambahkan keyword baru langsung dari WhatsApp (`/kategori tambah popok Anak`).

---

### 1.6. Pencarian Riwayat (`/cari`), Export CSV (`/export`), & Laporan Otomatis Terjadwal (`/jadwal`)
- **File terkait:**
  - [`src/commands/handlers/searchCommand.js`](./src/commands/handlers/searchCommand.js)
  - [`src/commands/handlers/scheduleCommand.js`](./src/commands/handlers/scheduleCommand.js)
  - [`src/services/schedulerService.js`](./src/services/schedulerService.js)
  - [`src/services/reportService.js`](./src/services/reportService.js)
- **Kemampuan utama:**
  - **Pencarian & Filter Multi-Dimensi (`/cari`):** Mencari transaksi berdasarkan kata kunci bebas dan/atau filter `bulan=...`, `jenis=...` (atau `#keinginan`), `kategori=...`, serta `oleh=Suami|Istri`.
  - **Export CSV Langsung di Chat (`/export` / `/csv`):** Mengekspor data transaksi bulan berjalan, bulan lalu, bulan tertentu, atau seluruh periode dalam format CSV.
  - **Ringkasan Otomatis Terjadwal (`/jadwal`):** Mengirimkan rekap pengeluaran otomatis setiap **Senin pagi** (rekap minggu lalu) dan setiap **tanggal 1 pagi** (rekap akhir bulan lalu) ke nomor WA pasangan yang terdaftar, dengan penyimpanan status idempoten di sheet `Settings` agar tidak terkirim ganda saat restart.
- **Perintah Chat:**
  | Perintah | Fungsi |
  | :--- | :--- |
  | `/cari <kata/filter>` | Cari transaksi (contoh: `/cari listrik`, `/cari kopi bulan=lalu`, `/cari #keinginan oleh=Suami`) |
  | `/export` (atau `/csv`) | Export CSV transaksi bulan ini (`/export lalu`, `/export oktober`, `/export semua`) |
  | `/jadwal` | Lihat status pengaturan laporan otomatis terjadwal |
  | `/jadwal on` / `/jadwal off` | Aktifkan atau matikan laporan otomatis terjadwal |
  | `/jadwal jam 8` | Atur jam pengiriman laporan otomatis (0–23) |
  | `/jadwal penerima 628xxx` | Tambah nomor WhatsApp penerima laporan otomatis |
  | `/jadwal kirim minggu\|bulan` | Uji/tampilkan rekap otomatis mingguan atau bulanan sekarang |

---

## 2. Perbaikan Bug & Peningkatan Teknis (Dari Hasil Code Review)

| Area | Kondisi Sebelumnya | Perbaikan yang Dilakukan | File yang Diubah |
| :--- | :--- | :--- | :--- |
| **Filter Angka Kecil di Chat Biasa** | Pesan seperti `"beli 2 kopi"` (tanpa harga) atau `"ketemu jam 7"` dianggap transaksi Rp2 atau Rp7 oleh regex parser. | Angka polos `< 100` tanpa prefix `Rp`, tanpa satuan (`rb`/`k`/`jt`), dan tanpa pemisah ribuan diabaikan, serta angka bagian dari tanggal (`10/11`) dilewati. | [`src/utils/amountParser.js`](./src/utils/amountParser.js) |
| **Penghapusan Token Nominal & Prefix `Rp`** | `text.replace(rawToken, '')` menghapus kemunculan pertama sehingga `"beli 20 telur 20rb"` merusak teks item, dan `"rp 45.000"` menyisakan `"Rp"` di nama item. | Menghapus token nominal berdasarkan posisi `index` yang presisi dari belakang serta menyertakan prefix opsional `rp`/`rp.`. | [`src/utils/amountParser.js`](./src/utils/amountParser.js), [`src/parser/regexParser.js`](./src/parser/regexParser.js) |
| **Tanggal Relatif & Catatan Inline** | Tanggal selalu dipaksa hari ini (`YYYY-MM-DD`) dan `note` dari regex selalu kosong. | Mendukung `"kemarin"`, `"kemarin lusa"`, `"3 hari lalu"`, tanggal eksplisit (`10/11` atau `2026-11-10`), serta catatan di dalam tanda kurung `(catatan...)`. | [`src/parser/regexParser.js`](./src/parser/regexParser.js), [`src/parser/aiParser.js`](./src/parser/aiParser.js) |
| **Batch Input Multi-Baris** | Kirim beberapa baris transaksi dalam 1 chat hanya mengambil nominal terakhir dan menggabungkan semua teks jadi 1 item. | Memecah pesan multi-baris dan mencatat setiap baris transaksi secara terpisah, lalu membalas dengan rekap gabungan. | [`src/controllers/messageController.js`](./src/controllers/messageController.js) |
| **Pembacaan Angka Terformat di Google Sheets** | `spreadsheets.values.get` memakai default `FORMATTED_VALUE`, sehingga sel berformat `Rp45.000` terbaca `NaN` -> `0`. | Menambahkan `valueRenderOption: 'UNFORMATTED_VALUE'` dan pembersih angka `parseRawAmount()`. | [`src/repositories/googleSheetsRepository.js`](./src/repositories/googleSheetsRepository.js) |
| **Caching Google Sheets API** | Setiap pesan masuk selalu memanggil API `Categories!A:B` dan setiap hapus selalu memanggil `spreadsheets.get`. | Menambahkan in-memory cache ber-TTL untuk `Categories`, `Settings`, serta cache `sheetId`. | [`src/services/categoryService.js`](./src/services/categoryService.js), [`src/repositories/googleSheetsRepository.js`](./src/repositories/googleSheetsRepository.js) |
| **Akurasi Pencocokan Kategori** | `itemLower.includes(keyword)` sesuai urutan baris bisa salah mencocokkan keyword pendek di dalam kata lain. | Mengurutkan keyword dari terpanjang (paling spesifik) ke terpendek dan memprioritaskan *word-boundary match*. | [`src/services/categoryService.js`](./src/services/categoryService.js) |
| **Penanganan JID WhatsApp & Reconnect** | Belum membersihkan listener socket lama saat reconnect, belum menangani device suffix (`:12`), `status@broadcast`, atau grup. | Membersihkan socket lama sebelum reconnect, mengekstrak nomor bersih dari JID pribadi/grup, mendukung `graceful shutdown` (`SIGINT`/`SIGTERM`). | [`src/channels/whatsappChannel.js`](./src/channels/whatsappChannel.js), [`src/index.js`](./src/index.js) |
| **Timezone & AI Timeout** | `config.timezone` belum diterapkan ke `process.env.TZ`; `fetch` ke Anthropic belum memiliki batas waktu (*timeout*). | Set `process.env.TZ = timezone` saat inisialisasi config dan tambahkan `AbortSignal.timeout(10_000)` pada AI parser. | [`src/config/config.js`](./src/config/config.js), [`src/parser/aiParser.js`](./src/parser/aiParser.js) |
| **Docker Healthcheck** | `HEALTHCHECK` hanya menjalankan `node -e "process.exit(0)"` yang selalu sukses walaupun sesi WA logout. | Menulis status koneksi ke file health sementara (`wa-expense-health.json`) dan mengeceknya di `HEALTHCHECK`. | [`docker/Dockerfile`](./docker/Dockerfile), [`src/channels/whatsappChannel.js`](./src/channels/whatsappChannel.js) |

---

## 3. Perubahan Struktur Google Sheets (100% Backward-Compatible)

1. **Sheet `Transactions` (`A:H`):**
   - Kolom `A` s/d `F` tetap sama persis seperti sebelumnya (`ID`, `Date`, `Item`, `Category`, `Amount`, `Note`) sehingga **seluruh data lama dan rumus yang sudah ada tetap berjalan normal**.
   - Ditambahkan 2 kolom baru di kanan:
     - **Kolom `G` (`Type`):** Jenis pengeluaran (`Kebutuhan`, `Tagihan`, `Keinginan`, `Tabungan`, `Darurat`). Baris lama yang kolom G-nya kosong otomatis dianggap `Kebutuhan`.
     - **Kolom `H` (`Sender`):** Nama/peran pencatat (`Suami`, `Istri`, atau nama pengirim). Baris lama yang kolom H-nya kosong otomatis diekstrak dari catatan `via ...` di kolom `Note`.
2. **Sheet `Categories` (`A:B`):**
   - `Keyword | Category` (kini bisa ditambah langsung lewat perintah `/kategori tambah <keyword> <kategori>`).
3. **Sheet `Settings` (`A:B` — Baru, dibuat otomatis):**
   - `Key | Value` untuk menyimpan pengaturan `monthly_budget`, `weekly_budget`, `extra_monthly_YYYY-MM`, dan `role_<nomorWA>` secara persisten.

---

## 4. Daftar File yang Ditambahkan / Diperbarui

### File Baru
- [`src/utils/expenseTypeResolver.js`](./src/utils/expenseTypeResolver.js) — Resolver & normalisasi jenis pembelian/pengeluaran.
- [`src/services/budgetService.js`](./src/services/budgetService.js) — Service pengelolaan jatah dana mingguan/bulanan/jenis/kategori & peran pasangan Suami/Istri.
- [`src/services/schedulerService.js`](./src/services/schedulerService.js) — Service pengiriman laporan otomatis terjadwal (mingguan & akhir bulan).
- [`src/commands/handlers/weekCommand.js`](./src/commands/handlers/weekCommand.js) — Handler perintah `/minggu` & `/minggu lalu`.
- [`src/commands/handlers/budgetCommand.js`](./src/commands/handlers/budgetCommand.js) — Handler perintah `/dana` / `/jatah` / `/budget`.
- [`src/commands/handlers/categoryCommand.js`](./src/commands/handlers/categoryCommand.js) — Handler perintah `/kategori`.
- [`src/commands/handlers/coupleCommand.js`](./src/commands/handlers/coupleCommand.js) — Handler perintah `/pasangan`.
- [`src/commands/handlers/searchCommand.js`](./src/commands/handlers/searchCommand.js) — Handler perintah `/cari` / `/search`.
- [`src/commands/handlers/scheduleCommand.js`](./src/commands/handlers/scheduleCommand.js) — Handler perintah `/jadwal` & `/export` (`/csv`).

### File yang Diperbarui
- [`src/index.js`](./src/index.js)
- [`src/config/config.js`](./src/config/config.js)
- [`src/channels/whatsappChannel.js`](./src/channels/whatsappChannel.js)
- [`src/controllers/messageController.js`](./src/controllers/messageController.js)
- [`src/commands/commandRouter.js`](./src/commands/commandRouter.js)
- [`src/commands/handlers/todayCommand.js`](./src/commands/handlers/todayCommand.js)
- [`src/commands/handlers/monthCommand.js`](./src/commands/handlers/monthCommand.js)
- [`src/commands/handlers/editCommand.js`](./src/commands/handlers/editCommand.js)
- [`src/commands/handlers/deleteCommand.js`](./src/commands/handlers/deleteCommand.js)
- [`src/commands/handlers/helpCommand.js`](./src/commands/handlers/helpCommand.js)
- [`src/parser/parser.js`](./src/parser/parser.js)
- [`src/parser/regexParser.js`](./src/parser/regexParser.js)
- [`src/parser/aiParser.js`](./src/parser/aiParser.js)
- [`src/services/categoryService.js`](./src/services/categoryService.js)
- [`src/services/expenseService.js`](./src/services/expenseService.js)
- [`src/services/reportService.js`](./src/services/reportService.js)
- [`src/repositories/googleSheetsRepository.js`](./src/repositories/googleSheetsRepository.js)
- [`src/utils/amountParser.js`](./src/utils/amountParser.js)
- [`scripts/setup-sheet.js`](./scripts/setup-sheet.js)
- [`docker/Dockerfile`](./docker/Dockerfile)
- [`.env.example`](./.env.example)
- [`README.md`](./README.md)
- [`tests/regexParser.test.js`](./tests/regexParser.test.js)
- [`tests/expenseService.test.js`](./tests/expenseService.test.js)

