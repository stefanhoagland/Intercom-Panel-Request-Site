// Intercom panel request site: zero-dependency Node server with a JSON file store.
// Run: USER_PASSWORD=... ADMIN_PASSWORD=... node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const USER_PASSWORD = process.env.USER_PASSWORD || 'intercom';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const MAX_UPLOAD = 15 * 1024 * 1024;

const PANELS = { kp4016: 16, kp5032: 32 };
const LABEL_MAX = 8;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- storage ----------
function emptyKeys() {
  const keys = {};
  for (const [panel, count] of Object.entries(PANELS)) {
    keys[panel] = Array.from({ length: count }, () => ({ label: '' }));
  }
  return keys;
}

// Hierarchy: show -> control room -> position. Each position owns one KP-4016 + KP-5032.
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const db = { shows: [], rooms: [], positions: [], notifications: [], photos: [], nextId: 1 };
    const show = newShow(db, 'Sample Show');
    const room = newRoom(db, show.id, 'Control Room A');
    for (const name of ['Director', 'Producer', 'Audio A1', 'Graphics']) {
      db.positions.push(newPosition(db, room.id, name));
    }
    return db;
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  // Data saved before shows existed: put its positions under one show and room.
  if (!db.shows) {
    db.shows = []; db.rooms = [];
    const show = newShow(db, 'My Show');
    const room = newRoom(db, show.id, 'Control Room A');
    db.positions.forEach((p) => { p.roomId = room.id; });
  }
  return db;
}

function newShow(db, name) {
  const show = { id: db.nextId++, name, active: true, createdAt: new Date().toISOString() };
  db.shows.push(show);
  return show;
}
function newRoom(db, showId, name) {
  const room = { id: db.nextId++, showId, name };
  db.rooms.push(room);
  return room;
}
function newPosition(db, roomId, name) {
  return {
    id: db.nextId++, roomId, name, status: 'not_started', keys: emptyKeys(),
    contact: '', notes: '', updatedAt: null, submittedAt: null, submittedBy: '', programmedAt: null,
  };
}

let db = loadDb();
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
saveDb();

// ---------- sessions (signed cookie) ----------
const SECRET_FILE = path.join(DATA_DIR, 'secret');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}
function makeSession(role) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + 30 * 864e5 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readSession(req) {
  const cookie = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('sid='));
  if (!cookie) return null;
  const [payload, sig] = cookie.slice(4).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json' : 'text/plain', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req);
  try { return buf.length ? JSON.parse(buf.toString()) : {}; } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
}
function str(v, max) { return String(v ?? '').slice(0, max); }

