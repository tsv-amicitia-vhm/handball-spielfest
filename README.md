# Helferliste Mini-Spielfest – Handball in Viernheim

Eine einzige, öffentliche Seite: Helfer und Eltern tragen sich mit ihrem **Namen** für Stände (mit Uhrzeit) oder Spenden (Kuchen, Waffelteig …) ein und können sich auf demselben Gerät wieder austragen. Kein Login, keine Kontaktdaten.

- Statische Seite (HTML/CSS/JavaScript, kein Build-Schritt) auf GitHub Pages.
- Daten in Supabase (Projekt `handball-spielfest`, Frankfurt).
- Schriften (Source Sans 3, Barlow Condensed – SIL Open Font License) und die Supabase-Bibliothek liegen im Repo, es werden keine fremden Server (Google Fonts, CDNs) angefragt.

## Stände und Spenden pflegen

Im Supabase-Dashboard unter **Table Editor**:

| Tabelle | Wofür |
|---|---|
| `events` | Titel, Datum, Text für die Eltern, Orga-Kontakt (`contact_name`, `contact_email` = E-Mail oder Telefon), `signup_open` (Liste offen/geschlossen), `show_names` |
| `stations` | Ein Stand oder eine Spende. `kind` = `schicht` (mit Uhrzeit) oder `spende` (ohne Uhrzeit), `sort_order` = Reihenfolge |
| `shifts` | Uhrzeit und Anzahl Plätze (`slots`) je Stand. Bei Spenden bleiben `start_time`/`end_time` leer |
| `signups` | Die eingetragenen Namen. Hier kann die Orga Einträge korrigieren oder löschen |

Die Seite zeigt automatisch das nächste anstehende Fest. Ein bestimmtes Fest zeigt `?e=<slug>`.

## Datenschutz

- Gespeichert wird nur der eingetragene Name. Er ist öffentlich auf der Seite sichtbar.
- Vier Wochen nach dem Fest löscht ein nächtlicher Datenbank-Job (`helfernamen-loeschen`, pg_cron) alle Namen automatisch.
- Keine Cookies. Der Browser merkt sich nur lokal die eigenen Einträge (zum Austragen) und den zuletzt benutzten Namen.
- Die Seite verlinkt Impressum und Datenschutzerklärung des Vereins; im Eintragen-Fenster steht, dass der Name öffentlich ist und nach dem Fest gelöscht wird. Am besten ergänzt der Verein in seiner Datenschutzerklärung einen Absatz zu dieser Liste.

## Datenbank

`supabase/migrations/` enthält die Schritte in der Reihenfolge, in der sie angewendet wurden. `006_aufraeumen_optional.sql` entfernt Reste der ersten Version (Orga-Login, Kontaktdaten-Spalten, Platzhalter-Fest) und kann bei Gelegenheit im SQL-Editor ausgeführt werden.

Helfer können Einträge nur über Datenbank-Funktionen anlegen (`sign_up`) und wieder entfernen (`cancel_signup`). Direkt lesbar sind nur Fest, Stände und Schichten, die Namen kommen über `shift_status`.
