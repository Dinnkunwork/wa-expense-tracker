# WA Expense Tracker

Pencatatan keuangan pribadi via WhatsApp -> Google Sheets. Single-user, tanpa autentikasi, biaya minim.

## Arsitektur

```
WhatsApp (Baileys) ──┐
Telegram (opsional) ─┼──> MessageController ──> CommandRouter / Parser
REST API (opsional) ─┘                              │
                                                      ▼
                                         ExpenseService / ReportService / CategoryService
                                                      │
                                                      ▼
                                          GoogleSheetsRepository (satu-satunya
                                          komponen yang bicara ke Google API)
                                                      │
                                                      ▼
                                              Google Sheets
```

Channel (WhatsApp dkk) hanya "pintu masuk/keluar" pesan teks. Semua business logic
ada di services, dan bisa dipakai ulang kalau nanti ditambah channel lain
(Telegram, REST API) tanpa mengubah kode inti.

## Struktur Folder

```
src/
  channels/       adapter tiap channel (whatsappChannel.js), harus ikuti kontrak ChannelAdapter
  controllers/     terima teks pesan, teruskan ke command/parser/service
  services/        business logic murni (expense, report, budget, category, scheduler)
  repositories/     satu-satunya lapisan yang bicara ke Google Sheets API
  parser/          regex parser -> fallback AI parser -> validasi zod
  commands/        router & handler perintah (/hari, /minggu, /bulan, /dana, /cari, /export, /jadwal, dll.)
  config/          baca .env
  utils/           logger, id generator, amount parser, expense type resolver, format rupiah
scripts/
  setup-sheet.js   bikin header sheet Transactions, Categories, & Settings otomatis
```

## Setup

### 1. Google Sheets + Service Account

