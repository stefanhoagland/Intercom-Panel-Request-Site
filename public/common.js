// Shared helpers for the user and admin pages.
async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : opts.headers,
    body: opts.body === undefined ? undefined : opts.body instanceof Blob ? opts.body : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(c));
  return node;
}

const STATUS_TEXT = { not_started: 'Not started', draft: 'In progress', submitted: 'Ready to program', programmed: 'Programmed' };
function badge(status) { return el('span', { class: 'badge ' + status }, STATUS_TEXT[status] || status); }
function when(iso) { return iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''; }

const PANEL_INFO = {
  kp4016: { title: 'RTS KP-4016 · 16 keys · 1RU', rows: 1 },
  kp5032: { title: 'RTS KP-5032 · 32 keys · 2RU', rows: 2 },
};

// Draws the KP-4016 above the KP-5032 like they sit in the rack.
// onPick(panel, index) is called when a key is clicked; omit for read-only.
function renderRack(container, keys, { onPick, selected } = {}) {
  container.innerHTML = '';
  for (const panel of ['kp4016', 'kp5032']) {
    const info = PANEL_INFO[panel];
    const list = keys[panel];
    const perRow = list.length / info.rows;
    const rack = el('div', { class: 'rack' }, el('div', { class: 'rack-title' }, info.title));
    for (let r = 0; r < info.rows; r++) {
      const row = el('div', { class: 'keyrow' });
      for (let c = 0; c < perRow; c++) {
        const i = r * perRow + c;
        const k = list[i];
        const tl = !k.label ? '' : k.talk && k.listen ? 'TALK+LSN' : k.talk ? 'TALK' : k.listen ? 'LISTEN' : '';
        const isSel = selected && selected.panel === panel && selected.index === i;
        row.append(el('button', {
          class: 'key' + (isSel ? ' sel' : ''), type: 'button', disabled: !onPick,
          title: k.notes || '', onclick: onPick ? () => onPick(panel, i) : null,
        },
          el('div', { class: 'lcd' + (k.label ? '' : ' empty') }, k.label || '—'),
          el('div', { class: 'num' }, String(i + 1)),
          el('div', { class: 'tl' }, tl || ' '),
        ));
      }
      rack.append(row);
    }
    container.append(rack);
  }
}

function renderPhotos(container, photos, { onDelete } = {}) {
  container.innerHTML = '';
  for (const p of photos) {
    container.append(el('figure', {},
      el('a', { href: '/uploads/' + p.id, target: '_blank' }, el('img', { src: '/uploads/' + p.id, alt: p.caption || 'Reference photo' })),
      el('figcaption', {}, p.caption || '', onDelete ? el('button', { class: 'danger', style: 'margin-left:8px;padding:2px 8px', onclick: () => onDelete(p) }, 'Remove') : null),
    ));
  }
}
