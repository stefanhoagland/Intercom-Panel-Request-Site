const $ = (id) => document.getElementById(id);
let pollTimer = null, lastUnread = null, viewing = null;
const openShows = new Set(); // shows expanded in the list, kept across re-renders

function show(section) {
  $('login').classList.toggle('hidden', section !== 'login');
  $('dash').classList.toggle('hidden', section !== 'dash');
  $('logout').classList.toggle('hidden', section !== 'dash');
}

async function start() {
  const { role } = await api('me');
  if (role !== 'admin') return show('login');
  show('dash');
  refresh();
  loadPhotos();
  loadBackups();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => refresh(false), 15000);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('login', { method: 'POST', body: { password: $('pw').value, as: 'admin' } });
    $('pw').value = ''; $('loginError').textContent = '';
    start();
  } catch (err) { $('loginError').textContent = err.message; }
};
$('logout').onclick = async () => { await api('logout', { method: 'POST' }); clearInterval(pollTimer); show('login'); };

// Polls notifications; the show tree only re-renders when something changed, so typing isn't interrupted.
async function refresh(force = true) {
  const notifs = await api('notifications');
  const unread = notifs.filter((n) => !n.read);
  if (force || unread.length !== lastUnread) renderTree(await api('tree?all=1'));

  // Alert when a new submission arrives while the page is open.
  if (lastUnread !== null && unread.length > lastUnread && 'Notification' in window && Notification.permission === 'granted') {
    const n = unread[0];
    new Notification('Panel ready to program', { body: `${placeOf(n)}${n.submittedBy ? ' from ' + n.submittedBy : ''}` });
  }
  lastUnread = unread.length;
  document.title = (unread.length ? `(${unread.length}) ` : '') + 'Intercom Admin';
  $('unread').textContent = unread.length;
  $('unread').classList.toggle('hidden', !unread.length);

  const list = $('notifs');
  list.innerHTML = '';
  for (const n of notifs.slice(0, 30)) {
    list.append(el('div', { class: 'notif' + (n.read ? '' : ' unread') },
      el('div', {}, el('strong', {}, placeOf(n)), ' is ready to program',
        n.submittedBy ? ` (submitted by ${n.submittedBy})` : '', el('div', { class: 'muted' }, when(n.at))),
      el('button', { onclick: () => openViewer(n.positionId) }, 'View panel')));
  }
  if (!notifs.length) list.append(el('p', { class: 'muted' }, 'Nothing yet. You will see a notice here when someone submits a panel.'));

}

$('markRead').onclick = async () => { await api('notifications/read', { method: 'POST' }); refresh(); };

function placeOf(n) { return [n.showName, n.roomName, n.positionName].filter(Boolean).join(' › '); }

function inlineAdd(placeholder, onAdd) {
  const input = el('input', { type: 'text', placeholder, style: 'width:200px' });
  return el('form', { class: 'row', onsubmit: async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    await onAdd(input.value.trim());
    refresh();
  } }, input, el('button', {}, 'Add'));
}
async function renameThing(kind, obj, label) {
  const name = prompt(`Rename ${label}`, obj.name);
  if (name && name.trim()) { await api(`${kind}/${obj.id}`, { method: 'PATCH', body: { name } }); refresh(); }
}
async function deleteThing(kind, obj, warning) {
  if (!confirm(`Delete ${obj.name}? ${warning} This can't be undone.`)) return;
  await api(`${kind}/${obj.id}`, { method: 'DELETE' });
  refresh();
}

