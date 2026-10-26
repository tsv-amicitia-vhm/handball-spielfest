import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const hm = (t) => (t ? String(t).slice(0, 5) : '');

export const fmtDate = (d, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE', opts) : '';

export const todayIso = () => {
  const n = new Date();
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4300);
}

// Lesbare Fehlermeldung aus einem Supabase-Fehler
export function errText(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Keine Verbindung. Bitte später nochmal versuchen.';
  if (/check constraint.*email|email_check/i.test(m)) return 'Bitte eine gültige E-Mail-Adresse angeben.';
  if (/check constraint.*name/i.test(m)) return 'Bitte einen Namen mit mindestens 2 Zeichen angeben.';
  return m;
}

// Kalendereintrag (.ics) für eine Schicht
export function icsFile({ title, date, start, end, location, description }) {
  const d = date.replaceAll('-', '');
  const t = (x) => hm(x).replace(':', '') + '00';
  const clean = (s) => String(s ?? '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Spielfest//Schichtplan//DE', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@spielfest`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${d}T${t(start)}`,
    `DTEND:${d}T${t(end)}`,
    `SUMMARY:${clean(title)}`,
    `LOCATION:${clean(location)}`,
    `DESCRIPTION:${clean(description)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return new Blob([body], { type: 'text/calendar;charset=utf-8' });
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privat-Modus */ }
  },
};
