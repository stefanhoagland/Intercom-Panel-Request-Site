const $ = (id) => document.getElementById(id);
let pollTimer = null, lastUnread = null, viewing = null;

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
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 15000);
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

async function refresh() {
  const [notifs, positions] = await Promise.all([api('notifications'), api('positions')]);
  const unread = notifs.filter((n) => !n.read);

  // Alert when a new submission arrives while the page is open.
  if (lastUnread !== null && unread.length > lastUnread && 'Notification' in window && Notification.permission === 'granted') {
    const n = unread[0];
    new Notification('Panel ready to program', { body: `${n.positionName}${n.submittedBy ? ' from ' + n.submittedBy : ''}` });
  }
  lastUnread = unread.length;
  document.title = (unread.length ? `(${unread.length}) ` : '') + 'Intercom Admin';
  $('unread').textContent = unread.length;
  $('unread').classList.toggle('hidden', !unread.length);

  const list = $('notifs');
  list.innerHTML = '';
  for (const n of notifs.slice(0, 30)) {
    list.append(el('div', { class: 'notif' + (n.read ? '' : ' unread') },
      el('div', {}, el('strong', {}, n.positionName), ' is ready to program',
        n.submittedBy ? ` (submitted by ${n.submittedBy})` : '', el('div', { class: 'muted' }, when(n.at))),
      el('button', { onclick: () => openViewer(n.positionId) }, 'View panel')));
  }
  if (!notifs.length) list.append(el('p', { class: 'muted' }, 'Nothing yet. You will see a notice here when someone submits a panel.'));

  const rows = $('posRows');
  rows.innerHTML = '';
  for (const p of positions) {
    rows.append(el('tr', {},
      el('td', {}, el('strong', {}, p.name)),
      el('td', {}, badge(p.status)),
      el('td', {}, `${p.keysUsed} / ${p.keysTotal}`),
      el('td', { class: 'muted' }, p.submittedAt ? `${when(p.submittedAt)}${p.submittedBy ? ' · ' + p.submittedBy : ''}` : ''),
      el('td', { style: 'white-space:nowrap;text-align:right' },
        el('button', { onclick: () => openViewer(p.id) }, 'View'), ' ',
        el('button', { onclick: () => rename(p) }, 'Rename'), ' ',
        el('button', { class: 'danger', onclick: () => remove(p) }, 'Delete'))));
  }
}

$('markRead').onclick = async () => { await api('notifications/read', { method: 'POST' }); refresh(); };

$('addForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('newName').value.trim();
  if (!name) return;
  await api('positions', { method: 'POST', body: { name } });
  $('newName').value = '';
  refresh();
};
async function rename(p) {
  const name = prompt('Rename position', p.name);
  if (name && name.trim()) { await api('positions/' + p.id, { method: 'PATCH', body: { name } }); refresh(); }
}
async function remove(p) {
  if (!confirm(`Delete ${p.name} and its key choices? This can't be undone.`)) return;
  await api('positions/' + p.id, { method: 'DELETE' });
  refresh();
}

async function openViewer(id) {
  viewing = await api('positions/' + id);
  $('vTitle').textContent = viewing.name;
  $('vMeta').replaceChildren(badge(viewing.status),
    viewing.submittedBy ? `  Submitted by ${viewing.submittedBy} on ${when(viewing.submittedAt)}` : '',
    viewing.notes ? el('div', { style: 'margin-top:6px;color:var(--text)' }, 'Notes: ' + viewing.notes) : '');
  renderRack($('vRack'), viewing.keys);
  const list = $('vList');
  list.innerHTML = '';
  for (const [panel, label] of [['kp4016', 'KP-4016'], ['kp5032', 'KP-5032']]) {
    viewing.keys[panel].forEach((k, i) => {
      if (!k.label) return;
      const mode = k.talk && k.listen ? 'Talk/Listen' : k.talk ? 'Talk' : k.listen ? 'Listen' : 'No talk/listen';
      list.append(el('div', {}, el('strong', {}, `${label} ${i + 1}: ${k.label}`), ` · ${mode}`, k.notes ? ` · ${k.notes}` : ''));
    });
  }
  if (!list.children.length) list.append(el('p', { class: 'muted' }, 'No keys set yet.'));
  $('vProgrammed').disabled = viewing.status === 'programmed';
  $('viewer').showModal();
}
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