function renderTree(tree) {
  const box = $('shows');
  box.innerHTML = '';
  if (!tree.shows.length) box.append(el('p', { class: 'muted' }, 'No shows yet. Add one above.'));
  if (tree.shows.length === 1) openShows.add(tree.shows[0].id);
  for (const show of [...tree.shows].reverse()) {
    const rooms = tree.rooms.filter((r) => r.showId === show.id);
    const details = el('details', { class: 'show', open: openShows.has(show.id) });
    details.addEventListener('toggle', () => { details.open ? openShows.add(show.id) : openShows.delete(show.id); });
    const ready = tree.positions.filter((p) => rooms.some((r) => r.id === p.roomId) && p.status === 'submitted').length;
    details.append(el('summary', {},
      el('strong', {}, show.name),
      show.active ? null : el('span', { class: 'badge not_started', style: 'margin-left:8px' }, 'Hidden from operators'),
      ready ? el('span', { class: 'badge submitted', style: 'margin-left:8px' }, `${ready} ready to program`) : null,
      el('span', { class: 'muted', style: 'margin-left:8px' }, `${rooms.length} control room${rooms.length === 1 ? '' : 's'}`)));

    const body = el('div', { class: 'show-body' });
    body.append(el('div', { class: 'row', style: 'margin-bottom:12px' },
      el('button', { onclick: () => renameThing('shows', show, 'show') }, 'Rename show'),
      el('button', { onclick: async () => { await api('shows/' + show.id, { method: 'PATCH', body: { active: !show.active } }); refresh(); } },
        show.active ? 'Hide from operators' : 'Show to operators'),
      el('button', { onclick: async () => {
        const name = prompt('Name for the new show (control rooms and positions are copied, keys start blank)', show.name + ' (copy)');
        if (name && name.trim()) { const c = await api(`shows/${show.id}/copy`, { method: 'POST', body: { name } }); openShows.add(c.id); refresh(); }
      } }, 'Copy to new show'),
      el('button', { onclick: () => openImport(show) }, 'Import positions'),
      el('button', { class: 'danger', onclick: () => deleteThing('shows', show, 'All its control rooms, positions and key choices are deleted too.') }, 'Delete show')));

    for (const room of rooms) {
      const positions = tree.positions.filter((p) => p.roomId === room.id);
      body.append(el('div', { class: 'room' },
        el('div', { class: 'row' },
          el('h3', { style: 'margin:0;flex:1' }, room.name),
          el('button', { onclick: () => renameThing('rooms', room, 'control room') }, 'Rename'),
          el('button', { class: 'danger', onclick: () => deleteThing('rooms', room, 'Its positions and key choices are deleted too.') }, 'Delete')),
        el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ...['Position', 'Status', 'Keys', 'Submitted', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, positions.map((p) => el('tr', {},
            el('td', {}, el('strong', {}, p.name), p.alpha || p.port ? el('div', { class: 'muted' }, [p.alpha, p.port && 'port ' + p.port].filter(Boolean).join(' · ')) : null),
            el('td', {}, badge(p.status)),
            el('td', {}, `${p.keysUsed} / ${p.keysTotal}`),
            el('td', { class: 'muted' }, p.submittedAt ? `${when(p.submittedAt)}${p.submittedBy ? ' · ' + p.submittedBy : ''}` : ''),
            el('td', { style: 'white-space:nowrap;text-align:right' },
              el('button', { onclick: () => openViewer(p.id) }, 'View'), ' ',
              el('button', { onclick: () => editPosition(p) }, 'Edit'), ' ',
              el('button', { class: 'danger', onclick: () => deleteThing('positions', p, 'Its key choices are deleted too.') }, 'Delete'))))))),
        el('div', { style: 'margin-top:8px' }, inlineAdd('New position name', (name) => api('positions', { method: 'POST', body: { roomId: room.id, name } })))));
    }
    body.append(el('div', { style: 'margin-top:12px' }, inlineAdd('New control room name', (name) => api('rooms', { method: 'POST', body: { showId: show.id, name } }))));
    details.append(body);
    box.append(details);
  }
}

async function openViewer(id) {
  viewing = await api('positions/' + id);
  $('vTitle').textContent = placeOf({ showName: viewing.showName, roomName: viewing.roomName, positionName: viewing.name });
  $('vMeta').replaceChildren(badge(viewing.status),
    viewing.submittedBy ? `  Submitted by ${viewing.submittedBy} on ${when(viewing.submittedAt)}` : '',
    viewing.notes ? el('div', { style: 'margin-top:6px;color:var(--text)' }, 'Notes: ' + viewing.notes) : '');
  $('vPosActions').classList.remove('hidden');
  $('vBackupActions').classList.add('hidden');
  $('vBackupMsg').textContent = '';
  fillViewer(viewing.keys);
}

