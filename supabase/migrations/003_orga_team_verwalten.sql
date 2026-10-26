-- Orga-Mitglieder dürfen weitere Orga-Adressen freischalten und entfernen (nicht sich selbst)
create policy "orga einfuegen" on public.admins for insert to authenticated with check ((select public.is_admin()));
create policy "orga loeschen" on public.admins for delete to authenticated
  using ((select public.is_admin()) and email <> lower(coalesce(auth.jwt() ->> 'email', '')));
