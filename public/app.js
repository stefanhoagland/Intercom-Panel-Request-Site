const $ = (id) => document.getElementById(id);
let config, current, selected = { panel: 'kp4016', index: 0 }, saveTimer = null;

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
  const id = Number(location.hash.slice(1));
  if (id) return openPosition(id).catch(showList);
  showList();
}

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('login', { method: 'POST', body: { password: $('pw').value } });
    $('pw').value = ''; $('loginError').textContent = '';
    start();
  } catch (err) { $('loginError').textContent = err.message; }
};
$('logout').onclick = async () => { await api('logout', { method: 'POST' }); location.hash = ''; show('login'); };

async function loadPhotos(cardId, gridId) {
  const photos = await api('photos');
  $(cardId).classList.toggle('hidden', !photos.length);
  renderPhotos($(gridId), photos);
}

async function showList() {
  location.hash = '';
  current = null;
  const positions = await api('positions');
  const grid = $('positions');
  grid.innerHTML = '';
  for (const p of positions) {
    grid.append(el('button', { class: 'position', onclick: () => openPosition(p.id) },
      el('strong', {}, p.name), badge(p.status),
      el('div', { class: 'muted', style: 'margin-top:6px' }, `${p.keysUsed} of ${p.keysTotal} keys set`)));
  }
  if (!positions.length) grid.append(el('p', { class: 'muted' }, 'No positions yet. Ask Stefan to add yours.'));
  show('list');
  loadPhotos('photosCard', 'photos');
}

async function openPosition(id) {
  current = await api('positions/' + id);
  location.hash = id;
  selected = { panel: 'kp4016', index: 0 };
  $('posName').textContent = current.name;
  $('contact').value = current.contact || '';
  $('notes').value = current.notes || '';
  $('saveState').innerHTML = '&nbsp;';
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
  for (const id of ['kLabel', 'kTalk', 'kListen', 'kNotes', 'contact', 'notes', 'clearKey']) $(id).disabled = locked;
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
  $('kTalk').checked = k.talk;
  $('kListen').checked = k.listen;
  $('kNotes').value = k.notes;
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
  Object.assign(selKey(), {
    label: $('kLabel').value.toUpperCase().slice(0, config.labelMax),
    talk: $('kTalk').checked, listen: $('kListen').checked, notes: $('kNotes').value,
  });
  $('kLabel').value = selKey().label;
  draw();
  queueSave();
}
for (const id of ['kLabel', 'kNotes']) $(id).addEventListener('input', onKeyEdit);
for (const id of ['kTalk', 'kListen']) $(id).addEventListener('change', onKeyEdit);
for (const id of ['contact', 'notes']) $(id).addEventListener('input', queueSave);
$('clearKey').onclick = () => { Object.assign(selKey(), { label: '', talk: true, listen: true, notes: '' }); loadKeyForm(); draw(); queueSave(); };

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

$('back').onclick = async () => { if (saveTimer) await save(); showList(); };
window.addEventListener('hashchange', () => { if (!location.hash && current) showList(); });

start();
