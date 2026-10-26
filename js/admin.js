import { sb, $, esc, hm, fmtDate, toast, errText, download, store, todayIso } from './common.js';

const EVENT_KEY = 'spielfest-orga-event';

let events = [];
let event = null;
let stations = [];   // inkl. shifts, sortiert
let signups = [];
let activeTab = 'overview';

// ---------- Anmeldung ----------

sb.auth.onAuthStateChange((evt, session) => {
  if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') {
    setTimeout(() => route(session), 0);
  }
});

async function route(session) {
  for (const id of ['#loginView', '#noAccess', '#appView']) $(id).classList.add('hidden');
  $('#logout').classList.toggle('hidden', !session);
  $('#eventSelect').classList.add('hidden');

  if (!session) { $('#loginView').classList.remove('hidden'); return; }

  const { data: ok, error } = await sb.rpc('is_admin');
  if (error || !ok) {
    $('#noAccessEmail').textContent = session.user.email;
    $('#noAccess').classList.remove('hidden');
    return;
  }
  // Über einen Anmelde-Link gekommen? Dann gleich anbieten, ein Passwort festzulegen.
  const viaLink = location.hash.includes('access_token') || location.search.includes('code=');
  if (viaLink) history.replaceState(null, '', location.pathname);
  $('#appView').classList.remove('hidden');
  await loadEvents();
  if (viaLink) openPwDialog(session.user.email);
}

function loginMsg(text, isError) {
  const msg = $('#loginMsg');
  msg.className = isError ? 'error' : '';
  msg.textContent = text;
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = f.email.value.trim();
  const password = f.password.value;
  if (!password) return loginMsg('Bitte Passwort eingeben – oder unten einen Anmelde-Link anfordern.', true);
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) {
    loginMsg(/invalid login credentials/i.test(error.message)
      ? 'E-Mail oder Passwort stimmt nicht. Noch kein Passwort festgelegt? Dann unten einen Anmelde-Link anfordern.'
      : errText(error), true);
  }
});

$('#sendLink').addEventListener('click', async () => {
  const email = $('#loginForm').email.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    $('#loginForm').email.focus();
    return loginMsg('Bitte oben zuerst deine E-Mail-Adresse eintragen.', true);
  }
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  loginMsg(error
    ? errText(error)
    : `Link ist unterwegs an ${email}. Bitte den Link auf diesem Gerät öffnen – danach kannst du ein Passwort festlegen.`, !!error);
});

// ---------- Passwort ----------

function openPwDialog(email) {
  const f = $('#pwForm');
  f.reset();
  f.username.value = email;
  $('#pwError').classList.add('hidden');
  $('#pwDlg').showModal();
  f.pw1.focus();
}

$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const err = $('#pwError');
  const show = (m) => { err.textContent = m; err.classList.remove('hidden'); };
  if (f.pw1.value.length < 8) return show('Bitte mindestens 8 Zeichen.');
  if (f.pw1.value !== f.pw2.value) return show('Die beiden Passwörter sind nicht gleich.');
  const { error } = await sb.auth.updateUser({ password: f.pw1.value });
  if (error) {
    return show(/same/i.test(error.message) ? 'Das ist schon dein aktuelles Passwort.'
      : /weak|short|characters/i.test(error.message) ? 'Das Passwort ist zu schwach. Bitte ein längeres wählen.'
      : errText(error));
  }
  $('#pwDlg').close();
  toast('Passwort gespeichert. Ab jetzt reicht E-Mail + Passwort.');
});

$('#logout').addEventListener('click', () => sb.auth.signOut());

// ---------- Daten laden ----------

