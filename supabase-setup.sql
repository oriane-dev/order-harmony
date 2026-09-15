-- ============================================================================
--  Cash Flow Management — préparation d'un projet Supabase VIERGE
--  À exécuter UNE SEULE FOIS par entreprise :
--    Supabase → (nouveau projet) → SQL Editor → New query → coller → Run.
--  Crée les 4 tables + le bucket de stockage des PDF, avec les mêmes règles
--  d'accès (clé anon) que l'outil utilise. Aucune donnée n'est insérée : la
--  base démarre vide, prête pour les imports CSV/PDF.
-- ============================================================================

-- ── 1. TABLES (blobs jsonb : 1 ligne = 1 commande / 1 fiche) ────────────────
create table if not exists public.orders (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_orders (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── 2. RÈGLES D'ACCÈS (RLS permissive, accès via la clé anon/publishable) ───
--  L'outil n'a pas de connexion utilisateur : la confidentialité repose sur le
--  fait que l'URL Netlify reste privée (même modèle que l'outil d'origine).
alter table public.orders           enable row level security;
alter table public.suppliers        enable row level security;
alter table public.customer_orders  enable row level security;
alter table public.customers        enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='orders anon access') then
    create policy "orders anon access" on public.orders for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='suppliers' and policyname='suppliers anon access') then
    create policy "suppliers anon access" on public.suppliers for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_orders' and policyname='customer_orders anon access') then
    create policy "customer_orders anon access" on public.customer_orders for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customers' and policyname='customers anon access') then
    create policy "customers anon access" on public.customers for all using (true) with check (true);
  end if;
end $$;

-- ── 3. STOCKAGE DES PDF (bucket public « Attachments PDF ») ──────────────────
insert into storage.buckets (id, name, public)
values ('Attachments PDF', 'Attachments PDF', true)
on conflict (id) do nothing;

--  Lecture publique + écriture/suppression via la clé anon, uniquement sur ce bucket.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Attachments PDF read') then
    create policy "Attachments PDF read"   on storage.objects for select using (bucket_id = 'Attachments PDF');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Attachments PDF insert') then
    create policy "Attachments PDF insert" on storage.objects for insert with check (bucket_id = 'Attachments PDF');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Attachments PDF update') then
    create policy "Attachments PDF update" on storage.objects for update using (bucket_id = 'Attachments PDF') with check (bucket_id = 'Attachments PDF');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Attachments PDF delete') then
    create policy "Attachments PDF delete" on storage.objects for delete using (bucket_id = 'Attachments PDF');
  end if;
end $$;

-- ── Terminé. La base est prête, vide, et l'outil peut s'y connecter. ─────────

-- ── 4. MISE À JOUR EN DIRECT (optionnel mais recommandé) ─────────────────────
--  Sans ça, les changements sont visibles pour tout le monde en RECHARGEANT la
--  page. Ceci ajoute la mise à jour automatique sans rechargement. Idempotent.
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
