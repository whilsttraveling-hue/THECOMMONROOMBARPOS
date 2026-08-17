-- Run this in Supabase → SQL Editor. Safe to run even though menu/tabs/
-- history/settings already exist — this only adds the two new tables.

create table staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'regular' check (role in ('regular', 'manager')),
  created_at timestamptz default now()
);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  purchase_date date not null default current_date,
  invoice_amount numeric not null default 0,
  items jsonb not null default '[]',
  recorded_by text,
  created_at timestamptz default now()
);

alter table staff_profiles enable row level security;
alter table purchases enable row level security;

create policy "authenticated read staff_profiles" on staff_profiles for select using (true);
create policy "authenticated write staff_profiles" on staff_profiles for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write purchases" on purchases for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
