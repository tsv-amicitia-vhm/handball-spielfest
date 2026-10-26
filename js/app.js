import { sb, $, esc, hm, fmtDate, todayIso, toast, errText, store } from './common.js';
import { VEREIN, VEREIN_IMPRESSUM, VEREIN_DATENSCHUTZ } from './config.js';

const MINE_KEY = 'spielfest-meine-eintraege';
const NAME_KEY = 'spielfest-name';

let event = null;
let stations = [];          // inkl. shifts
let status = new Map();     // shift_id -> { taken, names }
let onlyFree = false;
let current = null;         // Eintrag im Dialog

init();

// ---------- Laden ----------

async function init() {
  $('#verein').textContent = VEREIN;
  renderFooter();
  try {
    event = await loadEvent();
  } catch (e) {
    return fail(errText(e));
  }
  if (!event) return fail('Aktuell ist kein Spielfest eingetragen.');

  document.title = `Helferliste – ${event.title}`;
  $('#title').textContent = event.title;
  $('#meta').innerHTML = [
    `<span>${esc(fmtDate(event.event_date))}</span>`,
    event.location ? `<span>${esc(event.location)}</span>` : '',
  ].join('');

  const { data, error } = await sb.from('stations')
    .select('id, name, description, kind, sort_order, shifts(id, start_time, end_time, slots, note)')
    .eq('event_id', event.id)
    .order('sort_order').order('name');
  if (error) return fail(errText(error));
  stations = data;

  await refreshStatus();
  renderMine();
  setInterval(refreshStatus, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
}

async function loadEvent() {
  const slug = new URLSearchParams(location.search).get('e');
  if (slug) {
    const { data, error } = await sb.from('events').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data;
  }
  // sonst: das nächste anstehende Fest
  const { data, error } = await sb.from('events').select('*')
    .gte('event_date', todayIso()).order('event_date').limit(1);
  if (error) throw error;
  return data[0] ?? null;
}

async function refreshStatus() {
  const { data, error } = await sb.rpc('shift_status', { p_event_id: event.id });
  if (error) { $('#updated').textContent = 'Aktualisierung fehlgeschlagen'; return; }
  status = new Map(data.map((r) => [r.shift_id, r]));
  render();
  $('#updated').textContent = 'Stand ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
}

function fail(msg) {
  $('#lead').innerHTML = `<p style="margin:0">${esc(msg)}</p>`;
  $('#schichten').innerHTML = '';
  $('#spenden').innerHTML = '';
}

// ---------- Darstellung ----------

const st = (sh) => status.get(sh.id) ?? { taken: 0, names: [] };
const isFull = (sh) => st(sh).taken >= sh.slots;

function allEntries(kind) {
  return stations
    .filter((s) => s.kind === kind)
    .flatMap((s) => s.shifts.map((sh) => ({ ...sh, station: s })));
}

function render() {
  const entries = [...allEntries('spende'), ...allEntries('schicht')];
  let total = 0, taken = 0;
  for (const e of entries) { total += e.slots; taken += Math.min(st(e).taken, e.slots); }
  const open = total - taken;
  const pct = total ? Math.round((taken / total) * 100) : 0;

  $('#lead').innerHTML = `
    ${event.description ? `<p>${esc(event.description).replace(/\n/g, '<br>')}</p>` : ''}
    ${!event.signup_open ? `<p class="error">Die Liste ist geschlossen. Eintragen ist nicht mehr möglich.</p>` : ''}
    <div class="progress">
      <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <span>${open > 0 ? `Noch <b>${open}</b> von ${total} Plätzen offen` : 'Alles belegt – vielen Dank!'}</span>
    </div>`;

  renderSpenden();
  renderSchichten();
}

function renderSpenden() {
  const list = allEntries('spende').filter((e) => !onlyFree || !isFull(e));
  const all = allEntries('spende');
  if (!all.length) { $('#spenden').innerHTML = ''; return; }
  $('#spenden').innerHTML = `
    <h2 class="section-title">Kuchen &amp; Spenden</h2>
    <div class="card list">
      ${list.length ? list.map((e) => row(e, e.station.name)).join('')
        : '<p class="muted" style="margin:0;padding:14px 18px">Alles vergeben – danke!</p>'}
    </div>`;
}

function renderSchichten() {
  const list = allEntries('schicht')
    .filter((e) => !onlyFree || !isFull(e))
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.station.sort_order - b.station.sort_order);
  const all = allEntries('schicht');
  if (!all.length) { $('#schichten').innerHTML = ''; return; }

  // nach Startzeit gruppieren
  const groups = [];
  for (const e of list) {
    const key = `${hm(e.start_time)}–${hm(e.end_time)}`;
    const g = groups.at(-1);
    if (g && g.key === key) g.items.push(e); else groups.push({ key, items: [e] });
  }

  $('#schichten').innerHTML = `
    <h2 class="section-title">Helferschichten</h2>
    ${groups.length ? groups.map((g) => `
      <div class="slot-group">
        <div class="slot-time"><span>${g.key}</span> Uhr</div>
        <div class="card list">${g.items.map((e) => row(e, e.station.name, e.station.description)).join('')}</div>
      </div>`).join('')
    : '<div class="card"><p class="muted" style="margin:0">Alle Schichten sind besetzt – danke!</p></div>'}`;
}

