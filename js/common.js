// Supabase-Bibliothek liegt lokal im Repo (keine Anfragen an fremde CDNs)
import { createClient } from '../vendor/supabase-js-2.118.0.min.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=b186e88';

// Kein Login: Sitzung weder speichern noch erneuern
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

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

export function errText(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Keine Verbindung. Bitte gleich nochmal versuchen.';
  return m;
}

// Nur auf diesem Gerät gespeichert (für "Deine Einträge" und das Vorausfüllen des Namens)
export const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus */ }
  },
};
