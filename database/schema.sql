-- ============================================================
-- PLAYLEDGER | Sistem Informasi Akuntansi Pendapatan Sewa
-- ERD: pelanggan, unit_playstation, penyewaan, pembayaran
-- Jalankan seluruh script ini di Supabase SQL Editor.
-- ============================================================

create extension if not exists "pgcrypto";

-- 1. PELANGGAN
create table if not exists public.pelanggan (
  id uuid primary key default gen_random_uuid(),
  nama varchar(120) not null,
  nomor_telepon varchar(30),
  email varchar(150) unique,
  alamat text,
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pelanggan_nama_check check (length(trim(nama)) >= 2)
);

-- 2. TARIF PER TIPE KONSOL
create table if not exists public.tarif_konsol (
  tipe_konsol varchar(20) primary key,
  tarif_per_jam numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tarif_konsol_tipe_check check (tipe_konsol in ('PS4', 'PS5')),
  constraint tarif_konsol_harga_check check (tarif_per_jam > 0)
);

insert into public.tarif_konsol (tipe_konsol, tarif_per_jam) values
  ('PS4', 35000),
  ('PS5', 50000)
on conflict (tipe_konsol) do nothing;

-- 3. UNIT PLAYSTATION
create table if not exists public.unit_playstation (
  id uuid primary key default gen_random_uuid(),
  kode_unit varchar(30) not null unique,
  nama_unit varchar(100) not null,
  tipe_konsol varchar(20) not null,
  status varchar(20) not null default 'Tersedia',
  catatan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_tipe_check check (tipe_konsol in ('PS4', 'PS5')),
  constraint unit_status_check check (status in ('Tersedia', 'Disewa', 'Perawatan'))
);

alter table public.unit_playstation drop column if exists tarif_per_jam;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.unit_playstation'::regclass
      and conname = 'unit_tarif_konsol_fk'
  ) then
    alter table public.unit_playstation add constraint unit_tarif_konsol_fk
      foreign key (tipe_konsol) references public.tarif_konsol(tipe_konsol)
      on update cascade on delete restrict;
  end if;
end $$;

-- 4. TARIF DAN INVENTARIS RUANG
create table if not exists public.tarif_ruangan (
  tipe_ruangan varchar(20) primary key,
  tarif_per_jam numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tarif_ruangan_tipe_check check (tipe_ruangan in ('Regular', 'VIP')),
  constraint tarif_ruangan_harga_check check (tarif_per_jam > 0)
);

insert into public.tarif_ruangan (tipe_ruangan, tarif_per_jam) values
  ('Regular', 10000),
  ('VIP', 25000)
on conflict (tipe_ruangan) do nothing;

create table if not exists public.ruangan (
  id uuid primary key default gen_random_uuid(),
  kode_ruangan varchar(30) not null unique,
  nama_ruangan varchar(100) not null,
  tipe_ruangan varchar(20) not null references public.tarif_ruangan(tipe_ruangan) on update cascade on delete restrict,
  status varchar(20) not null default 'Tersedia',
  catatan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ruangan_status_check check (status in ('Tersedia', 'Disewa', 'Perawatan'))
);

insert into public.ruangan (kode_ruangan, nama_ruangan, tipe_ruangan, status) values
  ('REG-01', 'Ruang Regular 1', 'Regular', 'Tersedia'),
  ('REG-02', 'Ruang Regular 2', 'Regular', 'Tersedia'),
  ('VIP-01', 'Ruang VIP 1', 'VIP', 'Tersedia'),
  ('VIP-02', 'Ruang VIP 2', 'VIP', 'Tersedia')
on conflict (kode_ruangan) do nothing;

-- 5. PENYEWAAN
create table if not exists public.penyewaan (
  id uuid primary key default gen_random_uuid(),
  kode_penyewaan varchar(30) not null unique,
  pelanggan_id uuid not null references public.pelanggan(id) on delete restrict,
  unit_id uuid not null references public.unit_playstation(id) on delete restrict,
  ruangan_id uuid references public.ruangan(id) on delete restrict,
  mulai_sewa timestamptz not null default now(),
  selesai_sewa timestamptz,
  durasi_jam numeric(6, 2) not null,
  tarif_per_jam numeric(12, 2) not null,
  tarif_ruangan_per_jam numeric(12, 2) not null default 0,
  total_biaya numeric(12, 2) not null,
  status varchar(20) not null default 'Berlangsung',
  catatan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sewa_durasi_check check (durasi_jam > 0),
  constraint sewa_tarif_check check (tarif_per_jam > 0),
  constraint sewa_tarif_ruangan_check check (tarif_ruangan_per_jam >= 0),
  constraint sewa_total_check check (total_biaya = round(durasi_jam * (tarif_per_jam + tarif_ruangan_per_jam), 2)),
  constraint sewa_status_check check (status in ('Berlangsung', 'Selesai', 'Dibatalkan')),
  constraint sewa_waktu_check check (selesai_sewa is null or selesai_sewa >= mulai_sewa)
);