1. Buat spreadsheet baru di Google Sheets, catat Spreadsheet ID-nya (bagian di URL).
2. Buka [Google Cloud Console](https://console.cloud.google.com/) -> buat project -> aktifkan **Google Sheets API**.
3. Buat **Service Account**, lalu buat key JSON untuk service account tsb.
4. Dari file JSON, ambil `client_email` dan `private_key`.
5. **Share spreadsheet** kamu ke email service account tsb (klik Share, paste email, beri akses Editor).

### 2. Konfigurasi

```bash
cp .env.example .env
```

Isi `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (biarkan `\n` apa adanya di dalam tanda kutip, jangan diganti newline asli).

Isi juga `WA_ALLOWED_NUMBERS` dengan nomor-nomor WhatsApp yang boleh mengirim transaksi (dipisah koma, format `62xxxxxxxxxx`, tanpa `0` di depan dan tanpa `+`), supaya orang di luar daftar itu tidak bisa kirim transaksi ke bot kamu. Lihat bagian **Multi-Nomor** di bawah untuk detail dan contoh nomor Indonesia.

`ANTHROPIC_API_KEY` opsional — hanya dipakai kalau regex parser gagal memahami pesan. Kalau kosong, AI parser otomatis dilewati dan pesan yang tidak dikenali regex akan diabaikan.

### 3. Install & jalankan setup sheet

```bash
npm install
node scripts/setup-sheet.js
```

Ini akan membuat header di sheet `Transactions` dan `Categories`. Isi manual beberapa baris awal di sheet `Categories`, contoh:

| Keyword | Category  |
|---------|-----------|
| ayam    | Belanja   |
| telur   | Belanja   |
| kopi    | Makanan   |
| bensin  | Transport |
| listrik | Tagihan   |

### 4. Jalankan bot

```bash
npm start
```

Scan QR code yang muncul di terminal pakai WhatsApp kamu (Linked Devices). Sesi login tersimpan di folder `auth_session/` sehingga tidak perlu scan ulang tiap restart.

## Cara Pakai

Kirim pesan biasa ke nomor WhatsApp yang sudah di-link (mendukung 1 baris atau banyak baris sekaligus dalam satu balon chat):

```
beli ayam 45000
kopi 18k #keinginan
kemarin isi bensin 100rb (motor suami)
```

### Jenis Pembelian / Pengeluaran (`Type`)
Setiap transaksi otomatis diklasifikasikan ke dalam salah satu jenis pengeluaran rumah tangga:
- **Kebutuhan** (belanja dapur, makan harian, bensin, obat, anak)
- **Tagihan** (listrik, air, internet/wifi, cicilan, sewa, BPJS, pulsa)
- **Keinginan** (kopi, jajan, nongkrong, hiburan, belanja sekunder)
- **Tabungan** (tabungan, investasi, emas, dana pendidikan)
- **Darurat** (pengeluaran mendadak / tak terduga)

Kamu juga bisa menentukan jenisnya secara eksplisit dengan hashtag di akhir pesan (`#kebutuhan`, `#tagihan`, `#keinginan`, `#tabungan`, `#darurat`) atau mengubahnya lewat `/edit`.

### Perintah Chat

```
# Laporan, Pencarian, & Export
/hari                           -> transaksi hari ini
/hari kemarin (atau /kemarin)   -> transaksi kemarin
/minggu (atau /pekan)           -> ringkasan minggu ini + sisa jatah mingguan
/minggu lalu                    -> ringkasan minggu lalu
/bulan                          -> ringkasan bulan ini (per jenis, pasangan, & kategori)
/bulan lalu (atau /bulanlalu)   -> ringkasan bulan lalu + perbandingan
/bulan oktober                  -> ringkasan bulan tertentu (atau /bulan 2026-10)
/cari listrik                   -> cari riwayat transaksi berdasarkan kata kunci
/cari #keinginan oleh=Suami     -> filter riwayat berdasarkan jenis/kategori/pasangan/bulan
/export (atau /csv)             -> ekspor transaksi bulan ini ke format CSV (atau /export lalu, /export semua)

# Jatah Dana & Sisa Anggaran (Mingguan / Bulanan / Per Jenis / Per Kategori)
/dana (atau /jatah)             -> cek sisa dana minggu ini & bulan ini + batas aman harian
/dana minggu 1.2jt              -> atur jatah pengeluaran mingguan Rp1.200.000
/dana bulan 5jt                 -> atur jatah pengeluaran bulanan Rp5.000.000
/dana keinginan 1jt             -> atur batas anggaran bulanan untuk jenis Keinginan
/dana kategori Makanan 1.5jt    -> atur batas anggaran bulanan untuk kategori Makanan
/dana tambah 500rb              -> tambah dana ekstra khusus untuk bulan ini
/dana reset                     -> reset dana ekstra bulan ini

# Edit & Pembatalan Transaksi
/undo (atau /batal)             -> batalkan/hapus transaksi terakhir tanpa ketik ID
/edit terakhir amount=50rb item=Ayam Bakar jenis=Keinginan
/edit TX-20260708-AB12 amount=50rb item=Ayam Goreng note=Makan berdua
/hapus TX-20260708-AB12         -> hapus transaksi berdasarkan ID (atau /hapus terakhir)

# Manajemen Pasangan (Suami & Istri), Kategori, & Laporan Otomatis
/pasangan                       -> lihat rekap pengeluaran Suami vs Istri
/pasangan saya Suami            -> tandai nomor WA kamu sebagai Suami
/pasangan saya Istri            -> tandai nomor WA kamu sebagai Istri
/kategori                       -> lihat daftar keyword kategori otomatis
/kategori tambah popok Anak     -> tambah keyword kategori otomatis langsung dari WA
/jadwal                         -> lihat & atur jadwal ringkasan otomatis (Senin pagi & tanggal 1 pagi)
/jadwal on / /jadwal off        -> aktifkan / nonaktifkan laporan otomatis terjadwal
/jadwal jam 8                   -> ubah jam pengiriman laporan otomatis (0-23)
/help                           -> tampilkan panduan lengkap
```

## Multi-Nomor (beberapa orang input transaksi)

Sistem ini tetap **single-instance** (satu bot, satu spreadsheet), tapi bisa menerima transaksi dari beberapa nomor WhatsApp sekaligus — cocok untuk pasangan, keluarga, atau tim kecil yang mencatat ke satu pembukuan bersama.

### Cara mengaktifkan

Isi `WA_ALLOWED_NUMBERS` di `.env` dengan daftar nomor dipisah koma, format internasional `62xxxxxxxxxx` (bukan `08xxxxxxxxxx`):

```bash
WA_ALLOWED_NUMBERS=6285178249700,628xxxxxxxxx,628yyyyyyyyy
```

Konversi nomor Indonesia: nomor `0851-7824-9700` menjadi `6285178249700` — cukup ganti `0` di depan dengan `62`, tanpa spasi/strip/tanda `+`. Restart bot setelah mengubah `.env`.

Kalau `WA_ALLOWED_NUMBERS` dikosongkan, bot menerima pesan dari **siapa saja** — tidak disarankan kecuali kamu sengaja ingin bot publik.

### Kenapa nomor lain sebelumnya ditolak

Nomor yang di-link ke sesi WhatsApp (`085178249700`) itu cuma **nomor tempat bot login**, bukan satu-satunya nomor yang boleh mengirim pesan. Yang menentukan siapa boleh input transaksi adalah `WA_ALLOWED_NUMBERS`. Sebelumnya karena env ini kosong/hanya berisi satu nomor, otomatis nomor lain ditolak dengan log `Pesan ditolak: nomor tidak ada di WA_ALLOWED_NUMBERS`.

### Membedakan siapa yang input apa

Karena semua nomor menulis ke sheet `Transactions` yang sama (tidak ada kolom user terpisah, sesuai desain single-user awal), bot otomatis menambahkan label pengirim ke kolom **Note**, misalnya:

```
Tanggal   : 2026-07-10
Item      : Kopi
Kategori  : Makanan
Nominal   : Rp18.000
Note      : via 6285178249700 (atau nama kontak kalau tersimpan di WhatsApp)
```

Fitur ini aktif secara default (`WA_TAG_SENDER_IN_NOTE=true`). Kalau tidak diperlukan, set ke `false` di `.env`.

> Kalau ke depannya butuh pemisahan lebih tegas per orang (mis. laporan pengeluaran per anggota keluarga), langkah alaminya adalah menambah kolom `Sender` di sheet `Transactions` dan `googleSheetsRepository.js` — beri tahu saya kalau mau saya buatkan.

## Testing

Unit test mencakup regex parser, orkestrasi parser, dan business logic `ExpenseService`/`CategoryService` — semuanya jalan tanpa perlu kredensial Google Sheets atau koneksi WhatsApp asli (pakai repository palsu di memori).

```bash
npm test
```

## Deployment dengan Docker (VPS)

1. Siapkan file `.env` di root project (lihat langkah **Konfigurasi** di atas). File ini **tidak** ikut masuk ke image, hanya di-mount lewat `env_file`.
2. Build & jalankan:

   ```bash
   cd docker
   docker compose up -d --build
   ```

3. Lihat log untuk scan QR pertama kali:

   ```bash
   docker compose logs -f wa-expense-tracker
   ```

4. Scan QR dari terminal seperti biasa. Sesi WhatsApp tersimpan di Docker volume `wa-auth-session`, jadi restart/redeploy container berikutnya **tidak** perlu scan ulang.
5. Cek kesehatan container:

   ```bash
   docker inspect --format='{{json .State.Health}}' wa-expense-tracker
   ```

Catatan keamanan: jangan pernah commit file `.env` ke Git (sudah ada di `.gitignore`), dan jangan tempel kredensial Google Service Account langsung di command line/shell history — selalu lewat file `.env` yang aksesnya dibatasi.

## Troubleshooting

### Error `statusCode: 405` / "Connection Failure" saat scan QR

Ini **bukan** masalah kredensial atau kode — ini berarti versi WhatsApp Web yang dipakai Baileys sudah ditolak oleh server WhatsApp (WhatsApp sering merilis versi baru, dan versi default yang dibundel di package Baileys bisa jadi sudah basi). Bot ini sudah menangani ini secara otomatis lewat `src/utils/waVersionResolver.js`, dengan urutan:

1. Override manual dari env `WA_BAILEYS_VERSION` (kalau diisi).
2. Ambil versi real-time dari WhatsApp Web (`fetchLatestWaWebVersion`).
3. Fallback ke metadata versi bawaan Baileys (`fetchLatestBaileysVersion`).
4. Kalau semua gagal, pakai default internal Baileys apa adanya.

Reconnect juga sudah pakai backoff (naik bertahap sampai maksimal 30 detik) supaya tidak spam handshake saat error berulang.

**Kalau error 405 masih terus muncul** meski sudah pakai langkah di atas (kadang terjadi di jam-jam awal setelah WhatsApp merilis versi baru, sebelum metadata Baileys ter-update):

1. Cari versi WA Web terbaru yang sedang dilaporkan berhasil oleh komunitas — cek [issue tracker Baileys](https://github.com/WhiskeySockets/Baileys/issues) untuk kata kunci "405".
2. Isi `WA_BAILEYS_VERSION=mayor,minor,build` di `.env` (mis. `WA_BAILEYS_VERSION=2,3000,1037641644`).
3. Restart bot.
4. Setelah WhatsApp Web/Baileys stabil kembali, override ini boleh dihapus lagi.

### Peringatan keamanan versi Baileys

`package.json` sengaja dipin ke `@whiskeysockets/baileys@6.7.23` (branch legacy yang **sudah dipatch** untuk kerentanan spoofing pesan [GHSA-qvv5-jq5g-4cgg](https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg)). Jangan turunkan ke versi `6.7.x` di bawah `6.7.22`, dan berhati-hati kalau ingin pindah ke branch `6.17.x` — per catatan resmi paket per Juli 2026, branch tersebut masih terpengaruh kerentanan yang sama. Branch `7.0.0-rc` terbaru juga sudah dipatch kalau suatu saat ingin migrasi ke versi mayor berikutnya, tapi statusnya masih release candidate.

## Menambah "Sheet Summary" untuk dashboard/grafik

Sesuai desain awal, backend **tidak menghitung laporan** untuk dashboard — itu tugas formula Google Sheets. Buat sheet baru bernama `Summary` lalu pakai formula seperti:

```
=SUMIFS(Transactions!E:E, Transactions!B:B, ">="&DATE(2026,7,1), Transactions!B:B, "<"&DATE(2026,8,1))
```

atau bikin Pivot Table dari range `Transactions!A:F`. `reportService.js` di backend hanya dipakai untuk balasan cepat `/hari` dan `/bulan` di chat, bukan untuk dashboard.

## Menambah Channel Baru (Telegram, REST API, dst)

1. Buat file baru di `src/channels/`, misal `telegramChannel.js`, yang meng-extend `ChannelAdapter` dan implement `start(onMessage)`.
2. Panggil `onMessage({ text, reply })` setiap ada pesan masuk.
3. Di `src/index.js`, tambahkan channel baru tsb sambil tetap memanggil `MessageController` yang sama.

Tidak ada satupun kode di `services/`, `repositories/`, atau `parser/` yang perlu diubah.

## Roadmap (sesuai dokumen spesifikasi)

- **Tahap 1 (sudah ada di kode ini):** tambah, lihat hari ini, total bulan, edit, hapus transaksi.
- **Tahap 2:** kategori otomatis (fondasinya sudah ada lewat `CategoryService` + sheet Categories), reminder tagihan, laporan bulanan lebih detail, grafik (lewat Google Sheets).
- **Tahap 3:** OCR struk belanja, voice note jadi transaksi, AI bahasa natural penuh (fondasi AI parser sudah ada), dashboard web.

## Migrasi dari Google Sheets ke SQLite/PostgreSQL (nanti)

Karena seluruh akses data lewat `GoogleSheetsRepository`, migrasi cukup dengan:

1. Buat `SqliteExpenseRepository` / `PostgresExpenseRepository` dengan method yang sama (`appendTransaction`, `findByDate`, `findByMonth`, `findById`, `updateById`, `deleteById`, `getCategoryMap`).
2. Ganti satu baris di `src/index.js`: `new GoogleSheetsRepository()` -> `new SqliteExpenseRepository()`.

Tidak ada perubahan di `services/`, `commands/`, `controllers/`, atau `parser/`.
