import { sb, $, esc, hm, fmtDate, todayIso, toast, errText, icsFile, download, store } from './common.js';
import { VEREIN } from './config.js';

const MINE_KEY = 'spielfest-meine-schichten';
const PERSON_KEY = 'spielfest-person';

let event = null;
let stations = [];          // inkl. shifts
let status = new Map();     // shift_id -> { taken, names }
let onlyFree = false;
let current = null;         // Schicht im Eintragen-Dialog
let lastDone = null;

// ---------- Start ----------

const cancelToken = new URLSearchParams(location.hash.slice(1)).get('abmelden');
if (cancelToken) showCancelView(cancelToken);
else init();

async function init() {
  $('#verein').textContent = VEREIN;
  try {
    event = await loadEvent();
  } catch (e) {
    return fail(errText(e));
  }
  if (!event) return fail('Aktuell ist kein Spielfest angelegt.');

  document.title = `Helfer – ${event.title}`;
  $('#title').textContent = event.title;
  $('#meta').innerHTML = [
    `<span>📅 ${esc(fmtDate(event.event_date))}</span>`,
    event.location ? `<span>📍 ${esc(event.location)}</span>` : '',
  ].join('');
  if (event.contact_email || event.contact_name) {
    $('#contact').innerHTML = `Fragen? ${esc(event.contact_name || '')} ${
      event.contact_email ? `<a href="mailto:${esc(event.contact_email)}">${esc(event.contact_email)}</a>` : ''}`;
  }

  const { data, error } = await sb.from('stations')
    .select('id, name, description, sort_order, shifts(id, start_time, end_time, slots, note)')
    .eq('event_id', event.id)
    .order('sort_order').order('name');
  if (error) return fail(errText(error));
  stations = data.map((s) => ({ ...s, shifts: s.shifts.sort((a, b) => a.start_time.localeCompare(b.start_time)) }));

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
  // sonst: das nächste anstehende, ersatzweise das letzte
  let { data, error } = await sb.from('events').select('*')
    .gte('event_date', todayIso()).order('event_date').limit(1);
  if (error) throw error;
  if (data.length) return data[0];
  ({ data, error } = await sb.from('events').select('*').order('event_date', { ascending: false }).limit(1));
  if (error) throw error;
  return data[0] ?? null;
}

async function refreshStatus() {
  const { data, error } = await sb.rpc('shift_status', { p_event_id: event.id });
  if (error) { $('#updated').textContent = 'Aktualisierung fehlgeschlagen'; return; }
  status = new Map(data.map((r) => [r.shift_id, r]));
  render();
  $('#updated').textContent = 'Stand ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fail(msg) {
  $('#lead').innerHTML = `<p>${esc(msg)}</p>`;
  $('#stations').innerHTML = '';
}

// ---------- Darstellung ----------

function render() {
  let total = 0, taken = 0;
  for (const st of stations) for (const sh of st.shifts) {
    total += sh.slots;
    taken += Math.min(status.get(sh.id)?.taken ?? 0, sh.slots);
  }
  const pct = total ? Math.round((taken / total) * 100) : 0;
  const open = total - taken;

  $('#lead').innerHTML = `
    ${event.description ? `<p>${esc(event.description).replace(/\n/g, '<br>')}</p>` : ''}
    ${!event.signup_open ? `<p class="error" style="margin-bottom:12px">Die Anmeldung ist geschlossen. Bei Fragen bitte ans Orga-Team wenden.</p>` : ''}
    <div class="progress">
      <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <span><b>${taken}</b> von ${total} Plätzen belegt${open > 0 ? ` · noch <b>${open}</b> frei` : ' · alles voll 🎉'}</span>
    </div>`;

  const html = stations.map((st) => {
    const rows = st.shifts
      .filter((sh) => !onlyFree || (status.get(sh.id)?.taken ?? 0) < sh.slots)
      .map(shiftRow).join('');
    if (!rows) return '';
    return `
      <article class="station">
        <header>
          <h2>${esc(st.name)}</h2>
          ${st.description ? `<div class="desc">${esc(st.description)}</div>` : ''}
        </header>
        ${rows}
      </article>`;
  }).join('');

  $('#stations').innerHTML = html ||
    `<div class="notice">${onlyFree ? 'Alle Schichten sind belegt. Vielen Dank!' : 'Es sind noch keine Schichten angelegt.'}</div>`;
}

