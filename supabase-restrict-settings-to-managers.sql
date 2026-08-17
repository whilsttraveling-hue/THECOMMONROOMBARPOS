-- Run this in Supabase → SQL Editor.
-- Restricts writes to the `settings` table (which holds your UPI ID) to
-- managers only. Everyone can still read it (needed to show the QR code
-- at checkout) but only accounts marked role='manager' in staff_profiles
-- can change it — enforced by the database itself, not just the app UI.

drop policy if exists "public read/write settings" on settings;

create policy "anyone can read settings" on settings
  for select using (true);

create policy "managers can write settings" on settings
  for insert with check (
    exists (select 1 from staff_profiles where id = auth.uid() and role = 'manager')
  );

create policy "managers can update settings" on settings
  for update using (
    exists (select 1 from staff_profiles where id = auth.uid() and role = 'manager')
  );
