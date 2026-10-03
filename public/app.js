const $ = (id) => document.getElementById(id);
let config, tree, current, rendered = null, selected = { panel: 'kp4016', index: 0 }, saveTimer = null;

function show(section) {
  for (const s of ['login', 'list', 'editor']) $(s).classList.toggle('hidden', s !== section);
  $('logout').classList.toggle('hidden', section === 'login');
}

async function start() {
  const { role } = await api('me');
  if (!role) return show('login');
  config = await api('config');
  $('labelMax').textContent = config.labelMax;
  $('kLabel').maxLength = config.labelMax;
  route();
}

// URL hash keeps your place: #show/1, #room/2 or #p/3.
function go(hash) { rendered = hash; location.hash = hash; }
async function route() {
  const [kind, raw] = location.hash.slice(1).split('/');
  const id = Number(raw);
  rendered = location.hash.slice(1);
  try {
    if (kind === 'p' && id) return await openPosition(id);
    tree = await api('tree');
    if (kind === 'room' && id) {
      const room = tree.rooms.find((r) => r.id === id);
      if (room) return showList(room.showId, room.id);
    }
    if (kind === 'show' && id && tree.shows.some((s) => s.id === id)) return showList(id);
  } catch { /* fall through to the show list */ }
  showList();
}
window.addEventListener('hashchange', () => { if (location.hash.slice(1) !== rendered) { if (saveTimer) save(); route(); } });

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('login', { method: 'POST', body: { password: $('pw').value } });
    $('pw').value = ''; $('loginError').textContent = '';
    start();
  } catch (err) { $('loginError').textContent = err.message; }
};
$('logout').onclick = async () => { await api('logout', { method: 'POST' }); go(''); show('login'); };

async function loadPhotos(cardId, gridId) {
  const photos = await api('photos');
  $(cardId).classList.toggle('hidden', !photos.length);
  renderPhotos($(gridId), photos);
}

async function showList(showId, roomId) {
  current = null;
  if (!tree) tree = await api('tree');
  go(roomId ? `room/${roomId}` : showId ? `show/${showId}` : '');
  const showObj = tree.shows.find((s) => s.id === showId);
  const roomObj = tree.rooms.find((r) => r.id === roomId);

  const crumbs = [el('a', { href: '#', onclick: (e) => { e.preventDefault(); refreshList(); } }, 'Shows')];
  if (showObj) crumbs.push(' › ', roomObj ? el('a', { href: '#', onclick: (e) => { e.preventDefault(); refreshList(showObj.id); } }, showObj.name) : showObj.name);
  if (roomObj) crumbs.push(' › ', roomObj.name);
  $('crumbs').replaceChildren(...crumbs);
  $('crumbs').classList.toggle('hidden', !showObj);

  const grid = $('positions');
  grid.innerHTML = '';
  const card = (title, sub, onclick, extra) => el('button', { class: 'position', onclick }, el('strong', {}, title), extra || null,
    el('div', { class: 'muted', style: 'margin-top:6px' }, sub));

  if (!showObj) {
    $('listTitle').textContent = 'Pick your show';
    for (const s of tree.shows) {
      const rooms = tree.rooms.filter((r) => r.showId === s.id).length;
      grid.append(card(s.name, `${rooms} control room${rooms === 1 ? '' : 's'}`, () => showList(s.id)));
    }
    if (!tree.shows.length) grid.append(el('p', { class: 'muted' }, 'No shows yet. Ask Stefan to add one.'));
  } else if (!roomObj) {
    $('listTitle').textContent = 'Pick your control room';
    const rooms = tree.rooms.filter((r) => r.showId === showObj.id);
    for (const r of rooms) {
      const pos = tree.positions.filter((p) => p.roomId === r.id);
      const ready = pos.filter((p) => p.status === 'submitted' || p.status === 'programmed').length;
      grid.append(card(r.name, `${pos.length} position${pos.length === 1 ? '' : 's'} · ${ready} submitted`, () => showList(showObj.id, r.id)));
    }
    if (!rooms.length) grid.append(el('p', { class: 'muted' }, 'No control rooms in this show yet. Ask Stefan to add yours.'));
  } else {
    $('listTitle').textContent = 'Pick your position';
    const pos = tree.positions.filter((p) => p.roomId === roomObj.id);
    for (const p of pos) grid.append(card(p.name, `${p.alpha ? p.alpha + ' · ' : ''}${p.keysUsed} of ${p.keysTotal} keys set`, () => openPosition(p.id), badge(p.status)));
    if (!pos.length) grid.append(el('p', { class: 'muted' }, 'No positions in this control room yet. Ask Stefan to add yours.'));
  }
  show('list');
  loadPhotos('photosCard', 'photos');
}
async function refreshList(showId, roomId) { tree = await api('tree'); showList(showId, roomId); }

