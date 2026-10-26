-- Namen 4 Wochen nach dem Fest automatisch löschen (Datensparsamkeit)
create extension if not exists pg_cron;
select cron.schedule(
  'helfernamen-loeschen',
  '15 3 * * *',
  $$delete from public.signups su
      using public.shifts sh, public.stations st, public.events ev
     where sh.id = su.shift_id and st.id = sh.station_id and ev.id = st.event_id
       and ev.event_date < current_date - 28$$
);