-- 6. PEMBAYARAN, maksimal satu pembayaran per penyewaan
create table if not exists public.pembayaran (
  id uuid primary key default gen_random_uuid(),
  penyewaan_id uuid not null constraint pembayaran_penyewaan_fk references public.penyewaan(id) on delete cascade unique,
  jumlah_bayar numeric(12, 2) not null,
  metode_pembayaran varchar(20) not null,
  status_pembayaran varchar(20) not null default 'Belum Lunas',
  tanggal_bayar timestamptz not null default now(),
  catatan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bayar_jumlah_check check (jumlah_bayar >= 0),
  constraint bayar_metode_check check (metode_pembayaran in ('Tunai', 'QRIS', 'Transfer', 'Debit')),
  constraint bayar_status_check check (status_pembayaran in ('Lunas', 'Sebagian', 'Belum Lunas'))
);

-- Kompatibilitas database lama:
-- versi sebelumnya memakai pembayaran.transaksi_id yang menunjuk transaksi_sewa.
-- Data pembayaran lama dibersihkan karena tidak dapat dipetakan secara aman
-- ke penyewaan baru; data demo pembayaran akan diisi ulang di bawah.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pembayaran' and column_name = 'transaksi_id'
  ) then
    alter table public.pembayaran drop constraint if exists pembayaran_transaksi_fk;
    alter table public.pembayaran drop constraint if exists pembayaran_transaksi_unique;
    delete from public.pembayaran;
    alter table public.pembayaran rename column transaksi_id to penyewaan_id;
  end if;
end $$;

alter table public.pembayaran add column if not exists penyewaan_id uuid;
-- Hapus FK legacy apa pun yang masih menunjuk transaksi_sewa.
-- Nama constraint dapat berbeda-beda tergantung versi schema sebelumnya.
do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.pembayaran'::regclass
      and c.confrelid = 'public.transaksi_sewa'::regclass
  loop
    execute format('alter table public.pembayaran drop constraint if exists %I', legacy_constraint.conname);
  end loop;