async function openPosition(id) {
  current = await api('positions/' + id);
  go('p/' + id);
  selected = { panel: 'kp4016', index: 0 };
  $('posName').textContent = current.name;
  $('posPath').textContent = `${current.showName} › ${current.roomName}`;
  $('contact').value = current.contact || '';
  $('notes').value = current.notes || '';
  $('saveState').innerHTML = '&nbsp;';
  beforeClear = null;
  $('undoBar').classList.add('hidden');
  $('submitError').textContent = '';
  refreshStatus();
  draw();
  loadKeyForm();
  show('editor');
  loadPhotos('photosCard2', 'photos2');
}

function refreshStatus() {
  $('posStatus').replaceChildren(badge(current.status));
  const locked = current.status === 'programmed';
  $('submit').disabled = locked;
  $('submit').textContent = current.status === 'submitted' ? 'Submitted. Submit again after changes' : 'Submit, ready to program';
  for (const id of ['kLabel', 'contact', 'notes', 'clearKey', 'clearAll']) $(id).disabled = locked;
  if (locked) $('saveState').textContent = 'This panel has been programmed. Ask Stefan to reopen it for changes.';
}

function draw() {
  renderRack($('rack'), current.keys, { selected, onPick: (panel, index) => { selected = { panel, index }; draw(); loadKeyForm(); $('kLabel').focus(); } });
}

function selKey() { return current.keys[selected.panel][selected.index]; }

function loadKeyForm() {
  const k = selKey();
  $('keyTitle').textContent = `${selected.panel === 'kp4016' ? 'KP-4016' : 'KP-5032'} · key ${selected.index + 1}`;
  $('kLabel').value = k.label;
}

function step(dir) {
  const order = [...current.keys.kp4016.map((_, i) => ['kp4016', i]), ...current.keys.kp5032.map((_, i) => ['kp5032', i])];
  let pos = order.findIndex(([p, i]) => p === selected.panel && i === selected.index) + dir;
  pos = (pos + order.length) % order.length;
  selected = { panel: order[pos][0], index: order[pos][1] };
  draw(); loadKeyForm(); $('kLabel').focus();
}
$('prevKey').onclick = () => step(-1);
$('nextKey').onclick = () => step(1);
$('kLabel').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(1); } });

function onKeyEdit() {
  selKey().label = $('kLabel').value.toUpperCase().slice(0, config.labelMax);
  beforeClear = null; $('undoBar').classList.add('hidden');
  $('kLabel').value = selKey().label;
  draw();
  queueSave();
}
$('kLabel').addEventListener('input', onKeyEdit);
for (const id of ['contact', 'notes']) $(id).addEventListener('input', queueSave);
$('clearKey').onclick = () => { selKey().label = ''; loadKeyForm(); draw(); queueSave(); };

// Clears every key on both panels at once; Undo puts them back until the operator leaves the page.
let beforeClear = null;
$('clearAll').onclick = () => {
  beforeClear = JSON.parse(JSON.stringify(current.keys));
  for (const list of Object.values(current.keys)) list.forEach((k) => { k.label = ''; });
  $('undoBar').classList.remove('hidden');
  loadKeyForm(); draw(); queueSave();
};
$('undoClear').onclick = () => {
  if (!beforeClear) return;
  current.keys = beforeClear;
  beforeClear = null;
  $('undoBar').classList.add('hidden');
  loadKeyForm(); draw(); queueSave();
};

function queueSave() {
  $('saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}
async function save() {
  clearTimeout(saveTimer);
  try {
    const saved = await api('positions/' + current.id, { method: 'PUT', body: { keys: current.keys, contact: $('contact').value, notes: $('notes').value } });
    current.status = saved.status;
    refreshStatus();
    $('saveState').textContent = 'Saved ' + new Date().toLocaleTimeString([], { timeStyle: 'short' });
  } catch (err) { $('saveState').textContent = 'Not saved: ' + err.message; }
}

$('submit').onclick = async () => {
  $('submitError').textContent = '';
  if (!$('contact').value.trim()) { $('submitError').textContent = 'Please add your name first.'; $('contact').focus(); return; }
  const used = Object.values(current.keys).flat().filter((k) => k.label).length;
  if (!used) { $('submitError').textContent = 'Set at least one key before submitting.'; return; }
  if (!confirm(`Submit ${current.name} with ${used} keys set? Stefan will be notified that it's ready to program.`)) return;
  try {
    await save();
    current = await api(`positions/${current.id}/submit`, { method: 'POST', body: { submittedBy: $('contact').value } });
    refreshStatus();
    $('saveState').textContent = 'Submitted. Stefan has been notified.';
  } catch (err) { $('submitError').textContent = err.message; }
};

$('back').onclick = async () => { if (saveTimer) await save(); refreshList(current.showId, current.roomId); };

start();
