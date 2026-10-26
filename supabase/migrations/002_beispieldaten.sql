-- Beispieldaten (Platzhalter, im Orga-Bereich anpassen oder löschen)
-- Orga-Zugang: weitere E-Mails einfach hier oder per SQL ergänzen
insert into public.admins (email) values ('andreas.klee1@gmail.com') on conflict do nothing;

with ev as (
  insert into public.events (slug, title, event_date, location, description, contact_name, contact_email)
  values ('spielfest-2027', 'Handball-Spielfest F-Jugend', '2027-03-13', 'Sporthalle (bitte anpassen)',
          'Damit der Tag für die Kinder ein Erfolg wird, brauchen wir viele helfende Hände. Bitte tragt euch für eine oder mehrere Schichten ein. Danke!',
          'Andreas Klee', 'andreas.klee1@gmail.com')
  returning id
), st as (
  insert into public.stations (event_id, name, description, sort_order)
  select ev.id, s.name, s.description, s.sort_order
  from ev, (values
    ('Aufbau',               'Tore, Banden, Tische und Bänke aufstellen',              1),
    ('Kampfgericht / Zeitnahme', 'Spielzeit stoppen, Ergebnisse notieren. Kurze Einweisung vor Ort.', 2),
    ('Cafeteria',            'Kaffee, Kuchen und Getränke verkaufen',                 3),
    ('Grill',                'Würstchen grillen und ausgeben',                         4),
    ('Kasse / Eingang',      'Startgeld kassieren, Teams begrüßen',                    5),
    ('Abbau',                'Halle aufräumen und Material verstauen',                 6)
  ) as s(name, description, sort_order)
  returning id, name
)
insert into public.shifts (station_id, start_time, end_time, slots)
select st.id, x.start_time::time, x.end_time::time, x.slots
from st join (values
  ('Aufbau',                   '08:00', '09:30', 6),
  ('Kampfgericht / Zeitnahme', '09:30', '11:30', 3),
  ('Kampfgericht / Zeitnahme', '11:30', '13:30', 3),
  ('Kampfgericht / Zeitnahme', '13:30', '15:30', 3),
  ('Cafeteria',                '09:30', '11:30', 3),
  ('Cafeteria',                '11:30', '13:30', 3),
  ('Cafeteria',                '13:30', '15:30', 3),
  ('Grill',                    '11:00', '13:00', 2),
  ('Grill',                    '13:00', '15:00', 2),
  ('Kasse / Eingang',          '09:00', '11:00', 2),
  ('Kasse / Eingang',          '11:00', '13:00', 1),
  ('Abbau',                    '15:30', '17:00', 6)
) as x(station, start_time, end_time, slots) on x.station = st.name;
