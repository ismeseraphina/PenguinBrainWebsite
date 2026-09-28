import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { actions, getState, setState, useStore } from '../store';
import { SyncError, isServer, syncNow, verifyAccount } from '../sync';
import { Confirm, Modal, Segmented, Switch, TopBar, navigate, toast } from '../ui';
import { LINKS, Row } from './Settings';

/** Backend lives on the same origin when the site is served by the Cloudflare Worker. */
export const SERVER = window.location.origin;

async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      cache: 'no-store',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new SyncError('Network error, check your connection');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new SyncError('Account server not available on this address');
  const data = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new SyncError(data.message ?? `Error ${res.status}`);
  return data;
}
const authed = <T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}) => api<T>(path, { ...init, token: getState().settings.sync.token });

type User = { id: number; email: string; isAdmin: boolean };

function resetBase() {
  setState((s) => ({ ...s, syncBase: { account: '', ids: {} } }), false);
}

function AccountSignIn({ onDone }: { onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<{ registrationOpen: boolean; hasUsers: boolean } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    api<{ registrationOpen: boolean; hasUsers: boolean }>('/api/config')
      .then((c) => {
        setConfig(c);
        if (!c.hasUsers) setMode('register');
      })
      .catch(() => setUnavailable(true));
  }, []);

  if (unavailable)
    return (
      <div className="card pad">
        <p className="muted">Account sign in only works on the Cloudflare version of Penguin Brain. On this address, use GitHub sync instead.</p>
      </div>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ token: string; user: User }>(`/api/auth/${mode}`, { body: { email, password, label: navigator.userAgent.includes('Mobile') ? 'Phone browser' : 'Website' } });
      actions.updateSync({ token: r.token, owner: SERVER, repo: 'data', login: r.user.email, isAdmin: r.user.isAdmin, lastError: '', lastSync: 0 });
      resetBase();
      const s = await syncNow();
      onDone(`Signed in as ${r.user.email}. ${s.pulled} changes downloaded, ${s.pushed} uploaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card pad form" onSubmit={submit}>
      <Segmented
        label="Account"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'login', label: 'Sign in' },
          { value: 'register', label: 'Create account' },
        ]}
      />
      {mode === 'register' && config && !config.hasUsers && <p className="muted small">First account on this server becomes the admin.</p>}
      {mode === 'register' && config && config.hasUsers && !config.registrationOpen && <p className="error-text small">Sign ups are closed. Ask the admin to create an account for you.</p>}
      <label className="field">
        <span className="field-label">Email</span>
        <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button className="btn wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

function GitHubSignIn({ onDone }: { onDone: (msg: string, err?: boolean) => void }) {
  const sync = useStore((s) => s.settings.sync);
  const [token, setToken] = useState('');
  const [owner, setOwner] = useState(isServer(sync.owner) ? 'ismeseraphina' : sync.owner || 'ismeseraphina');
  const [repo, setRepo] = useState(sync.repo && sync.repo !== 'data' ? sync.repo : 'PenguinBrainData');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signIn = async () => {
    setBusy(true);
    setError('');
    try {
      const { login, isPrivate } = await verifyAccount(token.trim(), owner.trim(), repo.trim());
      actions.updateSync({ token: token.trim(), owner: owner.trim(), repo: repo.trim(), login, isAdmin: false, lastError: '', lastSync: 0 });
      resetBase();
      const r = await syncNow();
      onDone(`Signed in as ${login}. ${r.pulled} changes downloaded, ${r.pushed} uploaded.${isPrivate ? '' : ' Warning: this repository is public, make it private.'}`, !isPrivate);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ol className="steps">
        <li>
          <a href={LINKS.createRepo} target="_blank" rel="noopener noreferrer">Create a private repository</a> called <code>PenguinBrainData</code>.
        </li>
        <li>
          <a href={LINKS.createToken} target="_blank" rel="noopener noreferrer">Create a fine-grained token</a> for that repository with Contents: Read and write.
        </li>
      </ol>
      <div className="card pad form">
        <label className="field">
          <span className="field-label">GitHub token</span>
          <input className="input" type="password" autoComplete="off" value={token} placeholder="github_pat_…" onChange={(e) => setToken(e.target.value)} />
        </label>
        <div className="two">
          <label className="field">
            <span className="field-label">Repository owner</span>
            <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Repository name</span>
            <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} />
          </label>
        </div>
        <button className="btn wide" disabled={busy || !token.trim() || !owner.trim() || !repo.trim()} onClick={signIn}>{busy ? 'Signing in…' : 'Sign in with GitHub token'}</button>
        {error && <p className="error-text">{error}</p>}
      </div>
    </>
  );
}

function ConnectApp() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await authed<{ token: string }>('/api/tokens', { body: { label: 'Android app' } });
      setToken(r.token);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Copied'));
  return (
    <div className="card pad form">
      <h3>Connect the Android app</h3>
      <p className="muted small">In the app open Settings → Sign in &amp; Sync and fill in the three fields below. The app then syncs with this account.</p>
      <div className="kv">
        <span>Token</span>
        {token ? <code className="copy" onClick={() => copy(token)}>{token}</code> : <button className="btn text" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create app token'}</button>}
        <span>Repository owner</span>
        <code className="copy" onClick={() => copy(SERVER)}>{SERVER}</code>
        <span>Repository name</span>
        <code className="copy" onClick={() => copy('data')}>data</code>
      </div>
      {token && <p className="muted small">Shown once. Tap a value to copy it.</p>}
    </div>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const save = async () => {
    try {
      await authed('/api/auth/password', { body: { current: cur, next } });
      toast('Password changed. Other devices were signed out.');
      setOpen(false);
      setCur('');
      setNext('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };
  return (
    <>
      <Row icon="lock" title="Change password" subtitle="Signs out your other devices" onClick={() => setOpen(true)} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Change password"
        footer={
          <>
            <button className="btn text" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn" disabled={next.length < 8 || !cur} onClick={save}>Save</button>
          </>
        }
      >
        <div className="form">
          <input className="input" type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
          <input className="input" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}

export function SyncPage() {
  const sync = useStore((s) => s.settings.sync);
  const [tab, setTab] = useState<'account' | 'github'>('account');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const account = isServer(sync.owner);

  useEffect(() => {
    if (sync.login && account)
      api<{ user: User }>('/api/auth/me', { token: sync.token })
        .then((r) => actions.updateSync({ isAdmin: r.user.isAdmin, login: r.user.email }))
        .catch(() => undefined);
  }, [sync.login, sync.token, account]);

  const doSync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await syncNow();
      setMsg({ text: `Synced. ${r.pulled} changes downloaded, ${r.pushed} uploaded.` });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Sync failed', err: true });
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    if (account) await api('/api/auth/logout', { method: 'POST', token: sync.token }).catch(() => undefined);
    actions.updateSync({ token: '', login: '', lastSync: 0, lastError: '', isAdmin: false });
    resetBase();
    setMsg({ text: 'Signed out. Your data stays in this browser.' });
  };

  return (
    <div className="page narrow">
      <TopBar title="Sign in & Sync" onBack={() => navigate('/settings')} />
      <div className="card pad sync-hero">
        <img src="img/penguin_app_icon.webp" alt="" width={72} height={72} />
        <div>
          <h2>One brain, every device</h2>
          <p className="muted">Notes, folders, tasks, diary and bookmarks sync between this website, your phone browser and the Penguin Brain Android app.</p>
        </div>
      </div>

      {!sync.login ? (
        <>
          <div className="toolbar">
            <Segmented
              label="Sign in method"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'account', label: 'Email & password' },
                { value: 'github', label: 'GitHub repository' },
              ]}
            />
          </div>
          {tab === 'account' ? <AccountSignIn onDone={(t) => setMsg({ text: t })} /> : <GitHubSignIn onDone={(t, err) => setMsg({ text: t, err })} />}
        </>
      ) : (
        <>
          <div className="settings-group">
            <Row icon={account ? 'lock' : 'github'} title={`Signed in as ${sync.login}`} subtitle={account ? `Penguin Brain account${sync.isAdmin ? ' · admin' : ''}` : `GitHub ${sync.owner}/${sync.repo}`} right={<span />} />
            <Row icon="time" title="Last sync" subtitle={sync.lastSync ? new Date(sync.lastSync).toLocaleString() : 'Never'} right={<span />} />
            <Row icon="refresh" title="Auto sync" subtitle="On open, after edits and every 5 minutes" right={<Switch label="Auto sync" checked={sync.auto} onChange={(v) => actions.updateSync({ auto: v })} />} />
            {account && <ChangePassword />}
            {account && sync.isAdmin && <Row icon="settings" title="Admin page" subtitle="Users, sign ups and server data" onClick={() => navigate('/admin')} />}
          </div>
          {sync.lastError && !msg && <p className="error-text">Last sync failed: {sync.lastError}</p>}
          <div className="button-row">
            <button className="btn" disabled={busy} onClick={doSync}>{busy ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn text danger" disabled={busy} onClick={signOut}>Sign out</button>
          </div>
          {account && <ConnectApp />}
        </>
      )}
      {msg && <p className={msg.err ? 'error-text' : 'ok-text'}>{msg.text}</p>}
      <p className="muted small">Merging works per item: the newest edit wins and deletions sync too.</p>
    </div>
  );
}

// ---------------- admin ----------------
interface AdminUser {
  id: number;
  email: string;
  is_admin: number;
  disabled: number;
  created_at: number;
  last_login: number;
  data_size: number | null;
  data_updated: number | null;
  counts: string | null;
  sessions: number;
  last_seen: number | null;
}

const fmt = (t: number | null) => (t ? new Date(t).toLocaleString() : '—');
const kb = (n: number | null) => (n ? `${(n / 1024).toFixed(1)} KB` : '—');

export function AdminPage() {
  const sync = useStore((s) => s.settings.sync);
  const [data, setData] = useState<{ users: AdminUser[]; registrationOpen: boolean; me: number } | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '' });
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [deleteFor, setDeleteFor] = useState<AdminUser | null>(null);

  const load = useCallback(() => {
    authed<{ users: AdminUser[]; registrationOpen: boolean; me: number }>('/api/admin/overview')
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);
  useEffect(() => {
    if (sync.isAdmin) load();
  }, [load, sync.isAdmin]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  if (!sync.isAdmin || !isServer(sync.owner))
    return (
      <div className="page narrow">
        <TopBar title="Admin" onBack={() => navigate('/settings')} />
        <p className="muted">Sign in with an admin Penguin Brain account to see this page.</p>
      </div>
    );

  const totals = (data?.users ?? []).reduce(
    (a, u) => {
      const c = u.counts ? (JSON.parse(u.counts) as Record<string, number>) : {};
      return { size: a.size + (u.data_size ?? 0), items: a.items + (c.notes ?? 0) + (c.tasks ?? 0) + (c.diary ?? 0) + (c.bookmarks ?? 0) };
    },
    { size: 0, items: 0 },
  );

  return (
    <div className="page">
      <TopBar title="Admin" subtitle="Penguin Brain server" onBack={() => navigate('/settings')} actions={<button className="btn text" onClick={load}>Refresh</button>} />
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="stats">
            <div className="card pad stat"><span className="muted small">Users</span><strong>{data.users.length}</strong></div>
            <div className="card pad stat"><span className="muted small">Synced items</span><strong>{totals.items}</strong></div>
            <div className="card pad stat"><span className="muted small">Storage</span><strong>{kb(totals.size)}</strong></div>
            <div className="card pad stat">
              <span className="muted small">Sign ups</span>
              <div className="stat-row">
                <strong>{data.registrationOpen ? 'Open' : 'Closed'}</strong>
                <Switch label="Allow sign ups" checked={data.registrationOpen} onChange={(v) => act(() => authed('/api/admin/settings', { body: { registrationOpen: v } }), v ? 'Sign ups opened' : 'Sign ups closed')} />
              </div>
            </div>
          </div>
          <div className="card-head">
            <h2>Users</h2>
            <button className="btn" onClick={() => setAdding(true)}>Add user</button>
          </div>
          <div className="table-wrap card">
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Data</th>
                  <th>Last sync</th>
                  <th>Last seen</th>
                  <th>Sessions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => {
                  const c = u.counts ? (JSON.parse(u.counts) as Record<string, number | string>) : {};
                  const self = u.id === data.me;
                  return (
                    <tr key={u.id} className={u.disabled ? 'disabled' : ''}>
                      <td>
                        <strong>{u.email}</strong>
                        <div className="muted small">Joined {new Date(u.created_at).toLocaleDateString()}</div>
                      </td>
                      <td>{u.disabled ? <span className="chip warn">Disabled</span> : u.is_admin ? <span className="chip">Admin</span> : <span className="chip">User</span>}</td>
                      <td className="small">
                        {u.data_size ? `${c.notes ?? 0} notes · ${c.tasks ?? 0} tasks · ${c.diary ?? 0} diary · ${c.bookmarks ?? 0} links` : '—'}
                        <div className="muted">{kb(u.data_size)}{c.updatedBy ? ` · from ${c.updatedBy}` : ''}</div>
                      </td>
                      <td className="small">{fmt(u.data_updated)}</td>
                      <td className="small">{fmt(u.last_seen)}</td>
                      <td>{u.sessions}</td>
                      <td className="actions">
                        {!self && (
                          <button className="btn text" onClick={() => act(() => authed(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { isAdmin: !u.is_admin } }), 'Role updated')}>
                            {u.is_admin ? 'Make user' : 'Make admin'}
                          </button>
                        )}
                        {!self && (
                          <button className="btn text" onClick={() => act(() => authed(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } }), u.disabled ? 'Enabled' : 'Disabled')}>
                            {u.disabled ? 'Enable' : 'Disable'}
                          </button>
                        )}
                        <button className="btn text" onClick={() => { setResetFor(u); setResetPw(''); }}>Reset password</button>
                        <button className="btn text" onClick={() => act(() => authed(`/api/admin/users/${u.id}/sessions`, { method: 'DELETE' }), 'Signed out everywhere')}>Sign out all</button>
                        {u.data_size ? (
                          <button
                            className="btn text"
                            onClick={async () => {
                              const r = await fetch(`${SERVER}/api/admin/users/${u.id}/data`, { headers: { authorization: `Bearer ${sync.token}` } });
                              const blob = await r.blob();
                              const a = document.createElement('a');
                              a.href = URL.createObjectURL(blob);
                              a.download = `penguinbrain-${u.email}.json`;
                              a.click();
                            }}
                          >
                            Download data
                          </button>
                        ) : null}
                        {!self && <button className="btn text danger" onClick={() => setDeleteFor(u)}>Delete</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">Passwords are stored as PBKDF2-SHA256 hashes. Data lives in your Cloudflare D1 database. Open source: <a href={LINKS.website} target="_blank" rel="noopener noreferrer">PenguinBrainWebsite</a>.</p>
        </>
      )}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add user"
        footer={
          <>
            <button className="btn text" onClick={() => setAdding(false)}>Cancel</button>
            <button
              className="btn"
              disabled={!newUser.email || newUser.password.length < 8}
              onClick={() => act(() => authed('/api/admin/users', { body: newUser }), 'User added').then(() => { setAdding(false); setNewUser({ email: '', password: '' }); })}
            >
              Add
            </button>
          </>
        }
      >
        <div className="form">
          <input className="input" type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
          <input className="input" type="text" placeholder="Temporary password (8+ characters)" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
        </div>
      </Modal>
      <Modal
        open={resetFor != null}
        onClose={() => setResetFor(null)}
        title={`Reset password for ${resetFor?.email ?? ''}`}
        footer={
          <>
            <button className="btn text" onClick={() => setResetFor(null)}>Cancel</button>
            <button className="btn" disabled={resetPw.length < 8} onClick={() => resetFor && act(() => authed(`/api/admin/users/${resetFor.id}/password`, { body: { password: resetPw } }), 'Password reset, all their devices were signed out').then(() => setResetFor(null))}>Reset</button>
          </>
        }
      >
        <input className="input" type="text" placeholder="New password (8+ characters)" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
      </Modal>
      <Confirm
        open={deleteFor != null}
        onClose={() => setDeleteFor(null)}
        title={`Delete ${deleteFor?.email ?? ''}?`}
        message="This removes the account, its sessions and all of its synced data on the server. It cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => deleteFor && act(() => authed(`/api/admin/users/${deleteFor.id}`, { method: 'DELETE' }), 'User deleted')}
      />
    </div>
  );
}
