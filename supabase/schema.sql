-- Zero-knowledge vault schema
-- Run this in the Supabase SQL editor (free project).
-- Ciphertext only: the master password and plaintext never reach the database.

create table if not exists public.vault_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  salt text not null,
  verifier_iv text not null,
  verifier_ciphertext text not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  transports text[] not null default '{}',
  prf_salt text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists vault_items_user_id_created_at_idx
  on public.vault_items (user_id, created_at desc);

alter table public.vault_keys enable row level security;
alter table public.vault_items enable row level security;
alter table public.user_credentials enable row level security;

-- vault_keys: each user can only read/write their own KDF salt + verifier
drop policy if exists "vault_keys_select_own" on public.vault_keys;
create policy "vault_keys_select_own"
  on public.vault_keys
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "vault_keys_insert_own" on public.vault_keys;
create policy "vault_keys_insert_own"
  on public.vault_keys
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "vault_keys_update_own" on public.vault_keys;
create policy "vault_keys_update_own"
  on public.vault_keys
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "vault_keys_delete_own" on public.vault_keys;
create policy "vault_keys_delete_own"
  on public.vault_keys
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- vault_items: users can only access their own encrypted rows
drop policy if exists "vault_items_select_own" on public.vault_items;
create policy "vault_items_select_own"
  on public.vault_items
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "vault_items_insert_own" on public.vault_items;
create policy "vault_items_insert_own"
  on public.vault_items
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "vault_items_update_own" on public.vault_items;
create policy "vault_items_update_own"
  on public.vault_items
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "vault_items_delete_own" on public.vault_items;
create policy "vault_items_delete_own"
  on public.vault_items
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- WebAuthn metadata belongs to the signed-in user. It is not sufficient to authenticate
-- a request on its own; the client uses it only for local vault key restoration.
drop policy if exists "user_credentials_select_own" on public.user_credentials;
create policy "user_credentials_select_own"
  on public.user_credentials
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_credentials_insert_own" on public.user_credentials;
create policy "user_credentials_insert_own"
  on public.user_credentials
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_credentials_update_own" on public.user_credentials;
create policy "user_credentials_update_own"
  on public.user_credentials
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_credentials_delete_own" on public.user_credentials;
create policy "user_credentials_delete_own"
  on public.user_credentials
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.vault_keys from anon;
revoke all on public.vault_items from anon;
revoke all on public.user_credentials from anon;
grant select, insert, update, delete on public.vault_keys to authenticated;
grant select, insert, update, delete on public.vault_items to authenticated;
grant select, insert, update, delete on public.user_credentials to authenticated;
