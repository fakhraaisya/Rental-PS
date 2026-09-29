begin;

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

insert into public.unit_playstation (kode_unit, nama_unit, tipe_konsol, status, catatan) values
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
on conflict (kode_unit) do nothing;

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

alter table public.penyewaan
  add column if not exists ruangan_id uuid references public.ruangan(id) on delete restrict,
  add column if not exists tarif_ruangan_per_jam numeric(12, 2) not null default 0;

alter table public.penyewaan drop constraint if exists sewa_total_check;
alter table public.penyewaan add constraint sewa_total_check
  check (total_biaya = round(durasi_jam * (tarif_per_jam + tarif_ruangan_per_jam), 2));
alter table public.penyewaan drop constraint if exists sewa_tarif_ruangan_check;
alter table public.penyewaan add constraint sewa_tarif_ruangan_check
  check (tarif_ruangan_per_jam >= 0);
create unique index if not exists idx_sewa_ruangan_aktif_unique
  on public.penyewaan (ruangan_id) where ruangan_id is not null and status = 'Berlangsung';

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tarif_konsol_set_updated_at on public.tarif_konsol;
create trigger tarif_konsol_set_updated_at before update on public.tarif_konsol
for each row execute function public.set_updated_at();
drop trigger if exists tarif_ruangan_set_updated_at on public.tarif_ruangan;
create trigger tarif_ruangan_set_updated_at before update on public.tarif_ruangan
for each row execute function public.set_updated_at();
drop trigger if exists ruangan_set_updated_at on public.ruangan;
create trigger ruangan_set_updated_at before update on public.ruangan
for each row execute function public.set_updated_at();

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
    raise exception 'Tarif tipe konsol unit tidak ditemukan.';
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

alter table public.tarif_konsol enable row level security;
alter table public.tarif_ruangan enable row level security;
alter table public.ruangan enable row level security;
drop policy if exists "anon tarif konsol all" on public.tarif_konsol;
create policy "anon tarif konsol all" on public.tarif_konsol
for all to anon using (true) with check (true);
drop policy if exists "anon tarif ruangan all" on public.tarif_ruangan;
create policy "anon tarif ruangan all" on public.tarif_ruangan
for all to anon using (true) with check (true);
drop policy if exists "anon ruangan all" on public.ruangan;
create policy "anon ruangan all" on public.ruangan
for all to anon using (true) with check (true);
grant select, insert, update, delete on public.tarif_ruangan, public.ruangan to anon;
grant select, insert, update, delete on public.tarif_konsol to anon;
grant select on public.v_laporan_pendapatan to anon;

notify pgrst, 'reload schema';
commit;
