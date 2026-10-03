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

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const db = { positions: [], notifications: [], photos: [], nextId: 1 };
    for (const name of ['Director', 'Producer', 'Audio A1', 'Graphics']) {
      db.positions.push(newPosition(db, name));
    }
    return db;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function newPosition(db, name) {
  return {
    id: db.nextId++, name, status: 'not_started', keys: emptyKeys(),
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
  return { ...rest, keysUsed: used, keysTotal: Object.values(PANELS).reduce((a, b) => a + b, 0) };
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

  // Positions
  if (parts[0] === 'positions') {
    const id = Number(parts[1]);
    const pos = parts[1] ? db.positions.find((p) => p.id === id) : null;
    if (parts[1] && !pos) return send(res, 404, { error: 'No such position' });

    if (!parts[1] && m === 'GET') return send(res, 200, db.positions.map(summary));
    if (!parts[1] && m === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'Admin only' });
      const { name } = await readJson(req);
      if (!str(name, 60).trim()) return send(res, 400, { error: 'Name required' });
      const p = newPosition(db, str(name, 60).trim());
      db.positions.push(p); saveDb();
      return send(res, 201, summary(p));
    }
    if (parts[2] === 'submit' && m === 'POST') {
      const { submittedBy } = await readJson(req);
      pos.status = 'submitted';
      pos.submittedAt = new Date().toISOString();
      pos.submittedBy = str(submittedBy, 80);
      db.notifications.unshift({
        id: crypto.randomUUID(), positionId: pos.id, positionName: pos.name,
        submittedBy: pos.submittedBy, at: pos.submittedAt, read: false,
      });
      saveDb();
      return send(res, 200, pos);
    }
    if (m === 'GET') return send(res, 200, pos);
    if (m === 'PUT') {
      const body = await readJson(req);
      if (pos.status === 'programmed' && !isAdmin) return send(res, 409, { error: 'This panel has already been programmed. Ask the admin to reopen it.' });
      pos.keys = cleanKeys(body.keys);
      pos.contact = str(body.contact, 80);
      pos.notes = str(body.notes, 2000);
      pos.updatedAt = new Date().toISOString();
      if (pos.status === 'not_started' || (pos.status === 'submitted' && !isAdmin)) pos.status = 'draft';
      saveDb();
      return send(res, 200, pos);
    }
    if (m === 'PATCH') {
      if (!isAdmin) return send(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      if (body.name !== undefined && str(body.name, 60).trim()) pos.name = str(body.name, 60).trim();
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
