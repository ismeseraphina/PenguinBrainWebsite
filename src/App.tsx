import { useEffect, useState } from 'react';
import { getState, isLoaded, loadState, onDataChange, useStore } from './store';
import { isSyncing, syncNow } from './sync';
import { Icon, Toasts, navigate, useRoute } from './ui';
import { DashboardPage, SpacesPage } from './pages/Home';
import { TaskDetailPage, TasksPage } from './pages/Tasks';
import { NoteDetailPage, NotesPage } from './pages/Notes';
import { DiaryChartPage, DiaryDetailPage, DiaryPage } from './pages/Diary';
import { BookmarksPage } from './pages/Bookmarks';
import { CalendarPage } from './pages/Calendar';
import { SettingsPage, SyncPage } from './pages/Settings';

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-label="Penguin Brain logo" role="img">
      <ellipse cx="16" cy="17" rx="12" ry="13" fill="var(--penguin)" />
      <ellipse cx="16" cy="20" rx="8.2" ry="9" fill="#fff" />
      <circle cx="12.4" cy="14.6" r="1.6" fill="var(--penguin)" />
      <circle cx="19.6" cy="14.6" r="1.6" fill="var(--penguin)" />
      <path d="M14 18.2h4l-2 2.4z" fill="#F6A94A" />
      <circle cx="10.2" cy="18.6" r="1.3" fill="var(--primary)" opacity=".75" />
      <circle cx="21.8" cy="18.6" r="1.3" fill="var(--primary)" opacity=".75" />
    </svg>
  );
}

const NAV = [
  { path: 'spaces', label: 'Spaces', icon: 'spaces', iconOn: 'spaces_filled' },
  { path: 'dashboard', label: 'Dashboard', icon: 'home', iconOn: 'home_filled' },
  { path: 'settings', label: 'Settings', icon: 'settings', iconOn: 'settings_filled' },
];
const SUBNAV = [
  { path: 'notes', label: 'Notes', icon: 'add_note' },
  { path: 'tasks', label: 'Tasks', icon: 'check' },
  { path: 'diary', label: 'Diary', icon: 'happy' },
  { path: 'bookmarks', label: 'Bookmarks', icon: 'open_link' },
  { path: 'calendar', label: 'Calendar', icon: 'calendar' },
];

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#221a24' : '#fff5f9');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Auto sync: on open, on focus, 4s after edits, and every 5 minutes. */
function useAutoSync(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const can = () => {
      const s = getState().settings.sync;
      return s.auto && !!s.token && !!s.login && navigator.onLine;
    };
    const run = () => {
      if (can() && !isSyncing()) syncNow().catch(() => undefined);
    };
    run();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const off = onDataChange(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(run, 4000);
    });
    let lastFocus = Date.now();
    const onFocus = () => {
      if (Date.now() - lastFocus > 60000) {
        lastFocus = Date.now();
        run();
      }
    };
    const onVis = () => document.visibilityState === 'visible' && onFocus();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', run);
    const iv = setInterval(run, 5 * 60 * 1000);
    return () => {
      off();
      if (debounce) clearTimeout(debounce);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', run);
      clearInterval(iv);
    };
  }, [ready]);
}

function Page({ route }: { route: string[] }) {
  const [a, b, c] = route;
  switch (a) {
    case undefined:
    case 'spaces':
      return <SpacesPage />;
    case 'dashboard':
      return <DashboardPage />;
    case 'tasks':
      return b ? <TaskDetailPage key={b} id={b} /> : <TasksPage />;
    case 'notes':
      if (b === 'folder' && c) return <NotesPage key={c} folderId={c} />;
      if (b === 'new') return <NoteDetailPage key={`new-${c ?? ''}`} newFolderId={c ?? null} />;
      return b ? <NoteDetailPage key={b} id={b} /> : <NotesPage />;
    case 'diary':
      if (b === 'chart') return <DiaryChartPage />;
      if (b === 'new') return <DiaryDetailPage key="new" />;
      return b ? <DiaryDetailPage key={b} id={b} /> : <DiaryPage />;
    case 'bookmarks':
      return <BookmarksPage />;
    case 'calendar':
      return <CalendarPage />;
    case 'settings':
      return b === 'sync' ? <SyncPage /> : <SettingsPage />;
    default:
      return <SpacesPage />;
  }
}

export default function App() {
  const [ready, setReady] = useState(isLoaded());
  const route = useRoute();
  const sync = useStore((s) => s.settings.sync);
  useTheme();
  useAutoSync(ready);
  useEffect(() => {
    if (!ready) loadState().then(() => setReady(true));
  }, [ready]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.join('/')]);

  const top = route[0] ?? 'spaces';
  const activeNav = ['dashboard', 'settings', 'spaces'].includes(top) ? top : '';
  const mobileNav = activeNav || 'spaces';

  if (!ready) {
    return (
      <div className="splash">
        <img src="img/penguin_app_icon.webp" alt="" width={96} height={96} />
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="rail" aria-label="Main navigation">
        <button className="brand" onClick={() => navigate('/spaces')}>
          <Logo />
          <span>Penguin Brain</span>
        </button>
        <nav>
          {NAV.map((n) => (
            <button key={n.path} className={`nav-item ${activeNav === n.path ? 'on' : ''}`} onClick={() => navigate(`/${n.path}`)} aria-current={activeNav === n.path ? 'page' : undefined}>
              <Icon name={activeNav === n.path ? n.iconOn : n.icon} size={20} />
              <span>{n.label}</span>
            </button>
          ))}
          <div className="nav-divider" />
          {SUBNAV.map((n) => (
            <button key={n.path} className={`nav-item sub ${top === n.path ? 'on' : ''}`} onClick={() => navigate(`/${n.path}`)}>
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <button className={`sync-chip ${sync.lastError ? 'err' : ''}`} onClick={() => navigate('/settings/sync')}>
            <Icon name="refresh" size={14} />
            {sync.login ? (sync.lastError ? 'Sync error' : 'Synced') : 'Sign in to sync'}
          </button>
          <p className="muted tiny">
            Modified by <a href="https://github.com/ismeseraphina" target="_blank" rel="noopener noreferrer">Seraphina</a> (<a href="https://github.com/Cryjai" target="_blank" rel="noopener noreferrer">Cryjai</a>) from{' '}
            <a href="https://github.com/mhss1/MyBrain" target="_blank" rel="noopener noreferrer">MyBrain</a>. Feedback: <a href="https://ismeseraphina.com" target="_blank" rel="noopener noreferrer">ismeseraphina.com</a>
          </p>
        </div>
      </aside>
      <main className="content">
        <Page route={route} />
      </main>
      <nav className="bottom-nav" aria-label="Main navigation">
        {NAV.map((n) => (
          <button key={n.path} className={mobileNav === n.path ? 'on' : ''} onClick={() => navigate(`/${n.path}`)} aria-current={mobileNav === n.path ? 'page' : undefined}>
            <span className="pill"><Icon name={mobileNav === n.path ? n.iconOn : n.icon} size={20} /></span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