function shiftRow(sh) {
  const s = status.get(sh.id) ?? { taken: 0, names: [] };
  const full = s.taken >= sh.slots;
  const names = s.names ?? [];
  const chips = [];
  for (let i = 0; i < sh.slots; i++) {
    if (i < s.taken) chips.push(`<span class="slot">${esc(names[i] ?? 'belegt')}</span>`);
    else chips.push(`<span class="slot free">frei</span>`);
  }
  // bei vielen Plätzen nicht jeden freien einzeln zeigen
  const freeCount = sh.slots - s.taken;
  const slotHtml = sh.slots > 8
    ? chips.slice(0, s.taken).join('') + (freeCount > 0 ? `<span class="slot free">${freeCount} frei</span>` : '')
    : chips.join('');

  return `
    <div class="shift ${full ? 'full' : ''}">
      <div class="time">${hm(sh.start_time)}–${hm(sh.end_time)}</div>
      <div class="slots"><span class="count">${Math.min(s.taken, sh.slots)}/${sh.slots}</span>${slotHtml}</div>
      <div>
        <button class="btn small" data-shift="${sh.id}" ${full || !event.signup_open ? 'disabled' : ''}>
          ${full ? 'Voll' : 'Eintragen'}
        </button>
      </div>
      ${sh.note ? `<div class="note">${esc(sh.note)}</div>` : ''}
    </div>`;
}

// ---------- Meine Schichten (auf diesem Gerät) ----------

async function renderMine() {
  const all = store.get(MINE_KEY, []);
  let mine = all.filter((m) => m.event_id === event.id);
  const box = $('#mine');
  if (!mine.length) { box.classList.add('hidden'); return; }

  // prüfen, ob die Einträge noch existieren (Orga kann löschen)
  const checks = await Promise.all(mine.map((m) => sb.rpc('get_signup', { p_token: m.token })));
  const stillThere = new Set(mine.filter((m, i) => !checks[i].error && checks[i].data?.length).map((m) => m.token));
  const anyFailed = checks.some((c) => c.error);
  if (!anyFailed) {
    mine = mine.filter((m) => stillThere.has(m.token));
    store.set(MINE_KEY, all.filter((m) => m.event_id !== event.id || stillThere.has(m.token)));
  }
  if (!mine.length) { box.classList.add('hidden'); return; }

  mine.sort((a, b) => a.start.localeCompare(b.start));
  box.innerHTML = `
    <h3>Deine Schichten</h3>
    <ul>${mine.map((m) => `
      <li>
        <span><b>${hm(m.start)}–${hm(m.end)}</b> ${esc(m.station)} <span class="muted">(${esc(m.name)})</span></span>
        <span class="row">
          <button class="btn link" data-ics="${m.token}">Kalender</button>
          <button class="btn small ghost" data-cancel="${m.token}">Austragen</button>
        </span>
      </li>`).join('')}
    </ul>`;
  box.classList.remove('hidden');
}

// ---------- Eintragen ----------

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.shift) openSignup(t.dataset.shift);
  if (t.hasAttribute('data-close')) t.closest('dialog').close();
  if (t.dataset.cancel) quickCancel(t.dataset.cancel);
  if (t.dataset.ics) {
    const m = store.get(MINE_KEY, []).find((x) => x.token === t.dataset.ics);
    if (m) downloadIcs(m);
  }
});

$('#filterFree').addEventListener('click', (e) => {
  onlyFree = !onlyFree;
  e.currentTarget.setAttribute('aria-pressed', String(onlyFree));
  render();
});

function findShift(id) {
  for (const st of stations) {
    const sh = st.shifts.find((x) => x.id === id);
    if (sh) return { ...sh, station: st };
  }
}

function openSignup(id) {
  current = findShift(id);
  if (!current) return;
  const form = $('#signupForm');
  form.reset();
  const person = store.get(PERSON_KEY, {});
  form.name.value = person.name ?? '';
  form.email.value = person.email ?? '';
  form.phone.value = person.phone ?? '';
  $('#formError').classList.add('hidden');
  $('#dlgTitle').textContent = current.station.name;
  $('#dlgSub').textContent = `${fmtDate(event.event_date, { weekday: 'short', day: 'numeric', month: 'long' })}, ${hm(current.start_time)}–${hm(current.end_time)} Uhr`;
  $('#signupDlg').showModal();
  (form.name.value ? form.comment : form.name).focus();
}