async function loadEvents(selectId) {
  const { data, error } = await sb.from('events').select('*').order('event_date', { ascending: false });
  if (error) return toast(errText(error), 'error');
  events = data;
  const sel = $('#eventSelect');
  if (!events.length) {
    event = null;
    sel.classList.add('hidden');
    $('#tab-overview').innerHTML = `<div class="notice"><p>Noch kein Spielfest angelegt.</p>
      <button class="btn" data-action="new-event">Erstes Spielfest anlegen</button></div>`;
    showTab('overview');
    return;
  }
  const wanted = selectId || store.get(EVENT_KEY, null);
  event = events.find((e) => e.id === wanted)
    ?? events.filter((e) => e.event_date >= todayIso()).at(-1)
    ?? events[0];
  sel.innerHTML = events.map((e) =>
    `<option value="${e.id}" ${e.id === event.id ? 'selected' : ''}>${esc(e.title)} · ${fmtDate(e.event_date, { day: '2-digit', month: '2-digit', year: 'numeric' })}</option>`).join('');
  sel.classList.remove('hidden');
  store.set(EVENT_KEY, event.id);
  await loadEventData();
}

$('#eventSelect').addEventListener('change', (e) => loadEvents(e.target.value));

async function loadEventData() {
  const { data: st, error } = await sb.from('stations')
    .select('id, name, description, sort_order, shifts(id, start_time, end_time, slots, note)')
    .eq('event_id', event.id).order('sort_order').order('name');
  if (error) return toast(errText(error), 'error');
  stations = st.map((s) => ({ ...s, shifts: s.shifts.sort((a, b) => a.start_time.localeCompare(b.start_time)) }));

  const ids = stations.flatMap((s) => s.shifts.map((x) => x.id));
  signups = [];
  if (ids.length) {
    const { data, error: e2 } = await sb.from('signups')
      .select('id, shift_id, name, email, phone, comment, created_at')
      .in('shift_id', ids).order('created_at');
    if (e2) return toast(errText(e2), 'error');
    signups = data;
  }
  renderAll();
}

const shiftById = (id) => {
  for (const st of stations) {
    const sh = st.shifts.find((x) => x.id === id);
    if (sh) return { ...sh, station: st };
  }
};
const signupsFor = (shiftId) => signups.filter((s) => s.shift_id === shiftId);

// ---------- Tabs ----------

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) showTab(b.dataset.tab);
});

function showTab(tab) {
  activeTab = tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const t of ['overview', 'helpers', 'plan', 'settings']) $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
}

function renderAll() {
  renderOverview();
  renderHelpers();
  renderPlan();
  renderSettings();
  showTab(activeTab);
}

// ---------- Übersicht ----------

function publicUrl() {
  const base = location.origin + location.pathname.replace(/admin\.html$/, '');
  return `${base}?e=${encodeURIComponent(event.slug)}`;
}