end $$;
create unique index if not exists idx_pembayaran_penyewaan_unique on public.pembayaran (penyewaan_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pembayaran_penyewaan_fk') then
    alter table public.pembayaran add constraint pembayaran_penyewaan_fk
      foreign key (penyewaan_id) references public.penyewaan(id) on delete cascade;
  end if;
end $$;

create unique index if not exists idx_pelanggan_email_exact_unique
  on public.pelanggan (email) where email is not null;

-- Index
create index if not exists idx_pelanggan_nama on public.pelanggan (nama);
create index if not exists idx_unit_status on public.unit_playstation (status);
create index if not exists idx_ruangan_status on public.ruangan (status);
create index if not exists idx_sewa_mulai on public.penyewaan (mulai_sewa desc);
create index if not exists idx_sewa_status on public.penyewaan (status);
create index if not exists idx_sewa_pelanggan on public.penyewaan (pelanggan_id);
create index if not exists idx_sewa_unit on public.penyewaan (unit_id);
create unique index if not exists idx_sewa_ruangan_aktif_unique
  on public.penyewaan (ruangan_id) where ruangan_id is not null and status = 'Berlangsung';
create index if not exists idx_bayar_tanggal on public.pembayaran (tanggal_bayar desc);

-- updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pelanggan_set_updated_at on public.pelanggan;
create trigger pelanggan_set_updated_at before update on public.pelanggan for each row execute function public.set_updated_at();
drop trigger if exists tarif_konsol_set_updated_at on public.tarif_konsol;
create trigger tarif_konsol_set_updated_at before update on public.tarif_konsol for each row execute function public.set_updated_at();
drop trigger if exists unit_set_updated_at on public.unit_playstation;
create trigger unit_set_updated_at before update on public.unit_playstation for each row execute function public.set_updated_at();
drop trigger if exists tarif_ruangan_set_updated_at on public.tarif_ruangan;
create trigger tarif_ruangan_set_updated_at before update on public.tarif_ruangan for each row execute function public.set_updated_at();
drop trigger if exists ruangan_set_updated_at on public.ruangan;
create trigger ruangan_set_updated_at before update on public.ruangan for each row execute function public.set_updated_at();
drop trigger if exists sewa_set_updated_at on public.penyewaan;
create trigger sewa_set_updated_at before update on public.penyewaan for each row execute function public.set_updated_at();
drop trigger if exists bayar_set_updated_at on public.pembayaran;
create trigger bayar_set_updated_at before update on public.pembayaran for each row execute function public.set_updated_at();

create or replace function public.set_rental_console_tariff()
returns trigger language plpgsql as $$
declare
  console_rate numeric(12, 2);
  room_rate numeric(12, 2) := 0;
  room_type varchar(20);
begin
  select t.tarif_per_jam into console_rate
  from public.unit_playstation u
  join public.tarif_konsol t on t.tipe_konsol = u.tipe_konsol
  where u.id = new.unit_id;

  if console_rate is null then
    raise exception 'Tarif untuk tipe konsol unit tidak ditemukan.';
  end if;

  if new.ruangan_id is not null then
    select r.tipe_ruangan into room_type
    from public.ruangan r
    where r.id = new.ruangan_id and r.status = 'Tersedia';

    if room_type is null then
      raise exception 'Ruangan tidak tersedia.';
    end if;

    select t.tarif_per_jam into room_rate
    from public.tarif_ruangan t
    where t.tipe_ruangan = room_type;

    if room_rate is null then
      raise exception 'Tarif ruangan tidak ditemukan.';
    end if;
  end if;

  new.tarif_per_jam = console_rate;
  new.tarif_ruangan_per_jam = room_rate;
  new.total_biaya = round(new.durasi_jam * (console_rate + room_rate), 2);
  return new;
end;
$$;

drop trigger if exists sewa_set_console_tariff on public.penyewaan;
create trigger sewa_set_console_tariff before insert on public.penyewaan
for each row execute function public.set_rental_console_tariff();

-- View laporan siap pakai
create or replace view public.v_laporan_pendapatan as
select
  s.id,
  s.kode_penyewaan,
  s.mulai_sewa,
  s.selesai_sewa,
  s.durasi_jam,
  s.tarif_per_jam,
  s.total_biaya,
  s.status,
  p.id as pelanggan_id,
  p.nama as nama_pelanggan,
  p.nomor_telepon,
  u.id as unit_id,
  u.kode_unit,
  u.nama_unit,
  u.tipe_konsol,
  coalesce(b.jumlah_bayar, 0) as jumlah_bayar,
  greatest(s.total_biaya - coalesce(b.jumlah_bayar, 0), 0) as piutang,
  coalesce(b.status_pembayaran, 'Belum Lunas') as status_pembayaran,
  b.metode_pembayaran,
  b.tanggal_bayar,
  s.tarif_ruangan_per_jam,
  r.id as ruangan_id,
  r.kode_ruangan,
  r.nama_ruangan,
  r.tipe_ruangan
from public.penyewaan s
join public.pelanggan p on p.id = s.pelanggan_id
join public.unit_playstation u on u.id = s.unit_id
left join public.ruangan r on r.id = s.ruangan_id
left join public.pembayaran b on b.penyewaan_id = s.id;

-- Demo awal untuk presentasi. Seluruh perhitungan aplikasi tetap membaca data Supabase.
insert into public.pelanggan (nama, nomor_telepon, email, alamat) values
  ('Rizky Pratama', '081298765432', 'rizky@example.com', 'Jl. Mawar No. 4'),
  ('Nadia Putri', '082112223333', 'nadia@example.com', 'Jl. Melati No. 8'),
  ('Dimas Saputra', '085677889900', 'dimas@example.com', 'Jl. Kenanga No. 2'),
  ('Salsa Amelia', '089512345678', 'salsa@example.com', 'Jl. Cempaka No. 15'),
  ('Fajar Ramadhan', '081377889911', 'fajar@example.com', 'Jl. Anggrek No. 12'),
  ('Aulia Rahma', '082233445566', 'aulia@example.com', 'Jl. Flamboyan No. 7'),
  ('Bagas Nugroho', '085811223344', 'bagas@example.com', 'Jl. Dahlia No. 19'),
  ('Intan Permata', '088812345679', 'intan@example.com', 'Jl. Teratai No. 6'),
  ('Yoga Prasetyo', '081900112233', 'yoga@example.com', 'Jl. Kamboja No. 3'),
  ('Maya Sari', '082244668899', 'maya@example.com', 'Jl. Bougenville No. 21'),
  ('Rafi Akbar', '085733221100', 'rafi@example.com', 'Jl. Sakura No. 11'),
  ('Citra Lestari', '089677889900', 'citra@example.com', 'Jl. Nusa Indah No. 5'),
  ('Hendra Wijaya', '081288990011', 'hendra@example.com', 'Jl. Puspa No. 14'),
  ('Laras Ayu', '082177665544', 'laras@example.com', 'Jl. Kutilang No. 9'),
  ('Pelanggan Baru', '081234567890', 'demo@playledger.local', 'Jl. Merdeka No. 10')
on conflict do nothing;

insert into public.unit_playstation (kode_unit, nama_unit, tipe_konsol, status, catatan) values
  ('PS4-01', 'PlayStation 4 Alpha', 'PS4', 'Tersedia', 'Kondisi sangat baik'),
  ('PS4-02', 'PlayStation 4 Beta', 'PS4', 'Disewa', 'Sedang digunakan'),
  ('PS4-03', 'PlayStation 4 Gamma', 'PS4', 'Tersedia', 'Dua controller'),
  ('PS4-04', 'PlayStation 4 Delta', 'PS4', 'Perawatan', 'Pembersihan rutin'),
  ('PS5-01', 'PlayStation 5 Alpha', 'PS5', 'Tersedia', 'DualSense tersedia'),
  ('PS5-02', 'PlayStation 5 Beta', 'PS5', 'Disewa', 'Sedang digunakan'),
  ('PS5-03', 'PlayStation 5 Gamma', 'PS5', 'Tersedia', 'Ruang VIP'),
  ('PS5-04', 'PlayStation 5 Delta', 'PS5', 'Tersedia', 'DualSense tersedia'),
  ('PS4-05', 'PlayStation 4 Epsilon', 'PS4', 'Tersedia', 'Unit tambahan'),
  ('PS4-06', 'PlayStation 4 Zeta', 'PS4', 'Tersedia', 'Unit tambahan'),
  ('PS4-07', 'PlayStation 4 Eta', 'PS4', 'Tersedia', 'Unit tambahan'),
  ('PS4-08', 'PlayStation 4 Theta', 'PS4', 'Tersedia', 'Unit tambahan'),
  ('PS4-09', 'PlayStation 4 Iota', 'PS4', 'Tersedia', 'Unit tambahan'),
  ('PS4-10', 'PlayStation 4 Kappa', 'PS4', 'Tersedia', 'Unit tambahan'),
  ('PS4-11', 'PlayStation 4 Lambda', 'PS4', 'Tersedia', 'Unit tambahan'),
  ('PS5-05', 'PlayStation 5 Epsilon', 'PS5', 'Tersedia', 'Unit tambahan'),
  ('PS5-06', 'PlayStation 5 Zeta', 'PS5', 'Tersedia', 'Unit tambahan'),
  ('PS5-07', 'PlayStation 5 Eta', 'PS5', 'Tersedia', 'Unit tambahan'),
  ('PS5-08', 'PlayStation 5 Theta', 'PS5', 'Tersedia', 'Unit tambahan'),
  ('PS5-09', 'PlayStation 5 Iota', 'PS5', 'Tersedia', 'Unit tambahan'),
  ('PS5-10', 'PlayStation 5 Kappa', 'PS5', 'Tersedia', 'Unit tambahan'),
  ('PS5-11', 'PlayStation 5 Lambda', 'PS5', 'Tersedia', 'Unit tambahan')
on conflict do nothing;

insert into public.penyewaan
  (kode_penyewaan, pelanggan_id, unit_id, mulai_sewa, selesai_sewa, durasi_jam, tarif_per_jam, total_biaya, status, catatan)
select d.kode, p.id, u.id, d.mulai_sewa, d.selesai_sewa, d.durasi, t.tarif_per_jam,
       round(d.durasi * t.tarif_per_jam, 2), d.status, d.catatan
from (values
  ('SEWA-001', 'rizky@example.com', 'PS4-01', now() - interval '1 day', now() - interval '1 day' + interval '2 hours', 2.0, 'Selesai', 'Sesi sore'),
  ('SEWA-002', 'nadia@example.com', 'PS5-01', now() - interval '2 days', now() - interval '2 days' + interval '3 hours', 3.0, 'Selesai', 'Sesi premium'),
  ('SEWA-003', 'dimas@example.com', 'PS4-02', now() - interval '2 hours', null, 2.0, 'Berlangsung', 'Sesi aktif'),
  ('SEWA-004', 'salsa@example.com', 'PS5-02', now() - interval '3 days', now() - interval '3 days' + interval '4 hours', 4.0, 'Selesai', 'Main bersama teman'),
  ('SEWA-005', 'fajar@example.com', 'PS4-03', now() - interval '5 days', now() - interval '5 days' + interval '2 hours', 2.0, 'Selesai', 'Sesi santai'),
  ('SEWA-006', 'aulia@example.com', 'PS5-03', now() - interval '7 days', now() - interval '7 days' + interval '3 hours', 3.0, 'Selesai', 'Ruang VIP'),
  ('SEWA-007', 'bagas@example.com', 'PS4-01', now() - interval '9 days', now() - interval '9 days' + interval '2 hours', 2.0, 'Selesai', 'Sesi malam'),
  ('SEWA-008', 'intan@example.com', 'PS5-04', now() - interval '12 days', now() - interval '12 days' + interval '4 hours', 4.0, 'Selesai', 'Gaming weekend'),
  ('SEWA-009', 'yoga@example.com', 'PS4-03', now() - interval '15 days', now() - interval '15 days' + interval '2 hours', 2.0, 'Selesai', 'Sesi siang'),
  ('SEWA-010', 'maya@example.com', 'PS5-01', now() - interval '18 days', now() - interval '18 days' + interval '3 hours', 3.0, 'Selesai', 'Sesi keluarga'),
  ('SEWA-011', 'rafi@example.com', 'PS5-03', now() - interval '22 days', now() - interval '22 days' + interval '2 hours', 2.0, 'Selesai', 'Sesi VIP'),
  ('SEWA-012', 'citra@example.com', 'PS4-01', now() - interval '25 days', now() - interval '25 days' + interval '3 hours', 3.0, 'Selesai', 'Sesi reguler')
) as d(kode, email, kode_unit, mulai_sewa, selesai_sewa, durasi, status, catatan)
join public.pelanggan p on p.email = d.email
join public.unit_playstation u on u.kode_unit = d.kode_unit
join public.tarif_konsol t on t.tipe_konsol = u.tipe_konsol
on conflict do nothing;

insert into public.pembayaran (penyewaan_id, jumlah_bayar, metode_pembayaran, status_pembayaran, tanggal_bayar, catatan)
select s.id, case when s.kode_penyewaan = 'SEWA-003' then 30000 else s.total_biaya end,
       case when s.kode_penyewaan in ('SEWA-002', 'SEWA-006') then 'QRIS' else 'Tunai' end,
       case when s.kode_penyewaan = 'SEWA-003' then 'Sebagian' else 'Lunas' end,
       s.mulai_sewa, 'Pembayaran demo untuk laporan'
from public.penyewaan s
where s.kode_penyewaan like 'SEWA-%'
on conflict do nothing;

update public.unit_playstation set status = 'Disewa' where kode_unit in ('PS4-02', 'PS5-02');
update public.unit_playstation set status = 'Perawatan' where kode_unit = 'PS4-04';

-- RLS demo publik. Untuk production, ganti policy dengan autentikasi pengguna.
alter table public.pelanggan enable row level security;
alter table public.tarif_konsol enable row level security;
alter table public.unit_playstation enable row level security;
alter table public.tarif_ruangan enable row level security;
alter table public.ruangan enable row level security;
alter table public.penyewaan enable row level security;
alter table public.pembayaran enable row level security;

drop policy if exists "anon pelanggan all" on public.pelanggan;
create policy "anon pelanggan all" on public.pelanggan for all to anon using (true) with check (true);
drop policy if exists "anon tarif konsol all" on public.tarif_konsol;
create policy "anon tarif konsol all" on public.tarif_konsol for all to anon using (true) with check (true);
drop policy if exists "anon tarif ruangan all" on public.tarif_ruangan;
create policy "anon tarif ruangan all" on public.tarif_ruangan for all to anon using (true) with check (true);
drop policy if exists "anon ruangan all" on public.ruangan;
create policy "anon ruangan all" on public.ruangan for all to anon using (true) with check (true);
drop policy if exists "anon unit all" on public.unit_playstation;
create policy "anon unit all" on public.unit_playstation for all to anon using (true) with check (true);
drop policy if exists "anon penyewaan all" on public.penyewaan;
create policy "anon penyewaan all" on public.penyewaan for all to anon using (true) with check (true);
drop policy if exists "anon pembayaran all" on public.pembayaran;
create policy "anon pembayaran all" on public.pembayaran for all to anon using (true) with check (true);
grant select on public.v_laporan_pendapatan to anon;
grant select, insert, update, delete on public.tarif_konsol to anon;
grant select, insert, update, delete on public.tarif_ruangan, public.ruangan to anon;

-- Verifikasi:
-- select count(*) from public.pelanggan;
-- select count(*) from public.unit_playstation;
-- select * from public.v_laporan_pendapatan order by mulai_sewa desc;