function row(e, title, desc) {
  const s = st(e);
  const full = s.taken >= e.slots;
  const free = Math.max(e.slots - s.taken, 0);
  const names = (s.names ?? []).map((n) => `<li class="name">${esc(n)}</li>`).join('');
  const frees = e.slots <= 6
    ? Array.from({ length: free }, () => '<li class="name free">offen</li>').join('')
    : (free ? `<li class="name free">${free} offen</li>` : '');
  return `
    <article class="entry ${full ? 'full' : ''}">
      <div class="entry-head">
        <h3>${esc(title)}</h3>
        <span class="count" title="belegt / Plätze">${Math.min(s.taken, e.slots)}/${e.slots}</span>
      </div>
      ${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
      ${e.note ? `<p class="desc">${esc(e.note)}</p>` : ''}
      <ul class="names">${names}${frees}</ul>
      <button class="btn ${full ? 'done' : ''}" data-entry="${e.id}" ${full || !event.signup_open ? 'disabled' : ''}>
        ${full ? 'Vollständig belegt' : 'Eintragen'}
      </button>
    </article>`;
}

function renderFooter() {
  $('#privacyText').innerHTML = `
    <p>Verantwortlich ist der TSV Amicitia 1906/09 Viernheim e.V., Abteilung Handball
      (<a href="${VEREIN_IMPRESSUM}" target="_blank" rel="noopener">Impressum</a>).</p>
    <p>Gespeichert wird nur der Name, den du einträgst. Er ist für alle sichtbar, die diese Seite aufrufen,
      und dient ausschließlich der Organisation des Spielfests. Vier Wochen nach dem Fest werden alle Namen automatisch gelöscht.</p>
    <p>Die Einträge liegen in einer Datenbank von Supabase in Frankfurt am Main. Die Seite selbst wird über GitHub Pages ausgeliefert;
      dabei verarbeitet GitHub technisch bedingt deine IP-Adresse. Schriften und Programmteile werden nicht von fremden Servern geladen.</p>
    <p>Es werden keine Cookies gesetzt. Damit du dich wieder austragen kannst, merkt sich nur dein Browser deine Einträge und deinen Namen.</p>
    <p>Mehr in der <a href="${VEREIN_DATENSCHUTZ}" target="_blank" rel="noopener">Datenschutzerklärung des Vereins</a>.
      Du möchtest einen Eintrag löschen lassen, der nicht von deinem Gerät stammt? Sprich das Orga-Team an.</p>`;
  $('#footerLinks').innerHTML = `
    <a href="${VEREIN_IMPRESSUM}" target="_blank" rel="noopener">Impressum</a> ·
    <a href="${VEREIN_DATENSCHUTZ}" target="_blank" rel="noopener">Datenschutzerklärung</a> ·
    <a href="https://www.handballinviernheim.de" target="_blank" rel="noopener">handballinviernheim.de</a>`;
}