// A backup opens in the same viewer, with restore/download/delete instead of status buttons.
async function openBackup(id) {
  const [b, tree] = await Promise.all([api('backups/' + id), api('tree?all=1')]);
  viewing = { backup: b };
  $('vTitle').textContent = 'Backup: ' + placeOf(b);
  $('vMeta').replaceChildren(`Saved ${when(b.savedAt)}`, b.label ? ` · ${b.label}` : '',
    b.submittedBy ? ` · submitted by ${b.submittedBy}` : '',
    b.notes ? el('div', { style: 'margin-top:6px;color:var(--text)' }, 'Notes: ' + b.notes) : '');
  const select = $('vRestoreTo');
  select.innerHTML = '';
  for (const p of tree.positions) {
    select.append(el('option', { value: p.id, selected: p.id === b.positionId }, placeOf({ showName: p.showName, roomName: p.roomName, positionName: p.name }) + (p.id === b.positionId ? ' (original)' : '')));
  }
  $('vRestore').disabled = !tree.positions.length;
  $('vDownload').href = `/api/backups/${b.id}/download`;
  $('vPosActions').classList.add('hidden');
  $('vBackupActions').classList.remove('hidden');
  fillViewer(b.keys);
}

function fillViewer(keys) {
  renderRack($('vRack'), keys);
  const list = $('vList');
  list.innerHTML = '';
  for (const [panel, label] of [['kp4016', 'KP-4016'], ['kp5032', 'KP-5032']]) {
    keys[panel].forEach((k, i) => {
      if (!k.label) return;
      list.append(el('div', {}, el('strong', {}, `${label} ${i + 1}:`), ` ${k.label}`));
    });
  }
  if (!list.children.length) list.append(el('p', { class: 'muted' }, 'No keys set yet.'));
  $('vProgrammed').disabled = viewing.status === 'programmed';
  if (!$('viewer').open) $('viewer').showModal();
}
$('vBackup').onclick = async () => {
  const label = prompt('Optional note for this backup (e.g. "as programmed for opening night")', '');
  if (label === null) return;
  await api(`positions/${viewing.id}/backup`, { method: 'POST', body: { label } });
  $('vBackupMsg').textContent = 'Backup saved.';
  loadBackups();
};
$('vRestore').onclick = async () => {
  const option = $('vRestoreTo').selectedOptions[0];
  if (!confirm(`Replace all keys on ${option.textContent.replace(' (original)', '')} with this backup? Its current keys will be overwritten.`)) return;
  await api(`backups/${viewing.backup.id}/restore`, { method: 'POST', body: { positionId: Number(option.value) } });
  $('viewer').close();
  refresh();
  alert('Restored. The panel is back to "In progress" so the operator can review it and submit.');
};
$('vDeleteBackup').onclick = async () => {
  if (!confirm('Delete this backup and its file? This can\'t be undone.')) return;
  await api('backups/' + viewing.backup.id, { method: 'DELETE' });
  $('viewer').close();
  loadBackups();
};

let backups = [];
async function loadBackups() {
  backups = await api('backups');
  renderBackups();
}
function renderBackups() {
  const q = $('backupFilter').value.trim().toLowerCase();
  const rows = $('backupRows');
  rows.innerHTML = '';
  const shown = backups.filter((b) => !q || [b.showName, b.roomName, b.positionName, b.label, b.submittedBy].join(' ').toLowerCase().includes(q));
  for (const b of shown) {
    rows.append(el('tr', {},
      el('td', { class: 'muted', style: 'white-space:nowrap' }, when(b.savedAt)),
      el('td', {}, el('strong', {}, placeOf(b))),
      el('td', {}, b.label || ''),
      el('td', {}, String(b.keysUsed)),
      el('td', { style: 'white-space:nowrap;text-align:right' },
        el('button', { onclick: () => openBackup(b.id) }, 'View'), ' ',
        el('a', { class: 'btn', style: 'text-decoration:none', href: `/api/backups/${b.id}/download` }, 'Download'))));
  }
  if (!shown.length) rows.append(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, backups.length ? 'No backups match.' : 'No backups yet.')));
}
$('backupFilter').addEventListener('input', renderBackups);
$('vClose').onclick = () => $('viewer').close();
$('vPrint').onclick = () => window.print();
$('vProgrammed').onclick = async () => { await api('positions/' + viewing.id, { method: 'PATCH', body: { status: 'programmed' } }); $('viewer').close(); refresh(); };
$('vReopen').onclick = async () => { await api('positions/' + viewing.id, { method: 'PATCH', body: { status: 'draft' } }); $('viewer').close(); refresh(); };

