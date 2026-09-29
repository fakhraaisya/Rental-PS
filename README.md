# PlayVora

Sistem informasi akuntansi pendapatan sewa rental PlayStation dengan data pelanggan, konsol, ruangan, penyewaan, dan pembayaran:

- `pelanggan`
- `tarif_konsol`
- `unit_playstation`
- `tarif_ruangan`
- `ruangan`
- `penyewaan`
- `pembayaran`

## Setup Supabase

1. Buka **SQL Editor** pada project Supabase.
2. Untuk database baru, jalankan seluruh isi `database/schema.sql`. Script ini membuat tabel, relasi, view `v_laporan_pendapatan`, RLS, dan data demo.
3. Untuk database PlayVora yang sudah berisi unit dan rental, jalankan `database/migrate_rooms_and_inventory.sql` saja. Migrasi ini mempertahankan data lama, menambah 7 unit PS4, 7 unit PS5, 2 ruang Regular, dan 2 ruang VIP. Tarif PS yang sudah tersimpan tidak ditimpa.
4. Jangan jalankan ulang `schema.sql` pada database yang sudah berjalan hanya untuk mengubah tarif; script setup juga memiliki bagian kompatibilitas dan data demo.
5. Pastikan `frontend/script.js` menggunakan Project URL dan Published/Anon key dari Supabase. Jangan masukkan `service_role` key ke frontend.

```js
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_PUBLISHED_KEY = 'YOUR-PUBLISHABLE-OR-ANON-KEY';
```

Gunakan **Project URL** dan **Publishable/Anon key** dari menu Project Settings > API. Key ini memang dikirim ke browser; keamanan data bergantung pada RLS. Jangan pernah memakai secret/service-role key di frontend.

Schema juga menyiapkan index pencarian, trigger `updated_at`, constraint durasi/tarif/status, view laporan, policy RLS demo, serta data awal pelanggan, unit, penyewaan, dan pembayaran. Tarif aktif PS4/PS5 tetap Rp35.000/Rp50.000 per jam. Tarif tambahan ruang Regular Rp10.000/jam dan VIP Rp25.000/jam; memilih ruang bersifat opsional. Rental baru menyimpan snapshot tarif PS dan ruang, sedangkan transaksi lama tidak berubah. Dashboard/laporan hanya bertambah dari transaksi yang benar-benar dicatat.

## Halaman

- `index.html`: ringkasan dengan filter periode, grafik, status unit, sesi aktif, dan transaksi terbaru.
- `transaksi.html`: tambah, lihat, detail, hapus, pencarian, filter status, dan validasi unit tersedia.
- `unit.html`: kelola unit PlayStation, tarif per jam, dan status unit.
- `pelanggan.html`: tambah, hapus, pencarian, dan riwayat transaksi pelanggan.
- `pembayaran.html`: pencatatan pembayaran dan piutang otomatis.
- `laporan.html`: laporan periode dan cetak.

## Deploy Publik

Workflow `.github/workflows/deploy-pages.yml` menerbitkan isi folder `frontend/` secara otomatis setiap ada push ke branch `main`. Tidak ada server Node yang dijalankan di hosting publik.

Satu kali saja, buka **GitHub repository > Settings > Pages**, lalu pada **Build and deployment > Source** pilih **GitHub Actions**. Setelah itu push perubahan; workflow akan memperbarui:

`https://fakhraaisya.github.io/Rental-PS/`

Frontend memakai path relatif untuk file lokal dan mengakses Supabase REST API langsung dari browser.

## Akses Supabase Publik

Schema menyediakan policy `anon` untuk SELECT/INSERT/UPDATE/DELETE pada tabel operasional dan tarif, serta SELECT pada view `v_laporan_pendapatan`. Policy `USING (true)`/`WITH CHECK (true)` berarti siapa pun dapat mengubah atau menghapus data tanpa login. Ini mempertahankan operasi publik aplikasi, tetapi tidak cocok untuk data sensitif atau penggunaan produksi tanpa autentikasi. Jangan mengganti RLS dengan `service_role`.

Pastikan **Authentication > URL Configuration / Allowed URLs** atau pengaturan CORS project Supabase mengizinkan origin `https://fakhraaisya.github.io` jika project Anda membatasi origin.

## Menjalankan Lokal

Aplikasi dapat dijalankan lokal secara opsional dengan Node.js 18 atau lebih baru. Ini tidak diperlukan untuk GitHub Pages.

```powershell
npm.cmd start
```

Buka `http://localhost:3000` pada browser untuk pengembangan lokal.