# PlayVora

Sistem informasi akuntansi pendapatan sewa rental PlayStation dengan empat entitas:

- `pelanggan`
- `unit_playstation`
- `penyewaan`
- `pembayaran`

## Setup Supabase

1. Buka **SQL Editor** pada project Supabase.
2. Jalankan seluruh isi `database/schema.sql`. Script ini membuat tabel, relasi, view `v_laporan_pendapatan`, RLS, dan data demo.
3. Jika database lama masih berisi tabel `paket_sewa` atau `transaksi_sewa`, jalankan schema baru ini pada project yang benar lalu refresh API Supabase.
4. Buka `backend/app.js`, lalu pastikan konfigurasi berikut memakai project Anda:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_PUBLISHED_KEY = 'YOUR-PUBLISHED-KEY';
```

Gunakan **Project URL** dan **Published Key** dari menu Project Settings > API. Published Key memang aman digunakan pada aplikasi publik, sedangkan secret/service-role key tidak boleh dimasukkan ke file ini.

Schema juga menyiapkan index pencarian, trigger `updated_at`, constraint durasi/tarif/status, view laporan, policy RLS demo, serta data awal pelanggan, unit, penyewaan, dan pembayaran. Seluruh angka dashboard dibaca dari Supabase, bukan dari hardcode frontend.

## Halaman

- `index.html`: ringkasan dengan filter periode, grafik, status unit, sesi aktif, dan transaksi terbaru.
- `transaksi.html`: tambah, lihat, detail, hapus, pencarian, filter status, dan validasi unit tersedia.
- `unit.html`: kelola unit PlayStation, tarif per jam, dan status unit.
- `pelanggan.html`: tambah, hapus, pencarian, dan riwayat transaksi pelanggan.
- `pembayaran.html`: pencatatan pembayaran dan piutang otomatis.
- `laporan.html`: laporan periode dan cetak.

## Menjalankan

Aplikasi memakai Node.js 18 atau lebih baru karena menggunakan `fetch` bawaan, dan tidak membutuhkan `package.json` atau instalasi dependency.

```powershell
node backend/app.js
```

Buka `http://localhost:3000` pada browser.