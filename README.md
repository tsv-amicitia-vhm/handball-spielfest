# Handball-Spielfest – Helfer-Schichtplan

Eigene Alternative zu Voluntira: Eltern tragen sich ohne Konto in Schichten ein, das Orga-Team pflegt Stationen und Schichten und sieht alle Kontaktdaten.

- **Helfer-Seite:** `index.html` – Schichten ansehen, eintragen (Name, E-Mail, optional Telefon/Bemerkung), per Link wieder austragen, Termin in den Kalender übernehmen.
- **Orga-Bereich:** `admin.html` – Anmeldung per E-Mail-Link. Übersicht mit offenen Plätzen, Helferliste mit CSV-Export und Druckansicht, Schichtplan bearbeiten, Spielfest fürs nächste Jahr als Vorlage kopieren.

Technik: statische Seiten (HTML/CSS/JavaScript, kein Build-Schritt) auf GitHub Pages, Daten in Supabase (Projekt `handball-spielfest`, Region Frankfurt).

## Einrichtung

1. **GitHub Pages:** Unter *Settings → Pages → Source* „GitHub Actions" wählen. Jeder Push auf `main` veröffentlicht die Seite.
2. **Supabase Login-Link:** Im Supabase-Dashboard unter *Authentication → URL Configuration* die *Site URL* auf die GitHub-Pages-Adresse setzen (z. B. `https://<name>.github.io/handball-spielfest/`) und dieselbe Adresse plus `admin.html` bei *Redirect URLs* eintragen. Sonst führt der Anmelde-Link ins Leere.
3. **Orga-Zugang vergeben:** Im Supabase SQL-Editor
   ```sql
   insert into public.admins (email) values ('name@example.org');
   ```

## Datenbank

`supabase/migrations/001_schema.sql` enthält Tabellen, Zugriffsregeln und Funktionen, `002_beispieldaten.sql` die Platzhalter-Daten.

- `events`, `stations`, `shifts` sind öffentlich lesbar, nur die Orga darf ändern.
- `signups` (mit E-Mail/Telefon) ist nur für die Orga lesbar. Helfer tragen sich ausschließlich über die Funktionen `sign_up` und `cancel_signup` ein und aus. `sign_up` prüft dabei, ob die Anmeldung offen ist, ob noch Platz frei ist und ob dieselbe Person zur gleichen Zeit schon woanders eingetragen ist.
- `shift_status` liefert die Belegung ohne Kontaktdaten, Namen nur als „Vorname N." (abschaltbar in den Einstellungen).
- Der Supabase-Linter warnt, dass diese vier Funktionen ohne Login aufrufbar sind. Das ist hier gewollt.

## Hinweise

- Bestätigungs-E-Mails an Helfer werden derzeit nicht verschickt. Den Austragen-Link sehen Helfer nach dem Eintragen, und auf ihrem Gerät bleiben ihre Schichten oben auf der Seite gespeichert. Für E-Mails ließe sich später ein Versanddienst (z. B. Resend) über eine Supabase Edge Function anbinden.
- Der Supabase-Gratistarif pausiert Projekte nach einer Woche ohne Zugriffe. Vor dem Verteilen des Links einmal die Seite öffnen bzw. im Dashboard „Restore" klicken.
- Vereinsfarbe: `--accent` in `css/style.css`, Vereinsname: `js/config.js`.