$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const err = $('#formError');
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  if (name.length < 2) return showErr('Bitte deinen Namen angeben.', form.name);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr('Bitte eine gültige E-Mail-Adresse angeben.', form.email);

  const btn = $('#submitBtn');
  btn.disabled = true; btn.textContent = 'Wird gespeichert …';
  const { data: token, error } = await sb.rpc('sign_up', {
    p_shift_id: current.id, p_name: name, p_email: email,
    p_phone: form.phone.value.trim() || null, p_comment: form.comment.value.trim() || null,
  });
  btn.disabled = false; btn.textContent = 'Verbindlich eintragen';

  if (error) { await refreshStatus(); return showErr(errText(error)); }

  store.set(PERSON_KEY, { name, email, phone: form.phone.value.trim() });
  const entry = {
    token, event_id: event.id, station: current.station.name,
    start: current.start_time, end: current.end_time, name,
  };
  store.set(MINE_KEY, [...store.get(MINE_KEY, []), entry]);
  lastDone = entry;

  $('#signupDlg').close();
  $('#doneSub').textContent = `${current.station.name}, ${hm(current.start_time)}–${hm(current.end_time)} Uhr am ${fmtDate(event.event_date, { day: 'numeric', month: 'long' })}.`;
  $('#cancelLink').value = cancelUrl(token);
  $('#doneDlg').showModal();
  refreshStatus();
  renderMine();

  function showErr(msg, field) {
    err.textContent = msg;
    err.classList.remove('hidden');
    field?.focus();
  }
});

$('#copyLink').addEventListener('click', async () => {
  const input = $('#cancelLink');
  try { await navigator.clipboard.writeText(input.value); toast('Link kopiert'); }
  catch { input.select(); document.execCommand('copy'); toast('Link kopiert'); }
});
$('#icsBtn').addEventListener('click', () => lastDone && downloadIcs(lastDone));

function cancelUrl(token) {
  return `${location.origin}${location.pathname}#abmelden=${token}`;
}

function downloadIcs(m) {
  download(icsFile({
    title: `Helferdienst: ${m.station} (${event.title})`,
    date: event.event_date, start: m.start, end: m.end,
    location: event.location,
    description: `Austragen: ${cancelUrl(m.token)}`,
  }), 'helferdienst.ics');
}

async function quickCancel(token) {
  const m = store.get(MINE_KEY, []).find((x) => x.token === token);
  if (!confirm(`Wirklich austragen${m ? ` aus „${m.station}“ ${hm(m.start)}–${hm(m.end)}` : ''}?`)) return;
  const { error } = await sb.rpc('cancel_signup', { p_token: token });
  if (error) return toast(errText(error), 'error');
  store.set(MINE_KEY, store.get(MINE_KEY, []).filter((x) => x.token !== token));
  toast('Du bist ausgetragen.');
  refreshStatus();
  renderMine();
}

// ---------- Austragen über Link ----------

async function showCancelView(token) {
  $('#verein').textContent = VEREIN;
  $('#main').classList.add('hidden');
  const view = $('#cancelView');
  view.classList.remove('hidden');
  view.innerHTML = `<div class="skeleton" style="margin-top:-30px"></div>`;
  $('#title').textContent = 'Austragen';

  const { data, error } = await sb.rpc('get_signup', { p_token: token });
  if (error) {
    view.innerHTML = `<div class="notice">${esc(errText(error))}</div>`;
    return;
  }
  const s = data?.[0];
  if (!s) {
    view.innerHTML = `<div class="notice"><p>Diese Anmeldung gibt es nicht mehr – vielleicht bist du schon ausgetragen.</p>
      <a class="btn" href="${location.pathname}">Zum Schichtplan</a></div>`;
    return;
  }
  view.innerHTML = `
    <div class="lead-card">
      <p><b>${esc(s.name)}</b><br>
      ${esc(s.station)}, ${hm(s.start_time)}–${hm(s.end_time)} Uhr<br>
      ${esc(s.event_title)}, ${esc(fmtDate(s.event_date))}</p>
      <div class="row">
        <button class="btn danger" id="doCancel">Ja, austragen</button>
        <a class="btn ghost" href="${location.pathname}">Zum Schichtplan</a>
      </div>
    </div>`;
  $('#doCancel').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const { error } = await sb.rpc('cancel_signup', { p_token: token });
    if (error) { e.currentTarget.disabled = false; return toast(errText(error), 'error'); }
    store.set(MINE_KEY, store.get(MINE_KEY, []).filter((x) => x.token !== token));
    view.innerHTML = `<div class="notice"><p>Du bist ausgetragen. Danke, dass du Bescheid gegeben hast!</p>
      <a class="btn" href="${location.pathname}">Andere Schicht wählen</a></div>`;
  });
}

window.addEventListener('hashchange', () => location.reload());