function renderOverview() {
  let total = 0, taken = 0;
  const gaps = [];
  for (const st of stations) for (const sh of st.shifts) {
    const n = signupsFor(sh.id).length;
    total += sh.slots;
    taken += Math.min(n, sh.slots);
    if (n < sh.slots) gaps.push({ st, sh, missing: sh.slots - n });
  }
  const people = new Set(signups.map((s) => s.name.trim().toLowerCase() + '|' + s.email)).size;

  $('#tab-overview').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${taken}/${total}</b><span>Plätze belegt</span></div>
      <div class="stat"><b>${total - taken}</b><span>Plätze offen</span></div>
      <div class="stat"><b>${people}</b><span>Helfer*innen</span></div>
      <div class="stat"><b>${event.signup_open ? 'offen' : 'zu'}</b><span>Anmeldung</span></div>
    </div>

    <div class="card">
      <h2>Link für die Eltern</h2>
      <div class="linkbox">
        <input id="pubLink" readonly value="${esc(publicUrl())}" aria-label="Öffentlicher Link">
        <button class="btn small ghost" data-action="copy-pub">Kopieren</button>
        <a class="btn small" href="${esc(publicUrl())}" target="_blank" rel="noopener">Öffnen</a>
      </div>
      <p class="muted" style="font-size:13px;margin:6px 0 0">Ohne <code>?e=…</code> zeigt die Seite automatisch das nächste anstehende Spielfest.</p>
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Hier fehlt noch jemand</h2><span class="spacer"></span>
        ${gaps.length ? `<button class="btn small ghost" data-action="copy-gaps">Als Text kopieren</button>` : ''}</div>
      ${gaps.length ? `<table class="list" style="margin-top:8px"><tbody>
        ${gaps.map(({ st, sh, missing }) => `<tr><td>${esc(st.name)}</td><td>${hm(sh.start_time)}–${hm(sh.end_time)}</td><td><b>${missing}</b> fehlt</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Alle Schichten sind voll besetzt. 🎉</p>'}
    </div>`;
}

function gapsText() {
  const lines = [`${event.title} am ${fmtDate(event.event_date)} – wir suchen noch Helfer:`];
  for (const st of stations) for (const sh of st.shifts) {
    const missing = sh.slots - signupsFor(sh.id).length;
    if (missing > 0) lines.push(`• ${st.name} ${hm(sh.start_time)}–${hm(sh.end_time)}: ${missing} ${missing === 1 ? 'Person' : 'Personen'}`);
  }
  lines.push('', `Eintragen: ${publicUrl()}`);
  return lines.join('\n');
}

// ---------- Helfer ----------

function renderHelpers() {
  const groups = stations.map((st) => {
    const rows = st.shifts.map((sh) => {
      const list = signupsFor(sh.id);
      return `
        <tr><th colspan="5" style="padding-top:12px;color:var(--text);font-size:13px">
          ${hm(sh.start_time)}–${hm(sh.end_time)} · ${list.length}/${sh.slots}
        </th></tr>
        ${list.map((s) => `<tr>
          <td>${esc(s.name)}</td>
          <td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td>
          <td>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : ''}</td>
          <td>${esc(s.comment ?? '')}</td>
          <td class="no-print" style="text-align:right"><button class="btn small ghost" data-del-signup="${s.id}" title="Austragen">✕</button></td>
        </tr>`).join('') || `<tr><td colspan="5" class="muted">noch niemand</td></tr>`}`;
    }).join('');
    return `<div class="helper-group"><h3>${esc(st.name)}</h3>
      <div class="table-scroll"><table class="list helpers">
        <colgroup><col style="width:24%"><col style="width:30%"><col style="width:16%"><col><col style="width:52px"></colgroup>
        <tbody>${rows}</tbody></table></div></div>`;
  }).join('');

  $('#tab-helpers').innerHTML = `
    <div class="row no-print" style="margin-bottom:12px">
      <button class="btn small" data-action="add-helper" ${stations.some((s) => s.shifts.length) ? '' : 'disabled'}>+ Helfer eintragen</button>
      <span class="spacer"></span>
      <button class="btn small ghost" data-action="copy-emails" ${signups.length ? '' : 'disabled'}>E-Mails kopieren</button>
      <button class="btn small ghost" data-action="csv" ${signups.length ? '' : 'disabled'}>CSV/Excel</button>
      <button class="btn small ghost" data-action="print">Drucken</button>
    </div>
    <div class="card">
      <h2>${esc(event.title)} · ${esc(fmtDate(event.event_date))}</h2>
      ${groups || '<p class="muted">Noch keine Stationen angelegt.</p>'}
    </div>`;
}

function exportCsv() {
  const head = ['Station', 'Beginn', 'Ende', 'Name', 'E-Mail', 'Telefon', 'Bemerkung', 'Eingetragen am'];
  const rows = [head];
  for (const st of stations) for (const sh of st.shifts) for (const s of signupsFor(sh.id)) {
    rows.push([st.name, hm(sh.start_time), hm(sh.end_time), s.name, s.email, s.phone ?? '', s.comment ?? '',
      new Date(s.created_at).toLocaleString('de-DE')]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `helfer-${event.slug}.csv`);
}

function openAddHelper() {
  const form = $('#addHelperForm');
  form.reset();
  form.shift.innerHTML = stations.map((st) => `<optgroup label="${esc(st.name)}">${
    st.shifts.map((sh) => {
      const n = signupsFor(sh.id).length;
      return `<option value="${sh.id}">${hm(sh.start_time)}–${hm(sh.end_time)} (${n}/${sh.slots})</option>`;
    }).join('')}</optgroup>`).join('');
  $('#addHelperDlg').showModal();
}

$('#addHelperForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  // Orga darf auch über die Platzzahl hinaus eintragen, daher direkt in die Tabelle
  const { error } = await sb.from('signups').insert({
    shift_id: f.shift.value, name: f.name.value.trim(), email: f.email.value.trim().toLowerCase(),
    phone: f.phone.value.trim() || null, comment: f.comment.value.trim() || null,
  });
  if (error) return toast(errText(error), 'error');
  $('#addHelperDlg').close();
  toast('Eingetragen');
  loadEventData();
});

// ---------- Schichtplan bearbeiten ----------

function renderPlan() {
  $('#tab-plan').innerHTML = `
    <p class="muted" style="margin-top:0;font-size:14px">Änderungen werden sofort gespeichert, sobald du ein Feld verlässt.</p>
    ${stations.map((st) => `
      <div class="card station-edit" data-station="${st.id}">
        <header>
          <input class="name" data-field="name" value="${esc(st.name)}" aria-label="Name der Station">
          <input data-field="sort_order" type="number" value="${st.sort_order}" title="Reihenfolge" aria-label="Reihenfolge">
          <button class="btn small ghost" data-del-station="${st.id}" title="Station löschen">Löschen</button>
          <textarea data-field="description" rows="1" placeholder="Beschreibung (optional)" style="grid-column:1/4">${esc(st.description ?? '')}</textarea>
        </header>
        <div style="margin-top:8px">
          <div class="shift-edit head muted" style="font-size:12px;border:0;padding-bottom:0">
            <span>Beginn</span><span>Ende</span><span>Plätze</span><span class="wide">Hinweis</span><span></span>
          </div>
          ${st.shifts.map((sh) => {
            const n = signupsFor(sh.id).length;
            return `
            <div class="shift-edit" data-shift="${sh.id}">
              <input type="time" data-field="start_time" value="${hm(sh.start_time)}" aria-label="Beginn">
              <input type="time" data-field="end_time" value="${hm(sh.end_time)}" aria-label="Ende">
              <input type="number" min="1" max="100" data-field="slots" value="${sh.slots}" aria-label="Plätze">
              <input class="wide" data-field="note" value="${esc(sh.note ?? '')}" placeholder="optional" aria-label="Hinweis">
              <span class="row" style="flex-wrap:nowrap">
                <span class="occ" title="eingetragen">${n} ✓</span>
                <button class="btn small ghost" data-del-shift="${sh.id}" title="Schicht löschen">✕</button>
              </span>
            </div>`;
          }).join('')}
          <button class="btn small ghost" style="margin-top:8px" data-add-shift="${st.id}">+ Schicht</button>
        </div>
      </div>`).join('')}
    <button class="btn" data-action="add-station">+ Station hinzufügen</button>`;
}

// Speichern beim Verlassen eines Feldes
$('#tab-plan').addEventListener('change', async (e) => {
  const input = e.target;
  const field = input.dataset.field;
  if (!field) return;
  let value = input.value;
  if (field === 'slots' || field === 'sort_order') value = parseInt(value, 10) || (field === 'slots' ? 1 : 0);
  if (field === 'note' || field === 'description') value = value.trim() || null;
  if (field === 'name') value = value.trim();

  const shiftEl = input.closest('[data-shift]');
  const stationEl = input.closest('[data-station]');
  let res;
  if (shiftEl) {
    const patch = { [field]: value };
    // Beginn/Ende zusammen prüfen
    const start = shiftEl.querySelector('[data-field=start_time]').value;
    const end = shiftEl.querySelector('[data-field=end_time]').value;
    if ((field === 'start_time' || field === 'end_time') && start >= end) {
      return toast('Das Ende muss nach dem Beginn liegen.', 'error');
    }
    if (field === 'slots') {
      const n = signupsFor(shiftEl.dataset.shift).length;
      if (value < n) toast(`Achtung: Es sind schon ${n} Personen eingetragen.`);
    }
    res = await sb.from('shifts').update(patch).eq('id', shiftEl.dataset.shift);
  } else if (stationEl) {
    if (field === 'name' && !value) return toast('Die Station braucht einen Namen.', 'error');
    res = await sb.from('stations').update({ [field]: value }).eq('id', stationEl.dataset.station);
  }
  if (res?.error) { toast(errText(res.error), 'error'); return loadEventData(); }
  toast('Gespeichert');
  // Daten neu laden, ohne den Fokus zu stören
  const { data } = await sb.from('stations')
    .select('id, name, description, sort_order, shifts(id, start_time, end_time, slots, note)')
    .eq('event_id', event.id).order('sort_order').order('name');
  if (data) {
    stations = data.map((s) => ({ ...s, shifts: s.shifts.sort((a, b) => a.start_time.localeCompare(b.start_time)) }));
    renderOverview(); renderHelpers();
  }
});

async function addStation() {
  const order = Math.max(0, ...stations.map((s) => s.sort_order)) + 1;
  const { error } = await sb.from('stations').insert({ event_id: event.id, name: 'Neue Station', sort_order: order });
  if (error) return toast(errText(error), 'error');
  await loadEventData();
  const last = [...document.querySelectorAll('#tab-plan .station-edit .name')].at(-1);
  last?.focus(); last?.select();
}

async function addShift(stationId) {
  const st = stations.find((s) => s.id === stationId);
  const last = st.shifts.at(-1);
  const start = last ? hm(last.end_time) : '09:00';
  const [h, m] = start.split(':').map(Number);
  let end = `${String(Math.min(h + 2, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (end <= start) end = '23:59';
  const { error } = await sb.from('shifts').insert({
    station_id: stationId, start_time: start, end_time: end, slots: last?.slots ?? 2,
  });
  if (error) return toast(errText(error), 'error');
  loadEventData();
}

async function deleteShift(id) {
  const n = signupsFor(id).length;
  const sh = shiftById(id);
  if (!confirm(`Schicht ${sh.station.name} ${hm(sh.start_time)}–${hm(sh.end_time)} löschen?${n ? `\n\n${n} Eintragung(en) gehen dabei verloren!` : ''}`)) return;
  const { error } = await sb.from('shifts').delete().eq('id', id);
  if (error) return toast(errText(error), 'error');
  toast('Schicht gelöscht');
  loadEventData();
}

async function deleteStation(id) {
  const st = stations.find((s) => s.id === id);
  const n = st.shifts.reduce((a, sh) => a + signupsFor(sh.id).length, 0);
  if (!confirm(`Station „${st.name}“ mit allen Schichten löschen?${n ? `\n\n${n} Eintragung(en) gehen dabei verloren!` : ''}`)) return;
  const { error } = await sb.from('stations').delete().eq('id', id);
  if (error) return toast(errText(error), 'error');
  toast('Station gelöscht');
  loadEventData();
}

async function deleteSignup(id) {
  const s = signups.find((x) => x.id === id);
  if (!confirm(`${s.name} austragen?`)) return;
  const { error } = await sb.from('signups').delete().eq('id', id);
  if (error) return toast(errText(error), 'error');
  toast('Ausgetragen');
  loadEventData();
}

// ---------- Einstellungen ----------

function renderSettings() {
  const e = event;
  $('#tab-settings').innerHTML = `
    <form class="card" id="eventForm">
      <h2>Spielfest</h2>
      <label class="field">Titel <input name="title" required value="${esc(e.title)}"></label>
      <div class="grid2">
        <label class="field">Datum <input name="event_date" type="date" required value="${e.event_date}"></label>
        <label class="field">Ort <input name="location" value="${esc(e.location ?? '')}"></label>
      </div>
      <label class="field">Text für die Eltern <textarea name="description" rows="4">${esc(e.description ?? '')}</textarea></label>
      <div class="grid2">
        <label class="field">Ansprechpartner <input name="contact_name" value="${esc(e.contact_name ?? '')}"></label>
        <label class="field">Kontakt-E-Mail <input name="contact_email" type="email" value="${esc(e.contact_email ?? '')}"></label>
      </div>
      <label class="field">Kurzname für den Link <small>(a-z, 0-9, -)</small>
        <input name="slug" required pattern="[a-z0-9\\-]{3,60}" value="${esc(e.slug)}"></label>
      <label class="check"><input type="checkbox" name="signup_open" ${e.signup_open ? 'checked' : ''}> Anmeldung ist offen</label>
      <label class="check"><input type="checkbox" name="show_names" ${e.show_names ? 'checked' : ''}> Namen im öffentlichen Plan zeigen (als „Vorname N.“)</label>
      <button class="btn" type="submit">Speichern</button>
    </form>

    <div class="card">
      <h2>Orga-Team</h2>
      <p class="muted" style="margin-top:0">Diese Adressen dürfen in den Orga-Bereich. Neue Mitglieder melden sich beim ersten Mal über „Anmelde-Link per E-Mail schicken“ an und legen dabei ihr Passwort fest.</p>
      <div id="adminList" class="muted">Lädt …</div>
      <form id="addAdminForm" class="row" style="margin-top:10px">
        <input name="email" type="email" required placeholder="name@example.org" aria-label="E-Mail für Orga-Zugang"
          style="flex:1;min-width:180px;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--bg)">
        <button class="btn small" type="submit">Freischalten</button>
      </form>
      <div class="row" style="margin-top:14px">
        <button class="btn small ghost" data-action="set-password">Mein Passwort ändern</button>
      </div>
    </div>

    <div class="card">
      <h2>Nächstes Jahr</h2>
      <p class="muted" style="margin-top:0">Kopiert alle Stationen und Schichten in ein neues Spielfest – ohne die Eintragungen.</p>
      <div class="row">
        <button class="btn ghost" data-action="copy-event">Als Vorlage kopieren</button>
        <button class="btn ghost" data-action="new-event">Leeres Spielfest anlegen</button>
      </div>
    </div>

    <div class="card">
      <h2>Löschen</h2>
      <p class="muted" style="margin-top:0">Löscht dieses Spielfest mit allen Stationen, Schichten und Eintragungen. Das lässt sich nicht rückgängig machen.</p>
      <button class="btn danger" data-action="delete-event">Spielfest löschen</button>
    </div>`;

  renderAdmins();
  $('#addAdminForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = ev.currentTarget.email;
    const email = input.value.trim().toLowerCase();
    const { error } = await sb.from('admins').insert({ email });
    if (error) return toast(/duplicate/.test(error.message) ? 'Diese Adresse ist schon freigeschaltet.' : errText(error), 'error');
    input.value = '';
    toast(`${email} ist freigeschaltet`);
    renderAdmins();
  });

  $('#eventForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const patch = {
      title: f.title.value.trim(), event_date: f.event_date.value, location: f.location.value.trim() || null,
      description: f.description.value.trim() || null, contact_name: f.contact_name.value.trim() || null,
      contact_email: f.contact_email.value.trim() || null, slug: f.slug.value.trim(),
      signup_open: f.signup_open.checked, show_names: f.show_names.checked,
    };
    const { error } = await sb.from('events').update(patch).eq('id', event.id);
    if (error) return toast(/duplicate/.test(error.message) ? 'Dieser Kurzname ist schon vergeben.' : errText(error), 'error');
    toast('Gespeichert');
    loadEvents(event.id);
  });
}

async function renderAdmins() {
  const box = $('#adminList');
  if (!box) return;
  const [{ data, error }, { data: me }] = await Promise.all([
    sb.from('admins').select('email').order('email'),
    sb.auth.getUser(),
  ]);
  if (error) { box.textContent = errText(error); return; }
  const myEmail = me.user?.email?.toLowerCase();
  box.innerHTML = `<table class="list"><tbody>${data.map((a) => `
    <tr><td style="color:var(--text)">${esc(a.email)}${a.email === myEmail ? ' <span class="muted">(du)</span>' : ''}</td>
      <td style="text-align:right">${a.email === myEmail ? ''
        : `<button class="btn small ghost" data-del-admin="${esc(a.email)}" title="Zugang entfernen">✕</button>`}</td></tr>`).join('')}
  </tbody></table>`;
}

async function deleteAdmin(email) {
  if (!confirm(`Orga-Zugang für ${email} entfernen?`)) return;
  const { error } = await sb.from('admins').delete().eq('email', email);
  if (error) return toast(errText(error), 'error');
  toast('Zugang entfernt');
  renderAdmins();
}

function openNewEvent(copyFrom) {
  const f = $('#newEventForm');
  f.reset();
  f.copy_from.value = copyFrom ? event.id : '';
  $('#newEventTitle').textContent = copyFrom ? 'Spielfest kopieren' : 'Neues Spielfest';
  $('#newEventSub').textContent = copyFrom ? `Vorlage: ${event.title} (${fmtDate(event.event_date)})` : '';
  const year = (event ? new Date(event.event_date).getFullYear() : new Date().getFullYear()) + 1;
  f.title.value = event?.title ?? 'Handball-Spielfest F-Jugend';
  f.slug.value = `spielfest-${year}`;
  $('#newEventDlg').showModal();
}

$('#newEventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const src = f.copy_from.value ? event : null;
  const { data: ne, error } = await sb.from('events').insert({
    title: f.title.value.trim(), event_date: f.event_date.value, slug: f.slug.value.trim(),
    location: src?.location ?? null, description: src?.description ?? null,
    contact_name: src?.contact_name ?? null, contact_email: src?.contact_email ?? null,
    show_names: src?.show_names ?? true, signup_open: true,
  }).select().single();
  if (error) return toast(/duplicate/.test(error.message) ? 'Dieser Kurzname ist schon vergeben.' : errText(error), 'error');

  if (src) {
    for (const st of stations) {
      const { data: ns, error: e1 } = await sb.from('stations')
        .insert({ event_id: ne.id, name: st.name, description: st.description, sort_order: st.sort_order })
        .select().single();
      if (e1) { toast(errText(e1), 'error'); break; }
      if (st.shifts.length) {
        const { error: e2 } = await sb.from('shifts').insert(st.shifts.map((sh) => ({
          station_id: ns.id, start_time: sh.start_time, end_time: sh.end_time, slots: sh.slots, note: sh.note,
        })));
        if (e2) { toast(errText(e2), 'error'); break; }
      }
    }
  }
  $('#newEventDlg').close();
  toast('Spielfest angelegt');
  activeTab = 'settings';
  loadEvents(ne.id);
});

