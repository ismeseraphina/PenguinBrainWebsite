import { useMemo } from 'react';
import { useStore } from '../store';
import { MOODS } from '../types';
import { Icon, TopBar, navigate } from '../ui';
import { endOfDay, formatDate, now, relative, startOfDay } from '../util';
import { TaskRow, sortTasks } from './Tasks';
import { NoteCard } from './Notes';
import { moodInfo } from './Diary';

const SPACES = [
  { key: 'notes', title: 'Notes', img: 'img/penguin_notes.webp', tint: 'var(--space-blue)' },
  { key: 'tasks', title: 'Tasks', img: 'img/penguin_tasks.webp', tint: 'var(--space-red)' },
  { key: 'diary', title: 'Diary', img: 'img/penguin_diary.webp', tint: 'var(--space-green)' },
  { key: 'bookmarks', title: 'Bookmarks', img: 'img/penguin_bookmarks.webp', tint: 'var(--space-orange)' },
  { key: 'calendar', title: 'Calendar', img: 'img/penguin_calendar.webp', tint: 'var(--space-purple)' },
  { key: 'clock', title: 'Clock', img: 'img/penguin_clock.webp', tint: 'var(--space-blue)' },
  { key: 'assistant', title: 'Assistant', img: 'img/penguin_assistant.webp', tint: 'var(--primary-strong)' },
];

export function SpacesPage() {
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const diary = useStore((s) => s.diary);
  const bookmarks = useStore((s) => s.bookmarks);
  const counts = {
    notes: notes.length,
    tasks: tasks.filter((t) => !t.isCompleted).length,
    diary: diary.length,
    bookmarks: bookmarks.length,
    calendar: tasks.filter((t) => t.dueDate && !t.isCompleted).length,
    assistant: -1,
    clock: -1,
  };
  const label: Record<string, string> = { notes: 'notes', tasks: 'open', diary: 'entries', bookmarks: 'saved', calendar: 'due' };
  return (
    <div className="page">
      <TopBar title="Spaces" />
      <div className="spaces">
        {SPACES.map((s) => (
          <button key={s.key} className="space-card" style={{ ['--tint' as string]: s.tint }} onClick={() => navigate(`/${s.key}`)}>
            <img src={s.img} alt="" loading="eager" />
            <span className="space-title">{s.title}</span>
            <span className="space-count">
              {s.key === 'clock' ? 'Focus timer' : s.key === 'assistant' ? 'AI chat' : `${counts[s.key as keyof typeof counts]} ${label[s.key]}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const tasks = useStore((s) => s.tasks);
  const notes = useStore((s) => s.notes);
  const diary = useStore((s) => s.diary);
  const sync = useStore((s) => s.settings.sync);

  const today = useMemo(() => {
    const end = endOfDay(now());
    return sortTasks(tasks.filter((t) => !t.isCompleted && t.dueDate && t.dueDate <= end), 'dueDate');
  }, [tasks]);
  const upcoming = useMemo(() => {
    const start = endOfDay(now());
    const end = start + 7 * 86400000;
    return sortTasks(tasks.filter((t) => !t.isCompleted && t.dueDate > start && t.dueDate <= end), 'dueDate');
  }, [tasks]);
  const noDue = tasks.filter((t) => !t.isCompleted && !t.dueDate).length;
  const recentNotes = useMemo(() => notes.slice().sort((a, b) => b.updatedDate - a.updatedDate).slice(0, 4), [notes]);
  const week = useMemo(() => {
    const start = startOfDay(now()) - 6 * 86400000;
    return Array.from({ length: 7 }, (_, i) => {
      const d = start + i * 86400000;
      const e = diary.filter((x) => startOfDay(x.createdDate) === d).sort((a, b) => b.createdDate - a.createdDate)[0];
      return { d, e };
    });
  }, [diary]);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <TopBar
        title="Dashboard"
        subtitle={`${greet} · ${formatDate(now(), { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={
          <button className={`sync-chip ${sync.lastError ? 'err' : ''}`} onClick={() => navigate('/settings/sync')}>
            <Icon name="refresh" size={14} />
            {sync.login ? (sync.lastError ? 'Sync error' : sync.lastSync ? `Synced ${relative(sync.lastSync)}` : 'Not synced yet') : 'Sign in to sync'}
          </button>
        }
      />
      <div className="dash-grid">
        <section className="card pad dash-tasks">
          <div className="card-head">
            <h2>Today</h2>
            <button className="btn text" onClick={() => navigate('/tasks')}>All tasks</button>
          </div>
          {today.length === 0 ? (
            <p className="muted">Nothing due today{noDue ? `. ${noDue} tasks without a due date.` : '.'}</p>
          ) : (
            <div className="list">
              {today.map((t) => (
                <TaskRow key={t.id} task={t} compact />
              ))}
            </div>
          )}
          {upcoming.length > 0 && (
            <>
              <h3 className="sub-head">Next 7 days</h3>
              <div className="list">
                {upcoming.slice(0, 5).map((t) => (
                  <TaskRow key={t.id} task={t} compact />
                ))}
              </div>
            </>
          )}
        </section>
        <section className="card pad">
          <div className="card-head">
            <h2>Mood this week</h2>
            <button className="btn text" onClick={() => navigate('/diary/chart')}>Chart</button>
          </div>
          <div className="week-moods">
            {week.map(({ d, e }) => {
              const m = e ? moodInfo(e.mood) : null;
              return (
                <button key={d} className="week-day" onClick={() => navigate(e ? `/diary/${e.id}` : '/diary/new')} aria-label={`${formatDate(d)}${m ? `: ${m.label}` : ''}`}>
                  <span className="muted small">{formatDate(d, { weekday: 'narrow' })}</span>
                  <span className="week-mood" style={{ color: m?.color ?? 'var(--text-faint)' }}>
                    {m ? <Icon name={m.icon} size={26} /> : <span className="week-empty" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mood-legend">
            {MOODS.map((m) => (
              <span key={m.mood} style={{ color: m.color }}>
                <Icon name={m.icon} size={14} /> {m.label}
              </span>
            ))}
          </div>
        </section>
        <section className="card pad dash-notes">
          <div className="card-head">
            <h2>Recent notes</h2>
            <button className="btn text" onClick={() => navigate('/notes')}>All notes</button>
          </div>
          {recentNotes.length === 0 ? (
            <p className="muted">No notes yet.</p>
          ) : (
            <div className="notes-grid small">
              {recentNotes.map((n) => (
                <NoteCard key={n.id} note={n} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
