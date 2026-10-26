-- OPTIONAL, von Hand im Supabase SQL-Editor ausführen:
-- entfernt Reste aus der ersten Version (Orga-Login, Kontaktdaten-Spalten, Platzhalter-Fest).
-- Die App funktioniert auch ohne diesen Schritt.

delete from public.events where slug = 'platzhalter-alt';

drop function if exists public.sign_up(uuid, text, text, text, text);
drop function if exists public.is_admin() cascade;
drop table if exists public.admins;

alter table public.signups drop column if exists email;
alter table public.signups drop column if exists phone;
alter table public.signups drop column if exists comment;
