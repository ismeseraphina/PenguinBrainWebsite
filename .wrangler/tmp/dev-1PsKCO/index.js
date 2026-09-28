var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_used INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS data (user_id INTEGER PRIMARY KEY, content TEXT NOT NULL, sha TEXT NOT NULL, size INTEGER NOT NULL, counts TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`
];
var schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s2) => db.prepare(s2)));
  schemaReady = true;
}
__name(ensureSchema, "ensureSchema");
var MAX_SIZE = 18e5;
var enc = new TextEncoder();
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS }
}), "json");
var CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, accept, x-github-api-version",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
};
var err = /* @__PURE__ */ __name((status, message) => json({ message }, status), "err");
var hex = /* @__PURE__ */ __name((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""), "hex");
var randomHex = /* @__PURE__ */ __name((n) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer), "randomHex");
var sha256 = /* @__PURE__ */ __name(async (s2) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s2))), "sha256");
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 1e5 }, key, 256);
  return hex(bits);
}
__name(hashPassword, "hashPassword");
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
__name(safeEqual, "safeEqual");
function b64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
__name(b64ToText, "b64ToText");
function textToB64(text) {
  const bytes = enc.encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(bin);
}
__name(textToB64, "textToB64");
var validEmail = /* @__PURE__ */ __name((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200, "validEmail");
var publicUser = /* @__PURE__ */ __name((u) => ({ id: u.id, email: u.email, isAdmin: !!u.is_admin, createdAt: u.created_at, lastLogin: u.last_login }), "publicUser");
async function getSetting(db, key, fallback) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return r?.value ?? fallback;
}
__name(getSetting, "getSetting");
async function userCount(db) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM users").first())?.n ?? 0;
}
__name(userCount, "userCount");
async function registrationOpen(db) {
  if (await userCount(db) === 0) return true;
  return await getSetting(db, "registration", "closed") === "open";
}
__name(registrationOpen, "registrationOpen");
async function limited(db, key, max, windowMs) {
  const now = Date.now();
  const r = await db.prepare("SELECT count, reset_at FROM attempts WHERE key = ?").bind(key).first();
  if (!r || r.reset_at < now) {
    await db.prepare("INSERT OR REPLACE INTO attempts (key, count, reset_at) VALUES (?, 1, ?)").bind(key, now + windowMs).run();
    return false;
  }
  if (r.count >= max) return true;
  await db.prepare("UPDATE attempts SET count = count + 1 WHERE key = ?").bind(key).run();
  return false;
}
__name(limited, "limited");
async function issueToken(db, userId, kind, label) {
  const token = `pb_${randomHex(24)}`;
  await db.prepare("INSERT INTO tokens (hash, user_id, kind, label, created_at) VALUES (?, ?, ?, ?, ?)").bind(await sha256(token), userId, kind, label.slice(0, 80), Date.now()).run();
  return token;
}
__name(issueToken, "issueToken");
async function authUser(req, env) {
  const h = req.headers.get("authorization") ?? "";
  const m = /^(?:Bearer|token)\s+(\S+)$/i.exec(h);
  if (!m) return null;
  const hash = await sha256(m[1]);
  const r = await env.DB.prepare(
    "SELECT t.id AS token_id, t.last_used, u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?"
  ).bind(hash).first();
  if (!r || r.disabled) return null;
  if (Date.now() - r.last_used > 6e4) {
    await env.DB.prepare("UPDATE tokens SET last_used = ? WHERE id = ?").bind(Date.now(), r.token_id).run();
  }
  return { user: r, tokenId: r.token_id };
}
__name(authUser, "authUser");
async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
__name(body, "body");
var s = /* @__PURE__ */ __name((v) => typeof v === "string" ? v : "", "s");
function countsOf(text) {
  try {
    const o = JSON.parse(text);
    const n = /* @__PURE__ */ __name((k) => Array.isArray(o[k]) ? o[k].length : 0, "n");
    return JSON.stringify({ notes: n("notes"), noteFolders: n("noteFolders"), tasks: n("tasks"), diary: n("diary"), bookmarks: n("bookmarks"), updatedBy: s(o.updatedBy) });
  } catch {
    return "{}";
  }
}
__name(countsOf, "countsOf");
async function handleApi(req, env, url) {
  const db = env.DB;
  const path = url.pathname;
  const method = req.method;
  if (path === "/api/config" && method === "GET") {
    return json({ registrationOpen: await registrationOpen(db), hasUsers: await userCount(db) > 0 });
  }
  if (path === "/api/auth/register" && method === "POST") {
    const b = await body(req);
    const email = s(b.email).trim().toLowerCase();
    const password = s(b.password);
    if (!validEmail(email)) return err(400, "Enter a valid email address");
    if (password.length < 8) return err(400, "Password must be at least 8 characters");
    if (!await registrationOpen(db)) return err(403, "Registration is closed. Ask the admin to create an account for you.");
    if (await limited(db, `reg:${req.headers.get("cf-connecting-ip") ?? ""}`, 10, 36e5)) return err(429, "Too many attempts, try again later");
    const exists = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (exists) return err(409, "An account with this email already exists");
    const first = await userCount(db) === 0;
    const salt = randomHex(16);
    const now = Date.now();
    const r = await db.prepare("INSERT INTO users (email, pw_hash, pw_salt, is_admin, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?) RETURNING *").bind(email, await hashPassword(password, salt), salt, first ? 1 : 0, now, now).first();
    const token = await issueToken(db, r.id, "web", s(b.label) || "Website");
    return json({ token, user: publicUser(r) }, 201);
  }
  if (path === "/api/auth/login" && method === "POST") {
    const b = await body(req);
    const email = s(b.email).trim().toLowerCase();
    const password = s(b.password);
    if (await limited(db, `login:${email}`, 10, 15 * 6e4)) return err(429, "Too many attempts, wait 15 minutes");
    const u = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!u || !safeEqual(await hashPassword(password, u.pw_salt), u.pw_hash)) return err(401, "Wrong email or password");
    if (u.disabled) return err(403, "This account is disabled");
    await db.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(Date.now(), u.id).run();
    await db.prepare("DELETE FROM attempts WHERE key = ?").bind(`login:${email}`).run();
    const kind = b.kind === "app" ? "app" : "web";
    const token = await issueToken(db, u.id, kind, s(b.label) || (kind === "app" ? "Android app" : "Website"));
    return json({ token, user: publicUser(u) });
  }
  const auth = await authUser(req, env);
  if (!auth) return err(401, "Bad credentials");
  const me = auth.user;
  if (path === "/api/auth/me" && method === "GET") return json({ user: publicUser(me) });
  if (path === "/api/auth/logout" && method === "POST") {
    await db.prepare("DELETE FROM tokens WHERE id = ?").bind(auth.tokenId).run();
    return json({ ok: true });
  }
  if (path === "/api/auth/password" && method === "POST") {
    const b = await body(req);
    const u = await db.prepare("SELECT pw_hash, pw_salt FROM users WHERE id = ?").bind(me.id).first();
    if (!u || !safeEqual(await hashPassword(s(b.current), u.pw_salt), u.pw_hash)) return err(401, "Current password is wrong");
    if (s(b.next).length < 8) return err(400, "New password must be at least 8 characters");
    const salt = randomHex(16);
    await db.batch([
      db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").bind(await hashPassword(s(b.next), salt), salt, me.id),
      db.prepare("DELETE FROM tokens WHERE user_id = ? AND id != ?").bind(me.id, auth.tokenId)
    ]);
    return json({ ok: true });
  }
  if (path === "/api/tokens" && method === "GET") {
    const r = await db.prepare("SELECT id, kind, label, created_at, last_used FROM tokens WHERE user_id = ? ORDER BY created_at DESC").bind(me.id).all();
    return json({ tokens: r.results, current: auth.tokenId });
  }
  if (path === "/api/tokens" && method === "POST") {
    const b = await body(req);
    const token = await issueToken(db, me.id, "app", s(b.label) || "Android app");
    return json({ token }, 201);
  }
  let m = /^\/api\/tokens\/(\d+)$/.exec(path);
  if (m && method === "DELETE") {
    await db.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ?").bind(Number(m[1]), me.id).run();
    return json({ ok: true });
  }
  if (path.startsWith("/api/admin/")) {
    if (!me.is_admin) return err(403, "Admins only");
    if (path === "/api/admin/overview" && method === "GET") {
      const users = await db.prepare(
        `SELECT u.id, u.email, u.is_admin, u.disabled, u.created_at, u.last_login,
             d.size AS data_size, d.updated_at AS data_updated, d.counts,
             (SELECT COUNT(*) FROM tokens t WHERE t.user_id = u.id) AS sessions,
             (SELECT MAX(last_used) FROM tokens t WHERE t.user_id = u.id) AS last_seen
           FROM users u LEFT JOIN data d ON d.user_id = u.id ORDER BY u.created_at`
      ).all();
      return json({ users: users.results, registrationOpen: await getSetting(db, "registration", "closed") === "open", me: me.id });
    }
    if (path === "/api/admin/settings" && method === "POST") {
      const b = await body(req);
      await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind("registration", b.registrationOpen ? "open" : "closed").run();
      return json({ ok: true });
    }
    if (path === "/api/admin/users" && method === "POST") {
      const b = await body(req);
      const email = s(b.email).trim().toLowerCase();
      if (!validEmail(email)) return err(400, "Enter a valid email address");
      if (s(b.password).length < 8) return err(400, "Password must be at least 8 characters");
      if (await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()) return err(409, "Email already exists");
      const salt = randomHex(16);
      await db.prepare("INSERT INTO users (email, pw_hash, pw_salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?)").bind(email, await hashPassword(s(b.password), salt), salt, b.isAdmin ? 1 : 0, Date.now()).run();
      return json({ ok: true }, 201);
    }
    m = /^\/api\/admin\/users\/(\d+)(\/password|\/sessions|\/data)?$/.exec(path);
    if (m) {
      const id = Number(m[1]);
      const sub = m[2] ?? "";
      const self = id === me.id;
      if (sub === "" && method === "PATCH") {
        const b = await body(req);
        if (self && (b.disabled === true || b.isAdmin === false)) return err(400, "You cannot disable or demote yourself");
        if (typeof b.disabled === "boolean") {
          await db.prepare("UPDATE users SET disabled = ? WHERE id = ?").bind(b.disabled ? 1 : 0, id).run();
          if (b.disabled) await db.prepare("DELETE FROM tokens WHERE user_id = ?").bind(id).run();
        }
        if (typeof b.isAdmin === "boolean") await db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").bind(b.isAdmin ? 1 : 0, id).run();
        return json({ ok: true });
      }
      if (sub === "" && method === "DELETE") {
        if (self) return err(400, "You cannot delete yourself");
        await db.batch([
          db.prepare("DELETE FROM tokens WHERE user_id = ?").bind(id),
          db.prepare("DELETE FROM data WHERE user_id = ?").bind(id),
          db.prepare("DELETE FROM users WHERE id = ?").bind(id)
        ]);
        return json({ ok: true });
      }
      if (sub === "/password" && method === "POST") {
        const b = await body(req);
        if (s(b.password).length < 8) return err(400, "Password must be at least 8 characters");
        const salt = randomHex(16);
        await db.batch([
          db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").bind(await hashPassword(s(b.password), salt), salt, id),
          db.prepare("DELETE FROM tokens WHERE user_id = ?").bind(id)
        ]);
        return json({ ok: true });
      }
      if (sub === "/sessions" && method === "DELETE") {
        await db.prepare("DELETE FROM tokens WHERE user_id = ?" + (self ? " AND id != ?" : "")).bind(...self ? [id, auth.tokenId] : [id]).run();
        return json({ ok: true });
      }
      if (sub === "/data" && method === "GET") {
        const d = await db.prepare("SELECT content FROM data WHERE user_id = ?").bind(id).first();
        return new Response(d?.content ?? "{}", { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      }
      if (sub === "/data" && method === "DELETE") {
        await db.prepare("DELETE FROM data WHERE user_id = ?").bind(id).run();
        return json({ ok: true });
      }
    }
    return err(404, "Not found");
  }
  return err(404, "Not found");
}
__name(handleApi, "handleApi");
async function handleGitHubCompat(req, env, url) {
  const auth = await authUser(req, env);
  if (!auth) return err(401, "Bad credentials");
  const me = auth.user;
  const db = env.DB;
  if (url.pathname === "/user") return json({ login: me.email, id: me.id });
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "repos" || parts.length < 3) return err(404, "Not Found");
  if (parts.length === 3) return json({ full_name: `${parts[1]}/${parts[2]}`, private: true });
  if (parts[3] !== "contents") return err(404, "Not Found");
  if (req.method === "GET") {
    const d = await db.prepare("SELECT content, sha, size FROM data WHERE user_id = ?").bind(me.id).first();
    if (!d) return err(404, "Not Found");
    return json({ type: "file", encoding: "base64", sha: d.sha, size: d.size, content: textToB64(d.content) });
  }
  if (req.method === "PUT") {
    const b = await body(req);
    let text;
    try {
      text = b64ToText(s(b.content));
      JSON.parse(text);
    } catch {
      return err(422, "content must be base64 encoded JSON");
    }
    const size = enc.encode(text).length;
    if (size > MAX_SIZE) return err(413, "Sync data is too large (max 1.8 MB)");
    const cur = await db.prepare("SELECT sha FROM data WHERE user_id = ?").bind(me.id).first();
    const expected = s(b.sha) || null;
    if ((cur?.sha ?? null) !== expected) return err(409, "sha does not match");
    const sha = (await sha256(text + Date.now())).slice(0, 40);
    const counts = countsOf(text);
    const updatedBy = (() => {
      try {
        return s(JSON.parse(counts).updatedBy);
      } catch {
        return "";
      }
    })();
    if (cur) {
      const r = await db.prepare("UPDATE data SET content = ?, sha = ?, size = ?, counts = ?, updated_at = ?, updated_by = ? WHERE user_id = ? AND sha = ?").bind(text, sha, size, counts, Date.now(), updatedBy, me.id, cur.sha).run();
      if (!r.meta.changes) return err(409, "sha does not match");
    } else {
      try {
        await db.prepare("INSERT INTO data (user_id, content, sha, size, counts, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(me.id, text, sha, size, counts, Date.now(), updatedBy).run();
      } catch {
        return err(409, "sha does not match");
      }
    }
    return json({ content: { sha, size } }, cur ? 200 : 201);
  }
  return err(405, "Method not allowed");
}
__name(handleGitHubCompat, "handleGitHubCompat");
var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const isApi = p.startsWith("/api/") || p === "/user" || p.startsWith("/repos/");
    if (!isApi) return env.ASSETS.fetch(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      await ensureSchema(env.DB);
      return p.startsWith("/api/") ? await handleApi(req, env, url) : await handleGitHubCompat(req, env, url);
    } catch (e) {
      console.error(e);
      return err(500, "Server error");
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-dfp62b/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-dfp62b/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
