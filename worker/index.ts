/**
 * Penguin Brain backend (Cloudflare Worker + D1).
 * - Email + password accounts, bearer tokens (web sessions and app tokens)
 * - Sync storage that speaks a tiny subset of the GitHub Contents API, so the
 *   Android app and the website reuse the same sync code (server URL instead of api.github.com)
 * - Admin API for the /#/admin page
 * Static website files are served from ./dist via Workers Assets.
 */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type Row = Record<string, unknown>;
interface User {
  id: number;
  email: string;
  is_admin: number;
  disabled: number;
  created_at: number;
  last_login: number;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_used INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS data (user_id INTEGER PRIMARY KEY, content TEXT NOT NULL, sha TEXT NOT NULL, size INTEGER NOT NULL, counts TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
];
let schemaReady = false;
async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

const MAX_SIZE = 1_800_000; // D1 row limit is ~2 MB
const enc = new TextEncoder();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, accept, x-github-api-version',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};
const err = (status: number, message: string) => json({ message }, status);

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer);
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100_000 }, key, 256);
  return hex(bits);
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function b64ToText(b64: string) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function textToB64(text: string) {
  const bytes = enc.encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const publicUser = (u: User) => ({ id: u.id, email: u.email, isAdmin: !!u.is_admin, createdAt: u.created_at, lastLogin: u.last_login });

async function getSetting(db: D1Database, key: string, fallback: string) {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? fallback;
}
async function userCount(db: D1Database) {
  return (await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;
}
async function registrationOpen(db: D1Database) {
  if ((await userCount(db)) === 0) return true;
  return (await getSetting(db, 'registration', 'closed')) === 'open';
}

/** simple fixed-window limiter stored in D1 */
async function limited(db: D1Database, key: string, max: number, windowMs: number) {
  const now = Date.now();
  const r = await db.prepare('SELECT count, reset_at FROM attempts WHERE key = ?').bind(key).first<{ count: number; reset_at: number }>();
  if (!r || r.reset_at < now) {
    await db.prepare('INSERT OR REPLACE INTO attempts (key, count, reset_at) VALUES (?, 1, ?)').bind(key, now + windowMs).run();
    return false;
  }
  if (r.count >= max) return true;
  await db.prepare('UPDATE attempts SET count = count + 1 WHERE key = ?').bind(key).run();
  return false;
}

async function issueToken(db: D1Database, userId: number, kind: 'web' | 'app', label: string) {
  const token = `pb_${randomHex(24)}`;
  await db
    .prepare('INSERT INTO tokens (hash, user_id, kind, label, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, kind, label.slice(0, 80), Date.now())
    .run();
  return token;
}

async function authUser(req: Request, env: Env): Promise<{ user: User; tokenId: number } | null> {
  const h = req.headers.get('authorization') ?? '';
  const m = /^(?:Bearer|token)\s+(\S+)$/i.exec(h);
  if (!m) return null;
  const hash = await sha256(m[1]);
  const r = await env.DB.prepare(
    'SELECT t.id AS token_id, t.last_used, u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?',
  )
    .bind(hash)
    .first<User & { token_id: number; last_used: number }>();
  if (!r || r.disabled) return null;
  if (Date.now() - r.last_used > 60_000) {
    await env.DB.prepare('UPDATE tokens SET last_used = ? WHERE id = ?').bind(Date.now(), r.token_id).run();
  }
  return { user: r, tokenId: r.token_id };
}

async function body(req: Request): Promise<Row> {
  try {
    return (await req.json()) as Row;
  } catch {
    return {};
  }
}
const s = (v: unknown) => (typeof v === 'string' ? v : '');

function countsOf(text: string) {
  try {
    const o = JSON.parse(text) as Row;
    const n = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0);
    return JSON.stringify({ notes: n('notes'), noteFolders: n('noteFolders'), tasks: n('tasks'), diary: n('diary'), bookmarks: n('bookmarks'), updatedBy: s(o.updatedBy) });
  } catch {
    return '{}';
  }
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const db = env.DB;
  const path = url.pathname;
  const method = req.method;

  // ---------- public ----------
  if (path === '/api/config' && method === 'GET') {
    return json({ registrationOpen: await registrationOpen(db), hasUsers: (await userCount(db)) > 0 });
  }
  if (path === '/api/auth/register' && method === 'POST') {
    const b = await body(req);
    const email = s(b.email).trim().toLowerCase();
    const password = s(b.password);
    if (!validEmail(email)) return err(400, 'Enter a valid email address');
    if (password.length < 8) return err(400, 'Password must be at least 8 characters');
    if (!(await registrationOpen(db))) return err(403, 'Registration is closed. Ask the admin to create an account for you.');
    if (await limited(db, `reg:${req.headers.get('cf-connecting-ip') ?? ''}`, 10, 3600_000)) return err(429, 'Too many attempts, try again later');
    const exists = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) return err(409, 'An account with this email already exists');
    const first = (await userCount(db)) === 0;
    const salt = randomHex(16);
    const now = Date.now();
    const r = await db
      .prepare('INSERT INTO users (email, pw_hash, pw_salt, is_admin, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
      .bind(email, await hashPassword(password, salt), salt, first ? 1 : 0, now, now)
      .first<User>();
    const token = await issueToken(db, r!.id, 'web', s(b.label) || 'Website');
    return json({ token, user: publicUser(r!) }, 201);
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const b = await body(req);
    const email = s(b.email).trim().toLowerCase();
    const password = s(b.password);
    if (await limited(db, `login:${email}`, 10, 15 * 60_000)) return err(429, 'Too many attempts, wait 15 minutes');
    const u = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User & { pw_hash: string; pw_salt: string }>();
    if (!u || !safeEqual(await hashPassword(password, u.pw_salt), u.pw_hash)) return err(401, 'Wrong email or password');
    if (u.disabled) return err(403, 'This account is disabled');
    await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(Date.now(), u.id).run();
    await db.prepare('DELETE FROM attempts WHERE key = ?').bind(`login:${email}`).run();
    const kind = b.kind === 'app' ? 'app' : 'web';
    const token = await issueToken(db, u.id, kind, s(b.label) || (kind === 'app' ? 'Android app' : 'Website'));
    return json({ token, user: publicUser(u) });
  }

  // ---------- signed in ----------
  const auth = await authUser(req, env);
  if (!auth) return err(401, 'Bad credentials');
  const me = auth.user;

  if (path === '/api/auth/me' && method === 'GET') return json({ user: publicUser(me) });
  if (path === '/api/auth/logout' && method === 'POST') {
    await db.prepare('DELETE FROM tokens WHERE id = ?').bind(auth.tokenId).run();
    return json({ ok: true });
  }
  if (path === '/api/auth/password' && method === 'POST') {
    const b = await body(req);
    const u = await db.prepare('SELECT pw_hash, pw_salt FROM users WHERE id = ?').bind(me.id).first<{ pw_hash: string; pw_salt: string }>();
    if (!u || !safeEqual(await hashPassword(s(b.current), u.pw_salt), u.pw_hash)) return err(401, 'Current password is wrong');
    if (s(b.next).length < 8) return err(400, 'New password must be at least 8 characters');
    const salt = randomHex(16);
    await db.batch([
      db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await hashPassword(s(b.next), salt), salt, me.id),
      db.prepare('DELETE FROM tokens WHERE user_id = ? AND id != ?').bind(me.id, auth.tokenId),
    ]);
    return json({ ok: true });
  }
  if (path === '/api/tokens' && method === 'GET') {
    const r = await db.prepare('SELECT id, kind, label, created_at, last_used FROM tokens WHERE user_id = ? ORDER BY created_at DESC').bind(me.id).all();
    return json({ tokens: r.results, current: auth.tokenId });
  }
  if (path === '/api/tokens' && method === 'POST') {
    const b = await body(req);
    const token = await issueToken(db, me.id, 'app', s(b.label) || 'Android app');
    return json({ token }, 201);
  }
  let m = /^\/api\/tokens\/(\d+)$/.exec(path);
  if (m && method === 'DELETE') {
    await db.prepare('DELETE FROM tokens WHERE id = ? AND user_id = ?').bind(Number(m[1]), me.id).run();
    return json({ ok: true });
  }

  // ---------- admin ----------
  if (path.startsWith('/api/admin/')) {
    if (!me.is_admin) return err(403, 'Admins only');
    if (path === '/api/admin/overview' && method === 'GET') {
      const users = await db
        .prepare(
          `SELECT u.id, u.email, u.is_admin, u.disabled, u.created_at, u.last_login,
             d.size AS data_size, d.updated_at AS data_updated, d.counts,
             (SELECT COUNT(*) FROM tokens t WHERE t.user_id = u.id) AS sessions,
             (SELECT MAX(last_used) FROM tokens t WHERE t.user_id = u.id) AS last_seen
           FROM users u LEFT JOIN data d ON d.user_id = u.id ORDER BY u.created_at`,
        )
        .all();
      return json({ users: users.results, registrationOpen: (await getSetting(db, 'registration', 'closed')) === 'open', me: me.id });
    }
    if (path === '/api/admin/settings' && method === 'POST') {
      const b = await body(req);
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('registration', b.registrationOpen ? 'open' : 'closed').run();
      return json({ ok: true });
    }
    if (path === '/api/admin/users' && method === 'POST') {
      const b = await body(req);
      const email = s(b.email).trim().toLowerCase();
      if (!validEmail(email)) return err(400, 'Enter a valid email address');
      if (s(b.password).length < 8) return err(400, 'Password must be at least 8 characters');
      if (await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) return err(409, 'Email already exists');
      const salt = randomHex(16);
      await db
        .prepare('INSERT INTO users (email, pw_hash, pw_salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(email, await hashPassword(s(b.password), salt), salt, b.isAdmin ? 1 : 0, Date.now())
        .run();
      return json({ ok: true }, 201);
    }
    m = /^\/api\/admin\/users\/(\d+)(\/password|\/sessions|\/data)?$/.exec(path);
    if (m) {
      const id = Number(m[1]);
      const sub = m[2] ?? '';
      const self = id === me.id;
      if (sub === '' && method === 'PATCH') {
        const b = await body(req);
        if (self && (b.disabled === true || b.isAdmin === false)) return err(400, 'You cannot disable or demote yourself');
        if (typeof b.disabled === 'boolean') {
          await db.prepare('UPDATE users SET disabled = ? WHERE id = ?').bind(b.disabled ? 1 : 0, id).run();
          if (b.disabled) await db.prepare('DELETE FROM tokens WHERE user_id = ?').bind(id).run();
        }
        if (typeof b.isAdmin === 'boolean') await db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(b.isAdmin ? 1 : 0, id).run();
        return json({ ok: true });
      }
      if (sub === '' && method === 'DELETE') {
        if (self) return err(400, 'You cannot delete yourself');
        await db.batch([
          db.prepare('DELETE FROM tokens WHERE user_id = ?').bind(id),
          db.prepare('DELETE FROM data WHERE user_id = ?').bind(id),
          db.prepare('DELETE FROM users WHERE id = ?').bind(id),
        ]);
        return json({ ok: true });
      }
      if (sub === '/password' && method === 'POST') {
        const b = await body(req);
        if (s(b.password).length < 8) return err(400, 'Password must be at least 8 characters');
        const salt = randomHex(16);
        await db.batch([
          db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await hashPassword(s(b.password), salt), salt, id),
          db.prepare('DELETE FROM tokens WHERE user_id = ?').bind(id),
        ]);
        return json({ ok: true });
      }
      if (sub === '/sessions' && method === 'DELETE') {
        await db.prepare('DELETE FROM tokens WHERE user_id = ?' + (self ? ' AND id != ?' : '')).bind(...(self ? [id, auth.tokenId] : [id])).run();
        return json({ ok: true });
      }
      if (sub === '/data' && method === 'GET') {
        const d = await db.prepare('SELECT content FROM data WHERE user_id = ?').bind(id).first<{ content: string }>();
        return new Response(d?.content ?? '{}', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (sub === '/data' && method === 'DELETE') {
        await db.prepare('DELETE FROM data WHERE user_id = ?').bind(id).run();
        return json({ ok: true });
      }
    }
    return err(404, 'Not found');
  }
  return err(404, 'Not found');
}

/** GitHub Contents API subset used by the app and website sync code. */
async function handleGitHubCompat(req: Request, env: Env, url: URL): Promise<Response> {
  const auth = await authUser(req, env);
  if (!auth) return err(401, 'Bad credentials');
  const me = auth.user;
  const db = env.DB;
  if (url.pathname === '/user') return json({ login: me.email, id: me.id });
  const parts = url.pathname.split('/').filter(Boolean); // repos, owner, repo, contents, ...path
  if (parts[0] !== 'repos' || parts.length < 3) return err(404, 'Not Found');
  if (parts.length === 3) return json({ full_name: `${parts[1]}/${parts[2]}`, private: true });
  if (parts[3] !== 'contents') return err(404, 'Not Found');

  if (req.method === 'GET') {
    const d = await db.prepare('SELECT content, sha, size FROM data WHERE user_id = ?').bind(me.id).first<{ content: string; sha: string; size: number }>();
    if (!d) return err(404, 'Not Found');
    return json({ type: 'file', encoding: 'base64', sha: d.sha, size: d.size, content: textToB64(d.content) });
  }
  if (req.method === 'PUT') {
    const b = await body(req);
    let text: string;
    try {
      text = b64ToText(s(b.content));
      JSON.parse(text);
    } catch {
      return err(422, 'content must be base64 encoded JSON');
    }
    const size = enc.encode(text).length;
    if (size > MAX_SIZE) return err(413, 'Sync data is too large (max 1.8 MB)');
    const cur = await db.prepare('SELECT sha FROM data WHERE user_id = ?').bind(me.id).first<{ sha: string }>();
    const expected = s(b.sha) || null;
    if ((cur?.sha ?? null) !== expected) return err(409, 'sha does not match');
    const sha = (await sha256(text + Date.now())).slice(0, 40);
    const counts = countsOf(text);
    const updatedBy = (() => {
      try {
        return s((JSON.parse(counts) as Row).updatedBy);
      } catch {
        return '';
      }
    })();
    if (cur) {
      const r = await db
        .prepare('UPDATE data SET content = ?, sha = ?, size = ?, counts = ?, updated_at = ?, updated_by = ? WHERE user_id = ? AND sha = ?')
        .bind(text, sha, size, counts, Date.now(), updatedBy, me.id, cur.sha)
        .run();
      if (!r.meta.changes) return err(409, 'sha does not match');
    } else {
      try {
        await db
          .prepare('INSERT INTO data (user_id, content, sha, size, counts, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(me.id, text, sha, size, counts, Date.now(), updatedBy)
          .run();
      } catch {
        return err(409, 'sha does not match');
      }
    }
    return json({ content: { sha, size } }, cur ? 200 : 201);
  }
  return err(405, 'Method not allowed');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const isApi = p.startsWith('/api/') || p === '/user' || p.startsWith('/repos/');
    if (!isApi) return env.ASSETS.fetch(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      await ensureSchema(env.DB);
      return p.startsWith('/api/') ? await handleApi(req, env, url) : await handleGitHubCompat(req, env, url);
    } catch (e) {
      console.error(e);
      return err(500, 'Server error');
    }
  },
};
