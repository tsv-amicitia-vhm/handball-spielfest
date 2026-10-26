-- Handball-Spielfest: Helfer-Schichtplan
-- Tabellen, Zugriffsregeln (RLS) und öffentliche Funktionen

-- ---------- Tabellen ----------

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title         text not null,
  event_date    date not null,
  location      text,
  description   text,
  contact_name  text,
  contact_email text,
  signup_open   boolean not null default true,
  show_names    boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.stations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null,
  description text,
  sort_order  int not null default 0
);
create index on public.stations(event_id);

create table public.shifts (
  id         uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  start_time time not null,
  end_time   time not null,
  slots      int  not null check (slots between 1 and 100),
  note       text,
  check (end_time > start_time)
);
create index on public.shifts(station_id);

create table public.signups (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts(id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 80),
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  phone        text check (char_length(phone) <= 40),
  comment      text check (char_length(comment) <= 500),
  cancel_token uuid not null unique default gen_random_uuid(),
  created_at   timestamptz not null default now()
);
create index on public.signups(shift_id);
create index on public.signups(lower(email));

-- Wer im Orga-Bereich arbeiten darf (E-Mail des Logins)
create table public.admins (
  email text primary key check (email = lower(email))
);

-- ---------- Hilfsfunktion ----------

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Zugriffsregeln ----------

alter table public.events   enable row level security;
alter table public.stations enable row level security;
alter table public.shifts   enable row level security;
alter table public.signups  enable row level security;
alter table public.admins   enable row level security;

-- Event, Stationen, Schichten: alle dürfen lesen, nur Orga ändern
create policy "lesen" on public.events   for select to anon, authenticated using (true);
create policy "lesen" on public.stations for select to anon, authenticated using (true);
create policy "lesen" on public.shifts   for select to anon, authenticated using (true);

create policy "orga einfuegen" on public.events   for insert to authenticated with check ((select public.is_admin()));
create policy "orga aendern"   on public.events   for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "orga loeschen"  on public.events   for delete to authenticated using ((select public.is_admin()));
create policy "orga einfuegen" on public.stations for insert to authenticated with check ((select public.is_admin()));
create policy "orga aendern"   on public.stations for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "orga loeschen"  on public.stations for delete to authenticated using ((select public.is_admin()));
create policy "orga einfuegen" on public.shifts   for insert to authenticated with check ((select public.is_admin()));
create policy "orga aendern"   on public.shifts   for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "orga loeschen"  on public.shifts   for delete to authenticated using ((select public.is_admin()));

-- Anmeldungen (mit E-Mail/Telefon) sieht nur die Orga.
-- Helfer tragen sich ausschließlich über die Funktionen unten ein/aus.
create policy "orga lesen"     on public.signups for select to authenticated using ((select public.is_admin()));
create policy "orga einfuegen" on public.signups for insert to authenticated with check ((select public.is_admin()));
create policy "orga aendern"   on public.signups for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "orga loeschen"  on public.signups for delete to authenticated using ((select public.is_admin()));

create policy "orga lesen" on public.admins for select to authenticated using ((select public.is_admin()));

-- ---------- Öffentliche Funktionen ----------

-- Belegung je Schicht, ohne Kontaktdaten. Namen nur als "Vorname N.", wenn freigegeben.
create or replace function public.shift_status(p_event_id uuid)
returns table (shift_id uuid, taken int, names text[])
language sql stable security definer
set search_path = ''
as $$
  select sh.id,
         count(su.id)::int,
         case when ev.show_names then
           coalesce(array_agg(
             split_part(trim(su.name), ' ', 1) ||
             case when position(' ' in trim(su.name)) > 0
                  then ' ' || left(split_part(trim(su.name), ' ', array_length(regexp_split_to_array(trim(su.name), '\s+'), 1)), 1) || '.'
                  else '' end
             order by su.created_at) filter (where su.id is not null), '{}')
         else '{}' end
  from public.events ev
  join public.stations st on st.event_id = ev.id
  join public.shifts sh   on sh.station_id = st.id
  left join public.signups su on su.shift_id = sh.id
  where ev.id = p_event_id
  group by sh.id, ev.show_names;
$$;

-- Eintragen. Gibt den Austragen-Code zurück.
create or replace function public.sign_up(
  p_shift_id uuid, p_name text, p_email text, p_phone text default null, p_comment text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_event public.events;
  v_taken int;
  v_token uuid;
  v_email text := lower(trim(p_email));
begin
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'Schicht nicht gefunden' using errcode = 'P0001'; end if;

  select ev.* into v_event from public.events ev
    join public.stations st on st.event_id = ev.id
   where st.id = v_shift.station_id;

  if not v_event.signup_open then
    raise exception 'Die Anmeldung ist geschlossen.' using errcode = 'P0001';
  end if;

  select count(*) into v_taken from public.signups where shift_id = p_shift_id;
  if v_taken >= v_shift.slots then
    raise exception 'Diese Schicht ist leider schon voll.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.signups su
      join public.shifts sh   on sh.id = su.shift_id
      join public.stations st on st.id = sh.station_id
     where st.event_id = v_event.id
       and lower(su.email) = v_email
       and lower(trim(su.name)) = lower(trim(p_name))
       and sh.start_time < v_shift.end_time
       and sh.end_time   > v_shift.start_time
  ) then
    raise exception '% ist zu dieser Zeit schon eingetragen.', trim(p_name) using errcode = 'P0001';
  end if;

  insert into public.signups (shift_id, name, email, phone, comment)
  values (p_shift_id, trim(p_name), v_email, nullif(trim(p_phone), ''), nullif(trim(p_comment), ''))
  returning cancel_token into v_token;

  return v_token;
end;
$$;

-- Details zu einer Anmeldung über den Austragen-Code (für die Austragen-Seite)
create or replace function public.get_signup(p_token uuid)
returns table (name text, station text, start_time time, end_time time,
               event_title text, event_date date, signup_open boolean)
language sql stable security definer
set search_path = ''
as $$
  select su.name, st.name, sh.start_time, sh.end_time, ev.title, ev.event_date, ev.signup_open
  from public.signups su
  join public.shifts sh   on sh.id = su.shift_id
  join public.stations st on st.id = sh.station_id
  join public.events ev   on ev.id = st.event_id
  where su.cancel_token = p_token;
$$;

-- Austragen über den Code
create or replace function public.cancel_signup(p_token uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.signups where cancel_token = p_token;
  return found;
end;
$$;

revoke execute on function public.shift_status(uuid)                    from public;
revoke execute on function public.sign_up(uuid, text, text, text, text) from public;
revoke execute on function public.get_signup(uuid)                      from public;
revoke execute on function public.cancel_signup(uuid)                   from public;
grant  execute on function public.shift_status(uuid)                    to anon, authenticated;
grant  execute on function public.sign_up(uuid, text, text, text, text) to anon, authenticated;
grant  execute on function public.get_signup(uuid)                      to anon, authenticated;
grant  execute on function public.cancel_signup(uuid)                   to anon, authenticated;
