-- Row Level Security templates for Supabase.
-- Replace "items" with your table. Run in the SQL editor or add as a migration.

---------------------------------------------------------------
-- 1. Per-user rows (each row belongs to one user)
---------------------------------------------------------------
alter table public.items enable row level security;

create policy "Users read own items"
  on public.items for select
  using ((select auth.uid()) = user_id);

create policy "Users create own items"
  on public.items for insert
  with check ((select auth.uid()) = user_id);

create policy "Users update own items"
  on public.items for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete own items"
  on public.items for delete
  using ((select auth.uid()) = user_id);

-- Index the column used by policies, or every query does a full scan.
create index if not exists items_user_id_idx on public.items (user_id);

---------------------------------------------------------------
-- 2. Team / organisation rows (multi-tenant SaaS)
---------------------------------------------------------------
-- Assumes: memberships(org_id uuid, user_id uuid, role text)

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = org and m.user_id = (select auth.uid())
  );
$$;

alter table public.projects enable row level security;

create policy "Members read org projects"
  on public.projects for select
  using (public.is_org_member(org_id));

create policy "Members write org projects"
  on public.projects for all
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

---------------------------------------------------------------
-- 3. Public read, owner write (e.g. published posts)
---------------------------------------------------------------
alter table public.posts enable row level security;

create policy "Anyone can read published posts"
  on public.posts for select
  using (published = true or (select auth.uid()) = author_id);

create policy "Authors manage their posts"
  on public.posts for all
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

---------------------------------------------------------------
-- Find tables that still have RLS switched off:
---------------------------------------------------------------
-- select tablename from pg_tables where schemaname = 'public' and rowsecurity = false;
