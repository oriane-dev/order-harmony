-- ============================================================================
--  Active la mise à jour EN DIRECT (sans recharger la page) entre tous les
--  ordinateurs. À exécuter UNE FOIS : Supabase → SQL Editor → New query → Run.
--  Sans ça, les changements restent visibles pour tout le monde en RECHARGEANT
--  la page (les données sont partagées) ; ceci ajoute juste la mise à jour
--  automatique sans rechargement.
--  Idempotent : peut être relancé sans risque.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['orders', 'suppliers', 'customer_orders', 'customers'] loop
    if to_regclass('public.' || t) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