// ---------- Deine Einträge (nur auf diesem Gerät) ----------

async function renderMine() {
  const all = store.get(MINE_KEY, []);
  let mine = all.filter((m) => m.event_id === event.id);
  const box = $('#mine');
  if (!mine.length) { box.classList.add('hidden'); return; }

  // prüfen, ob die Einträge noch existieren
  const checks = await Promise.all(mine.map((m) => sb.rpc('get_signup', { p_token: m.token })));
  if (!checks.some((c) => c.error)) {
    const alive = new Set(mine.filter((m, i) => checks[i].data?.length).map((m) => m.token));
    mine = mine.filter((m) => alive.has(m.token));
    store.set(MINE_KEY, all.filter((m) => m.event_id !== event.id || alive.has(m.token)));
  }
  if (!mine.length) { box.classList.add('hidden'); return; }

  mine.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  box.innerHTML = `
    <h2>Deine Einträge</h2>
    <ul>${mine.map((m) => `
      <li>
        <span>${m.start ? `<b>${hm(m.start)}–${hm(m.end)}</b> ` : ''}${esc(m.station)} <span class="muted">(${esc(m.name)})</span></span>
        <button class="btn small ghost" data-cancel="${m.token}">Austragen</button>
      </li>`).join('')}
    </ul>`;
  box.classList.remove('hidden');
}

// ---------- Eintragen / Austragen ----------

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.entry) openSignup(b.dataset.entry);
  if (b.hasAttribute('data-close')) b.closest('dialog').close();
  if (b.dataset.cancel) cancel(b.dataset.cancel);
});

$('#filterFree').addEventListener('change', (e) => {
  onlyFree = e.target.checked;
  render();
});

function findEntry(id) {
  for (const s of stations) {
    const sh = s.shifts.find((x) => x.id === id);
    if (sh) return { ...sh, station: s };
  }
}

function openSignup(id) {
  current = findEntry(id);
  if (!current) return;
  const f = $('#signupForm');
  f.reset();
  f.name.value = store.get(NAME_KEY, '');
  $('#formError').classList.add('hidden');
  $('#dlgKicker').textContent = current.station.kind === 'spende'
    ? 'Ich bringe mit'
    : `${fmtDate(event.event_date, { weekday: 'short', day: 'numeric', month: 'long' })}, ${hm(current.start_time)}–${hm(current.end_time)} Uhr`;
  $('#dlgTitle').textContent = current.station.name;
  $('#signupDlg').showModal();
  f.name.focus();
  f.name.select();
}

$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const err = $('#formError');
  const name = f.name.value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    err.textContent = 'Bitte deinen Namen eintragen.';
    err.classList.remove('hidden');
    return f.name.focus();
  }
  const btn = $('#submitBtn');
  btn.disabled = true; btn.textContent = 'Speichert …';
  const { data: token, error } = await sb.rpc('sign_up', { p_shift_id: current.id, p_name: name });
  btn.disabled = false; btn.textContent = 'Eintragen';

  if (error) {
    err.textContent = errText(error);
    err.classList.remove('hidden');
    refreshStatus();
    return;
  }

  store.set(NAME_KEY, name);
  store.set(MINE_KEY, [...store.get(MINE_KEY, []), {
    token, event_id: event.id, station: current.station.name,
    start: current.start_time, end: current.end_time, name,
  }]);
  $('#signupDlg').close();
  toast(`Danke, ${name.split(' ')[0]}! Du bist eingetragen.`);
  await refreshStatus();
  renderMine();
});

async function cancel(token) {
  const m = store.get(MINE_KEY, []).find((x) => x.token === token);
  if (!confirm(`Wirklich austragen${m ? ` aus „${m.station}“` : ''}?`)) return;
  const { error } = await sb.rpc('cancel_signup', { p_token: token });
  if (error) return toast(errText(error), 'error');
  store.set(MINE_KEY, store.get(MINE_KEY, []).filter((x) => x.token !== token));
  toast('Du bist ausgetragen.');
  await refreshStatus();
  renderMine();
}
