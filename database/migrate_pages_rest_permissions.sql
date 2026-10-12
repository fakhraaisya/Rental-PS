begin;

-- Grant the REST privileges required by the existing anon RLS policies.
-- This migration changes permissions only; it does not insert, update, or delete rows.
grant usage on schema public to anon;
grant select, insert, update, delete on
  public.pelanggan,
  public.tarif_konsol,
  public.unit_playstation,
  public.tarif_ruangan,
  public.ruangan,
  public.penyewaan,
  public.pembayaran
to anon;
grant select on public.v_laporan_pendapatan to anon;

notify pgrst, 'reload schema';
commit;