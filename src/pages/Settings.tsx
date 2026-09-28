import { useRef, useState, type ReactNode } from 'react';
import { actions, getState, isPersistent, setState, useStore } from '../store';
import { SyncError, exportBackup, parseData, syncNow, verifyAccount } from '../sync';
import { Confirm, Icon, Segmented, Switch, TopBar, navigate, toast } from '../ui';
import { downloadFile, relative } from '../util';

export const LINKS = {
  seraphina: 'https://github.com/ismeseraphina',
  cryjai: 'https://github.com/Cryjai',
  feedback: 'https://ismeseraphina.com',
  mybrain: 'https://github.com/mhss1/MyBrain',
  app: 'https://github.com/ismeseraphina/PenguinBrain',
  appDownload: 'https://github.com/ismeseraphina/PenguinBrain/releases',
  website: 'https://github.com/ismeseraphina/PenguinBrainWebsite',
  license: 'https://www.gnu.org/licenses/gpl-3.0.html',
  createRepo: 'https://github.com/new?name=PenguinBrainData&visibility=private&description=Penguin+Brain+sync+data',
  createToken: 'https://github.com/settings/personal-access-tokens/new?name=Penguin+Brain+Sync&description=Sync+Penguin+Brain+app+and+website&contents=write',
};

function Row({ icon, title, subtitle, onClick, href, right }: { icon: string; title: string; subtitle?: string; onClick?: () => void; href?: string; right?: ReactNode }) {
  const inner = (
    <>
      <span className="row-icon"><Icon name={icon} size={20} /></span>
      <span className="row-text">
        <strong>{title}</strong>
        {subtitle && <span className="muted small">{subtitle}</span>}
      </span>
      {right ?? (href ? <Icon name="open_link" size={16} className="muted" /> : <span className="chev">›</span>)}
    </>
  );
  if (href)
    return (
      <a className="settings-row" href={href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  return onClick ? (
    <button className="settings-row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="settings-row">{inner}</div>
  );
}

export function Credits() {
  return (
    <div className="settings-group">
      <Row icon="github" title="Modified by Seraphina" subtitle="github.com/ismeseraphina" href={LINKS.seraphina} />
      <Row icon="github" title="Seraphina's old GitHub" subtitle="github.com/Cryjai" href={LINKS.cryjai} />
      <Row icon="feature_issue" title="Feedback" subtitle="ismeseraphina.com" href={LINKS.feedback} />
      <Row icon="code" title="Based on MyBrain by mhss1" subtitle="Modified from the MyBrain source code · GPL-3.0" href={LINKS.mybrain} />
      <Row icon="code" title="Penguin Brain source" subtitle="Android app · github.com/ismeseraphina/PenguinBrain" href={LINKS.app} />
      <Row icon="code" title="Website source" subtitle="github.com/ismeseraphina/PenguinBrainWebsite" href={LINKS.website} />
    </div>
  );
}

export function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const fileRef = useRef<HTMLInputElement>(null);
  const [wipe, setWipe] = useState(false);

  const importFile = async (f: File) => {
    try {
      const data = parseData(JSON.parse(await f.text()));
      const upsertAll = <T extends { id: string }>(cur: T[], add: T[]) => {
        const m = new Map(cur.map((x) => [x.id, x]));
        add.forEach((x) => m.set(x.id, x));
        return [...m.values()];
      };
      setState((s) => ({
        ...s,
        notes: upsertAll(s.notes, data.notes),
        noteFolders: upsertAll(s.noteFolders, data.noteFolders),
        tasks: upsertAll(s.tasks, data.tasks),
        diary: upsertAll(s.diary, data.diary),
        bookmarks: upsertAll(s.bookmarks, data.bookmarks),
      }));
      toast(`Imported ${data.notes.length} notes, ${data.tasks.length} tasks, ${data.diary.length} diary entries, ${data.bookmarks.length} bookmarks`);
    } catch {
      toast('Could not read this file. Use a MyBrain / Penguin Brain JSON backup.', 'error');
    }
  };

  return (
    <div className="page narrow">
      <TopBar title="Settings" />
      <h2 className="section-title">Account</h2>
      <div className="settings-group">
        <Row
          icon="refresh"
          title="Sign in & Sync"
          subtitle={settings.sync.login ? `Signed in as ${settings.sync.login}${settings.sync.lastSync ? ` · synced ${relative(settings.sync.lastSync)}` : ''}` : 'Sync with the Penguin Brain Android app'}
          onClick={() => navigate('/settings/sync')}
        />
      </div>

      <h2 className="section-title">Appearance</h2>
      <div className="settings-group">
        <Row
          icon="paint_roller"
          title="Theme"
          right={
            <Segmented
              label="Theme"
              value={settings.theme}
              onChange={(v) => actions.updateSettings({ theme: v })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          }
        />
        <Row
          icon="calendar"
          title="First day of week"
          right={
            <Segmented
              label="First day of week"
              value={settings.firstDayOfWeek}
              onChange={(v) => actions.updateSettings({ firstDayOfWeek: v })}
              options={[
                { value: 0, label: 'Sunday' },
                { value: 1, label: 'Monday' },
              ]}
            />
          }
        />
      </div>

      <h2 className="section-title">Data</h2>
      <div className="settings-group">
        <Row icon="export" title="Export data" subtitle="JSON backup, can be imported in the Android app" onClick={() => downloadFile(`PenguinBrain_Backup_${Date.now()}.json`, exportBackup(getState()))} />
        <Row icon="import" title="Import data" subtitle="MyBrain or Penguin Brain JSON backup" onClick={() => fileRef.current?.click()} />
        <Row icon="delete" title="Clear data on this browser" subtitle="Removes local data only. Signed in data comes back on next sync." onClick={() => setWipe(true)} />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {!isPersistent() && <p className="muted small warn-text">This browser blocks local storage here, so data only lives until you close the tab. Sign in to keep it in sync.</p>}

      <h2 className="section-title">About</h2>
      <Credits />
      <p className="muted small license">
        Penguin Brain is a personal, non-commercial remix modified from the MyBrain code by mhss1, released under the{' '}
        <a href={LINKS.license} target="_blank" rel="noopener noreferrer">GNU GPL v3.0</a>. Get the Android app from{' '}
        <a href={LINKS.appDownload} target="_blank" rel="noopener noreferrer">GitHub Releases</a>.
      </p>
      <Confirm
        open={wipe}
        onClose={() => setWipe(false)}
        title="Clear local data?"
        message="Notes, tasks, diary and bookmarks stored in this browser will be removed. Your GitHub sync file is not touched, and you stay signed in."
        confirmLabel="Clear"
        onConfirm={() => {
          setState((s) => ({ ...s, notes: [], noteFolders: [], tasks: [], diary: [], bookmarks: [], syncBase: { account: '', ids: {} } }), false);
          toast('Local data cleared');
        }}
      />
    </div>
  );
}

export function SyncPage() {
  const sync = useStore((s) => s.settings.sync);
  const [token, setToken] = useState('');
  const [owner, setOwner] = useState(sync.owner || 'ismeseraphina');
  const [repo, setRepo] = useState(sync.repo || 'PenguinBrainData');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const signIn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { login, isPrivate } = await verifyAccount(token.trim(), owner.trim(), repo.trim());
      actions.updateSync({ token: token.trim(), owner: owner.trim(), repo: repo.trim(), login, lastError: '', lastSync: 0 });
      setState((s) => ({ ...s, syncBase: { account: '', ids: {} } }), false);
      const r = await syncNow();
      setMsg({ text: `Signed in as ${login}. ${r.pulled} changes downloaded, ${r.pushed} uploaded.${isPrivate ? '' : ' Warning: this repository is public, make it private to keep your data safe.'}`, err: !isPrivate });
      setToken('');
    } catch (e) {
      setMsg({ text: e instanceof SyncError ? e.message : 'Sign in failed', err: true });
    } finally {
      setBusy(false);
    }
  };
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

  return (
    <div className="page narrow">
      <TopBar title="Sign in & Sync" onBack={() => navigate('/settings')} />
      <div className="card pad sync-hero">
        <img src="img/penguin_app_icon.webp" alt="" width={72} height={72} />
        <div>
          <h2>One brain, two places</h2>
          <p className="muted">Notes, folders, tasks, diary and bookmarks sync between this website and the Penguin Brain Android app. Everything is saved as one JSON file in a private GitHub repository you own. No other server sees your data.</p>
        </div>
      </div>

      {!sync.login ? (
        <>
          <ol className="steps">
            <li>
              <strong>Create a private repository</strong> called <code>PenguinBrainData</code>.{' '}
              <a href={LINKS.createRepo} target="_blank" rel="noopener noreferrer">Create repository</a>
            </li>
            <li>
              <strong>Create a fine-grained token</strong>: Repository access → Only select repositories → <code>PenguinBrainData</code>, Permissions → Contents: <em>Read and write</em>.{' '}
              <a href={LINKS.createToken} target="_blank" rel="noopener noreferrer">Create token</a>
            </li>
            <li>
              <strong>Sign in here and in the app</strong> (Settings → Sign in &amp; Sync) with the same token and repository.
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
            <button className="btn wide" disabled={busy || !token.trim() || !owner.trim() || !repo.trim()} onClick={signIn}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="muted small">The token is stored only in this browser. Revoke it anytime on GitHub.</p>
          </div>
        </>
      ) : (
        <>
          <div className="settings-group">
            <Row icon="github" title={`Signed in as ${sync.login}`} subtitle={`Repository ${sync.owner}/${sync.repo}`} href={`https://github.com/${sync.owner}/${sync.repo}`} />
            <Row icon="time" title="Last sync" subtitle={sync.lastSync ? new Date(sync.lastSync).toLocaleString() : 'Never'} right={<span />} />
            <Row icon="refresh" title="Auto sync" subtitle="On open, after edits and every 5 minutes" right={<Switch label="Auto sync" checked={sync.auto} onChange={(v) => actions.updateSync({ auto: v })} />} />
          </div>
          {sync.lastError && !msg && <p className="error-text">Last sync failed: {sync.lastError}</p>}
          <div className="button-row">
            <button className="btn" disabled={busy} onClick={doSync}>{busy ? 'Syncing…' : 'Sync now'}</button>
            <button
              className="btn text danger"
              disabled={busy}
              onClick={() => {
                actions.updateSync({ token: '', login: '', lastSync: 0, lastError: '' });
                setState((s) => ({ ...s, syncBase: { account: '', ids: {} } }), false);
                setMsg({ text: 'Signed out. Your data stays in this browser.' });
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
      {msg && <p className={msg.err ? 'error-text' : 'ok-text'}>{msg.text}</p>}
      <p className="muted small">Merging works per item: the newest edit wins and deletions sync too. The sync file uses the MyBrain JSON backup format, so you can also import it in the app from Settings → Export/Import.</p>
    </div>
  );
}
