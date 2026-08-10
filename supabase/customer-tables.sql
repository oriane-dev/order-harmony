-- Crée les deux tables du côté "clients" (ventes), en miroir de `orders` / `suppliers`.
-- À exécuter une seule fois dans Supabase → SQL Editor → New query → Run.
-- Après ça, l'import des commandes clients (bouton « Importer ») fonctionnera.

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

-- Row Level Security, mêmes règles permissives que orders/suppliers (accès via la clé anon).
alter table public.customer_orders enable row level security;
alter table public.customers enable row level security;

create policy "customer_orders anon access" on public.customer_orders
  for all using (true) with check (true);

create policy "customers anon access" on public.customers
  for all using (true) with check (true);
