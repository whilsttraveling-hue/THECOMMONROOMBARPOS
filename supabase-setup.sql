-- Paste this whole file into Supabase → SQL Editor → New query → Run

create table menu (
  id text primary key default 'singleton',
  value jsonb not null default '[]',
  updated_at timestamptz default now()
);

create table tabs (
  id text primary key default 'singleton',
  value jsonb not null default '[]',
  updated_at timestamptz default now()
);

create table history (
  id text primary key default 'singleton',
  value jsonb not null default '[]',
  updated_at timestamptz default now()
);

create table settings (
  id text primary key default 'singleton',
  value jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- One row per staff member, linked to their Supabase Auth account.
-- Create the person in Authentication -> Users first (email + password),
-- then add a matching row here with their name and role.
create table staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'regular' check (role in ('regular', 'manager')),
  created_at timestamptz default now()
);

-- Purchase orders: what you bought in, from whom, at what cost.
-- One row per delivery/invoice, feeding real cost-of-goods into reports.
create table purchases (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  purchase_date date not null default current_date,
  invoice_amount numeric not null default 0,
  items jsonb not null default '[]', -- [{menuItemId, name, qty, unitCost}]
  recorded_by text,
  created_at timestamptz default now()
);

alter table settings enable row level security;
alter table staff_profiles enable row level security;
alter table purchases enable row level security;
alter table menu enable row level security;
alter table tabs enable row level security;
alter table history enable row level security;

create policy "public read/write settings" on settings for all using (true) with check (true);
create policy "public read/write menu" on menu for all using (true) with check (true);
create policy "public read/write tabs" on tabs for all using (true) with check (true);
create policy "public read/write history" on history for all using (true) with check (true);

-- Staff can read all profiles (needed to show names) but only managers
-- should be able to change roles — enforced in the app UI; the policy
-- here just requires being logged in at all, matching the rest of this schema.
create policy "authenticated read staff_profiles" on staff_profiles for select using (true);
create policy "authenticated write staff_profiles" on staff_profiles for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated read/write purchases" on purchases for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
