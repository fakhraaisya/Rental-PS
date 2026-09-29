# Sistem Informasi Akuntansi Pendapatan Sewa Rental PlayStation – PlayVora

Tugas UTS mata kuliah **Pengkodean dan Pemrograman** – S1 Akuntansi.

🌐 **Demo website:** https://fakhraaisya.github.io/Rental-PS/

PlayVora merupakan web app sistem informasi akuntansi sederhana untuk mengelola kegiatan operasional dan pencatatan pendapatan pada usaha rental PlayStation. Sistem mencakup pengelolaan unit PlayStation, pelanggan, transaksi penyewaan, pembayaran, serta laporan pendapatan.

Data transaksi yang dicatat dalam sistem digunakan untuk menghitung total pendapatan, pembayaran yang telah diterima, piutang, dan ringkasan aktivitas rental yang ditampilkan pada Dashboard.

## Teknologi

| **Bagian** | **Teknologi** |
| ---------- | ------------- |
| Frontend | HTML, CSS, JavaScript murni |
| Backend | Node.js untuk pengembangan lokal |
| Database | Supabase PostgreSQL |
| Koneksi Database | Supabase REST API |
| Hosting | GitHub Pages |
| Ikon | Lucide Icons |
| Grafik | Chart.js |
| Bahasa | JavaScript |

## Fitur

| **Menu** | **Isi** |
| -------- | ------- |
| **Dashboard** | Ringkasan pendapatan, total transaksi, pelanggan, piutang, unit tersedia, unit disewa, unit perawatan, sesi rental aktif, transaksi terbaru, grafik pendapatan, dan ringkasan aktivitas |
| **Transaksi** | Mencatat transaksi penyewaan PlayStation, memilih pelanggan dan unit, menentukan durasi rental, menghitung total biaya, melihat detail transaksi, mengubah status, dan menghapus transaksi |
| **Unit PlayStation** | Mengelola data unit PlayStation, kode unit, nama unit, tipe konsol, tarif sewa, status unit, serta catatan |
| **Pelanggan** | Menambah, melihat, mengubah, menghapus, dan melihat riwayat transaksi pelanggan |
| **Pembayaran** | Mencatat pembayaran rental, melihat jumlah pembayaran, piutang, metode pembayaran, serta status pembayaran |
| **Laporan Pendapatan** | Menampilkan data transaksi, total pendapatan, total pembayaran, dan piutang berdasarkan periode tertentu |

## Dashboard

Dashboard PlayVora dirancang untuk memberikan gambaran kondisi usaha rental secara cepat.

Informasi yang ditampilkan meliputi:

- Pendapatan yang telah diterima
- Total nilai transaksi
- Total piutang
- Jumlah pelanggan
- Jumlah transaksi
- Total jam rental
- Rata-rata nilai transaksi
- Persentase pembayaran
- Jumlah unit tersedia
- Jumlah unit sedang disewa
- Jumlah unit dalam perawatan
- Sesi rental yang sedang berlangsung
- Transaksi terbaru
- Perkembangan pendapatan
- Ringkasan berdasarkan tipe konsol
- Ringkasan metode pembayaran
- Pelanggan dengan aktivitas transaksi tertinggi

Grafik pendapatan dapat ditampilkan berdasarkan beberapa periode:

- 7 Hari
- 30 Hari
- Bulan Ini
- All

## Aturan Tarif Rental

Tarif rental PlayVora menggunakan tarif per jam.

Tarif dibedakan berdasarkan **tipe konsol**, sehingga unit dengan tipe konsol yang sama menggunakan tarif yang sama.

Contoh:

- PS4 → Rp35.000/jam
- PS5 → Rp50.000/jam

Apabila terdapat beberapa unit PS4, seluruh unit PS4 menggunakan tarif PS4 yang sama. Begitu juga dengan seluruh unit PS5.

Total biaya penyewaan dihitung berdasarkan:

**Total Biaya = Durasi Rental × Tarif per Jam**

Contoh:

Pelanggan menyewa PS4 selama 3 jam dengan tarif Rp35.000/jam:

**3 × Rp35.000 = Rp105.000**

## Logika Akuntansi Pendapatan

Sistem PlayVora berfokus pada pencatatan pendapatan dari transaksi penyewaan PlayStation dan pembayaran pelanggan.

Secara sederhana:

| **Transaksi** | **Perhitungan/Pencatatan** |
| ------------- | --------------------------- |
| Penyewaan PlayStation | Durasi × tarif per jam = total biaya |
| Pembayaran penuh | Jumlah pembayaran = total biaya |
| Pembayaran sebagian | Jumlah pembayaran < total biaya, sehingga terdapat piutang |
| Belum melakukan pembayaran | Seluruh total biaya menjadi piutang |
| Pembayaran melebihi total biaya | Jumlah yang diperhitungkan tidak melebihi total biaya transaksi |

Sistem juga menghitung:

**Piutang = Total Biaya − Jumlah Pembayaran**

dengan nilai piutang tidak boleh kurang dari Rp0.

Informasi tersebut kemudian digunakan dalam Dashboard dan Laporan Pendapatan.

## Status Transaksi

Transaksi penyewaan memiliki beberapa status:

```text
Berlangsung ─────▶ Selesai
      │
      └──────────▶ Dibatalkan