async function loadPhotos() {
  renderPhotos($('photos'), await api('photos'), {
    onDelete: async (p) => { if (confirm('Remove this photo?')) { await api('photos/' + p.id, { method: 'DELETE' }); loadPhotos(); } },
  });
}
$('photoForm').onsubmit = async (e) => {
  e.preventDefault();
  const file = $('photoFile').files[0];
  if (!file) return;
  const res = await fetch('/api/photos?caption=' + encodeURIComponent($('photoCaption').value), {
    method: 'POST', headers: { 'Content-Type': file.type }, body: file,
  });
  if (!res.ok) { alert((await res.json().catch(() => ({}))).error || 'Upload failed'); return; }
  $('photoFile').value = ''; $('photoCaption').value = '';
  loadPhotos();
};

start();

$('addShow').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('newShow').value.trim();
  if (!name) return;
  const created = await api('shows', { method: 'POST', body: { name } });
  openShows.add(created.id);
  $('newShow').value = '';
  refresh();
};

// ---------- import positions from a list (e.g. a CSV pulled from the frame's port list) ----------
let importShow = null;
function openImport(show) {
  importShow = show;
  $('iTitle').textContent = `Import positions into ${show.name}`;
  $('iFile').value = ''; $('iText').value = ''; $('iError').textContent = '';
  $('iStep1').classList.remove('hidden'); $('iStep2').classList.add('hidden');
  $('importDlg').showModal();
}
$('iClose').onclick = () => $('importDlg').close();
$('iBack').onclick = () => { $('iStep1').classList.remove('hidden'); $('iStep2').classList.add('hidden'); };
$('iFile').onchange = async () => { const f = $('iFile').files[0]; if (f) $('iText').value = await f.text(); };

function parseLine(line) {
  const sep = line.includes('\t') ? '\t' : ',';
  const out = []; let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c; }
    else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}
$('iPreview').onclick = () => {
  const lines = $('iText').value.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length && /control room/i.test(lines[0])) lines.shift();
  const rows = lines.map(parseLine).filter((r) => r[0] && r[1]);
  if (!rows.length) { $('iError').textContent = 'No rows found. Each line needs at least a control room and a position name.'; return; }
  const body = $('iRows');
  body.innerHTML = '';
  for (const [room, name, alpha = '', port = '', include = 'yes'] of rows) {
    body.append(el('tr', {},
      el('td', {}, el('input', { type: 'checkbox', checked: !/^(no|n|false|0)$/i.test(include), onchange: countImport })),
      el('td', {}, el('input', { type: 'text', value: room, style: 'min-width:90px' })),
      el('td', {}, el('input', { type: 'text', value: name, style: 'min-width:200px' })),
      el('td', {}, el('input', { type: 'text', value: alpha, maxlength: 8, style: 'width:100px' })),
      el('td', {}, el('input', { type: 'text', value: port, style: 'width:70px' }))));
  }
  $('iStep1').classList.add('hidden'); $('iStep2').classList.remove('hidden');
  countImport();
};
function importRows() {
  return [...$('iRows').children].map((tr) => {
    const [check, room, name, alpha, port] = tr.querySelectorAll('input');
    return { on: check.checked, room: room.value.trim(), name: name.value.trim(), alpha: alpha.value.trim(), port: port.value.trim() };
  });
}
function countImport() {
  const n = importRows().filter((r) => r.on && r.room && r.name).length;
  $('iCount').textContent = `${n} selected`;
  $('iGo').textContent = `Add ${n} position${n === 1 ? '' : 's'}`;
  $('iGo').disabled = !n;
}
$('iAll').onclick = () => { $('iRows').querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = true; }); countImport(); };
$('iNone').onclick = () => { $('iRows').querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; }); countImport(); };
$('iGo').onclick = async () => {
  const rows = importRows().filter((r) => r.on && r.room && r.name);
  const { added } = await api(`shows/${importShow.id}/import`, { method: 'POST', body: { rows } });
  openShows.add(importShow.id);
  $('importDlg').close();
  refresh();
  alert(`Added ${added} positions to ${importShow.name}.`);
};

// ---------- edit a position's name, alpha and port ----------
let editing = null;
function editPosition(p) {
  editing = p;
  $('eName').value = p.name; $('eAlpha').value = p.alpha || ''; $('ePort').value = p.port || '';
  $('eError').textContent = '';
  $('editDlg').showModal();
  $('eName').focus();
}
$('eCancel').onclick = () => $('editDlg').close();
$('editForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!$('eName').value.trim()) { $('eError').textContent = 'Name is required.'; return; }
  await api('positions/' + editing.id, { method: 'PATCH', body: { name: $('eName').value, alpha: $('eAlpha').value, port: $('ePort').value } });
  $('editDlg').close();
  refresh();
};