async function deleteEvent() {
  const answer = prompt(`Zum Löschen bitte den Kurznamen eintippen: ${event.slug}`);
  if (answer !== event.slug) { if (answer !== null) toast('Kurzname stimmt nicht – nichts gelöscht.', 'error'); return; }
  const { error } = await sb.from('events').delete().eq('id', event.id);
  if (error) return toast(errText(error), 'error');
  toast('Spielfest gelöscht');
  store.set(EVENT_KEY, null);
  activeTab = 'overview';
  loadEvents();
}

// ---------- Klicks ----------

async function copy(text, msg = 'Kopiert') {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { prompt('Zum Kopieren:', text); }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-close')) return b.closest('dialog').close();
  if (b.dataset.delSignup) return deleteSignup(b.dataset.delSignup);
  if (b.dataset.delAdmin) return deleteAdmin(b.dataset.delAdmin);
  if (b.dataset.delShift) return deleteShift(b.dataset.delShift);
  if (b.dataset.delStation) return deleteStation(b.dataset.delStation);
  if (b.dataset.addShift) return addShift(b.dataset.addShift);
  switch (b.dataset.action) {
    case 'copy-pub': return copy(publicUrl(), 'Link kopiert');
    case 'copy-gaps': return copy(gapsText(), 'Text kopiert – z. B. für die WhatsApp-Gruppe');
    case 'copy-emails': return copy([...new Set(signups.map((s) => s.email))].join('; '), 'E-Mail-Adressen kopiert (für BCC)');
    case 'csv': return exportCsv();
    case 'print': return window.print();
    case 'add-helper': return openAddHelper();
    case 'add-station': return addStation();
    case 'copy-event': return openNewEvent(true);
    case 'new-event': return openNewEvent(false);
    case 'delete-event': return deleteEvent();
    case 'set-password': return sb.auth.getUser().then(({ data }) => openPwDialog(data.user?.email ?? ''));
  }
});