function cleanKeys(input) {
  const keys = emptyKeys();
  for (const panel of Object.keys(PANELS)) {
    const list = Array.isArray(input?.[panel]) ? input[panel] : [];
    keys[panel] = keys[panel].map((_, i) => ({ label: str(list[i]?.label, LABEL_MAX) }));
  }
  return keys;
}
function summary(p) {
  const { keys, ...rest } = p;
  const used = Object.values(keys).flat().filter((k) => k.label).length;
  const room = db.rooms.find((r) => r.id === p.roomId);
  const show = room && db.shows.find((s) => s.id === room.showId);
  return { ...rest, roomName: room?.name || '', showName: show?.name || '', showId: show?.id, keysUsed: used, keysTotal: Object.values(PANELS).reduce((a, b) => a + b, 0) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function serveFile(res, root, rel) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- routes ----------
async function handleApi(req, res, url) {
  const session = readSession(req);
  const role = session?.role;
  const isAdmin = role === 'admin';
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const m = req.method;

  if (parts[0] === 'login' && m === 'POST') {
    const { password, as } = await readJson(req);
    const wantAdmin = as === 'admin';
    if (!safeEqual(password, wantAdmin ? ADMIN_PASSWORD : USER_PASSWORD)) return send(res, 401, { error: 'Wrong password' });
    return send(res, 200, { role: wantAdmin ? 'admin' : 'user' }, {
      'Set-Cookie': `sid=${makeSession(wantAdmin ? 'admin' : 'user')}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 86400}`,
    });
  }
  if (parts[0] === 'logout' && m === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
  }
  if (parts[0] === 'me') return send(res, 200, { role: role || null });

  if (!role) return send(res, 401, { error: 'Not logged in' });

  if (parts[0] === 'config') return send(res, 200, { panels: PANELS, labelMax: LABEL_MAX });

  // Everything an operator or admin needs to navigate: shows, rooms, position summaries.
  // Operators only see shows marked active.
  if (parts[0] === 'tree' && m === 'GET') {
    const shows = isAdmin ? db.shows : db.shows.filter((s) => s.active);
    const showIds = new Set(shows.map((s) => s.id));
    const rooms = db.rooms.filter((r) => showIds.has(r.showId));
    const roomIds = new Set(rooms.map((r) => r.id));
    return send(res, 200, { shows, rooms, positions: db.positions.filter((p) => roomIds.has(p.roomId)).map(summary) });
  }

  const cleanName = (v) => str(v, 60).trim();

  // Shows (admin)
  if (parts[0] === 'shows') {
    if (!isAdmin) return send(res, 403, { error: 'Admin only' });
    const show = parts[1] ? db.shows.find((s) => s.id === Number(parts[1])) : null;
    if (parts[1] && !show) return send(res, 404, { error: 'No such show' });
    if (!parts[1] && m === 'POST') {
      const name = cleanName((await readJson(req)).name);
      if (!name) return send(res, 400, { error: 'Name required' });
      const created = newShow(db, name); saveDb();
      return send(res, 201, created);
    }
    // Copy a show's control rooms and positions into a new show, with blank keys.
    if (parts[2] === 'copy' && m === 'POST') {
      const name = cleanName((await readJson(req)).name);
      if (!name) return send(res, 400, { error: 'Name required' });
      const copy = newShow(db, name);
      for (const room of db.rooms.filter((r) => r.showId === show.id)) {
        const newR = newRoom(db, copy.id, room.name);
        for (const pos of db.positions.filter((p) => p.roomId === room.id)) db.positions.push(newPosition(db, newR.id, pos.name));
      }
      saveDb();
      return send(res, 201, copy);
    }
    if (m === 'PATCH') {
      const body = await readJson(req);
      if (cleanName(body.name)) show.name = cleanName(body.name);
      if (typeof body.active === 'boolean') show.active = body.active;
      saveDb();
      return send(res, 200, show);
    }
    if (m === 'DELETE') {
      const roomIds = new Set(db.rooms.filter((r) => r.showId === show.id).map((r) => r.id));
      db.positions = db.positions.filter((p) => !roomIds.has(p.roomId));
      db.rooms = db.rooms.filter((r) => r.showId !== show.id);
      db.shows = db.shows.filter((s) => s !== show);
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  // Control rooms (admin)
  if (parts[0] === 'rooms') {
    if (!isAdmin) return send(res, 403, { error: 'Admin only' });
    const room = parts[1] ? db.rooms.find((r) => r.id === Number(parts[1])) : null;
    if (parts[1] && !room) return send(res, 404, { error: 'No such control room' });
    if (!parts[1] && m === 'POST') {
      const body = await readJson(req);
      if (!db.shows.some((s) => s.id === body.showId)) return send(res, 400, { error: 'No such show' });
      if (!cleanName(body.name)) return send(res, 400, { error: 'Name required' });
      const created = newRoom(db, body.showId, cleanName(body.name)); saveDb();
      return send(res, 201, created);
    }
    if (m === 'PATCH') {
      const name = cleanName((await readJson(req)).name);
      if (name) room.name = name;
      saveDb();
      return send(res, 200, room);
    }
    if (m === 'DELETE') {
      db.positions = db.positions.filter((p) => p.roomId !== room.id);
      db.rooms = db.rooms.filter((r) => r !== room);
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  // Positions
  if (parts[0] === 'positions') {
    const id = Number(parts[1]);
    const pos = parts[1] ? db.positions.find((p) => p.id === id) : null;
    if (parts[1] && !pos) return send(res, 404, { error: 'No such position' });
    const full = (p) => ({ ...p, ...summary(p) });

    if (!parts[1] && m === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      if (!db.rooms.some((r) => r.id === body.roomId)) return send(res, 400, { error: 'No such control room' });
      if (!cleanName(body.name)) return send(res, 400, { error: 'Name required' });
      const p = newPosition(db, body.roomId, cleanName(body.name));
      db.positions.push(p); saveDb();
      return send(res, 201, summary(p));
    }
    if (parts[2] === 'submit' && m === 'POST') {
      const { submittedBy } = await readJson(req);
      pos.status = 'submitted';
      pos.submittedAt = new Date().toISOString();
      pos.submittedBy = str(submittedBy, 80);
      const names = summary(pos);
      db.notifications.unshift({
        id: crypto.randomUUID(), positionId: pos.id, positionName: pos.name,
        showName: names.showName, roomName: names.roomName,
        submittedBy: pos.submittedBy, at: pos.submittedAt, read: false,
      });
      saveDb();
      return send(res, 200, full(pos));
    }
    if (m === 'GET') return send(res, 200, full(pos));
    if (m === 'PUT') {
      const body = await readJson(req);
      if (pos.status === 'programmed' && !isAdmin) return send(res, 409, { error: 'This panel has already been programmed. Ask the admin to reopen it.' });
      pos.keys = cleanKeys(body.keys);
      pos.contact = str(body.contact, 80);
      pos.notes = str(body.notes, 2000);
      pos.updatedAt = new Date().toISOString();
      if (pos.status === 'not_started' || (pos.status === 'submitted' && !isAdmin)) pos.status = 'draft';
      saveDb();
      return send(res, 200, full(pos));
    }
    if (m === 'PATCH') {
      if (!isAdmin) return send(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      if (cleanName(body.name)) pos.name = cleanName(body.name);
      if (['not_started', 'draft', 'submitted', 'programmed'].includes(body.status)) {
        pos.status = body.status;
        pos.programmedAt = body.status === 'programmed' ? new Date().toISOString() : null;
      }
      saveDb();
      return send(res, 200, summary(pos));
    }
    if (m === 'DELETE') {
      if (!isAdmin) return send(res, 403, { error: 'Admin only' });
      db.positions = db.positions.filter((p) => p.id !== id);
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  // Admin notifications
  if (parts[0] === 'notifications') {
    if (!isAdmin) return send(res, 403, { error: 'Admin only' });
    if (m === 'GET') return send(res, 200, db.notifications.slice(0, 200));
    if (parts[1] === 'read' && m === 'POST') {
      db.notifications.forEach((n) => { n.read = true; }); saveDb();
      return send(res, 200, { ok: true });
    }
  }

  // Reference photos (admin uploads, everyone views)
  if (parts[0] === 'photos') {
    if (m === 'GET') return send(res, 200, db.photos);
    if (!isAdmin) return send(res, 403, { error: 'Admin only' });
    if (m === 'POST') {
      const type = (req.headers['content-type'] || '').split(';')[0];
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }[type];
      if (!ext) return send(res, 400, { error: 'Upload a PNG, JPEG, GIF or WebP image' });
      const data = await readBody(req, MAX_UPLOAD);
      const file = crypto.randomUUID() + ext;
      fs.writeFileSync(path.join(UPLOAD_DIR, file), data);
      const photo = { id: file, caption: str(url.searchParams.get('caption'), 120), at: new Date().toISOString() };
      db.photos.push(photo); saveDb();
      return send(res, 201, photo);
    }
    if (m === 'DELETE' && parts[1]) {
      const photo = db.photos.find((p) => p.id === parts[1]);
      if (!photo) return send(res, 404, { error: 'No such photo' });
      db.photos = db.photos.filter((p) => p !== photo);
      fs.rmSync(path.join(UPLOAD_DIR, photo.id), { force: true });
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/uploads/')) {
      if (!readSession(req)) return send(res, 401, 'Not logged in');
      return serveFile(res, UPLOAD_DIR, url.pathname.slice('/uploads/'.length));
    }
    if (url.pathname === '/admin') return serveFile(res, PUBLIC_DIR, 'admin.html');
    return serveFile(res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (err) {
    send(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
    if (!err.status) console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`Intercom panel site on http://localhost:${PORT}  (admin page: /admin)`);
  if (!process.env.USER_PASSWORD || !process.env.ADMIN_PASSWORD) {
    console.log('Using default passwords. Set USER_PASSWORD and ADMIN_PASSWORD before going live.');
  }
});
