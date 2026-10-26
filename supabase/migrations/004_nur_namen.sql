-- Vereinfachung: Helfer tragen nur ihren Namen ein, kein Orga-Bereich mehr.
-- Stationen gibt es als Schicht (mit Uhrzeit) oder Spende (Mitbringliste, ohne Uhrzeit).
-- Änderungen an Ständen/Schichten erfolgen im Supabase-Dashboard (Table Editor).

-- Kontaktdaten werden nicht mehr erhoben (Spalten bleiben vorerst, werden aber nicht befüllt)
alter table public.signups alter column email drop not null;

-- Spenden ohne Uhrzeit
alter table public.stations add column if not exists kind text not null default 'schicht'
  check (kind in ('schicht', 'spende'));
alter table public.shifts alter column start_time drop not null;
alter table public.shifts alter column end_time drop not null;
alter table public.shifts add constraint shifts_zeit_vollstaendig
  check ((start_time is null) = (end_time is null));

-- Belegung je Schicht inkl. Namen (so wie eingetragen)
create or replace function public.shift_status(p_event_id uuid)
returns table (shift_id uuid, taken int, names text[])
language sql stable security definer
set search_path = ''
as $$
  select sh.id,
         count(su.id)::int,
         case when ev.show_names
              then coalesce(array_agg(su.name order by su.created_at) filter (where su.id is not null), '{}')
              else '{}' end
  from public.events ev
  join public.stations st on st.event_id = ev.id
  join public.shifts sh   on sh.station_id = st.id
  left join public.signups su on su.shift_id = sh.id
  where ev.id = p_event_id
  group by sh.id, ev.show_names;
$$;

-- Eintragen nur mit Namen
create or replace function public.sign_up(p_shift_id uuid, p_name text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_open  boolean;
  v_taken int;
  v_token uuid;
  v_name  text := regexp_replace(trim(p_name), '\s+', ' ', 'g');
begin
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'Bitte einen Namen mit 2 bis 60 Zeichen angeben.' using errcode = 'P0001';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'Eintrag nicht gefunden.' using errcode = 'P0001'; end if;

  select ev.signup_open into v_open from public.events ev
    join public.stations st on st.event_id = ev.id
   where st.id = v_shift.station_id;
  if not v_open then
    raise exception 'Die Anmeldung ist geschlossen.' using errcode = 'P0001';
  end if;

  select count(*) into v_taken from public.signups where shift_id = p_shift_id;
  if v_taken >= v_shift.slots then
    raise exception 'Hier ist leider schon alles belegt.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.signups where shift_id = p_shift_id and lower(name) = lower(v_name)) then
    raise exception '% ist hier schon eingetragen.', v_name using errcode = 'P0001';
  end if;

  insert into public.signups (shift_id, name) values (p_shift_id, v_name)
  returning cancel_token into v_token;
  return v_token;
end;
$$;

revoke execute on function public.sign_up(uuid, text) from public;
grant  execute on function public.sign_up(uuid, text) to anon, authenticated;
-- alte Variante mit E-Mail/Telefon sperren
revoke execute on function public.sign_up(uuid, text, text, text, text) from anon, authenticated;
