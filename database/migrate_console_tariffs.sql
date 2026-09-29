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

-- Keep every unit row; only remove its obsolete individual rate.
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

create or replace function public.set_rental_console_tariff()
returns trigger language plpgsql as $$
declare
  console_rate numeric(12, 2);
begin
  select t.tarif_per_jam into console_rate
  from public.unit_playstation u
  join public.tarif_konsol t on t.tipe_konsol = u.tipe_konsol
  where u.id = new.unit_id;

  if console_rate is null then
    raise exception 'Tarif untuk tipe konsol unit tidak ditemukan.';
  end if;

  new.tarif_per_jam = console_rate;
  new.total_biaya = round(new.durasi_jam * console_rate, 2);
  return new;
end;
$$;

drop trigger if exists sewa_set_console_tariff on public.penyewaan;
create trigger sewa_set_console_tariff before insert on public.penyewaan
for each row execute function public.set_rental_console_tariff();

alter table public.tarif_konsol enable row level security;
drop policy if exists "anon tarif konsol all" on public.tarif_konsol;
create policy "anon tarif konsol all" on public.tarif_konsol
for all to anon using (true) with check (true);
grant select, insert, update, delete on public.tarif_konsol to anon;

notify pgrst, 'reload schema';
commit;
