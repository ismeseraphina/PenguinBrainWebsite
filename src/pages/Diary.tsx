import { useMemo, useRef, useState } from 'react';
import { actions, useStore } from '../store';
import type { DiaryEntry, Mood } from '../types';
import { MOODS } from '../types';
import { Confirm, Empty, Fab, Icon, IconButton, SearchField, Segmented, TopBar, navigate, toast } from '../ui';
import { formatDate, formatTime, fromLocalInput, now, plainPreview, renderMarkdown, toLocalInput, uuid } from '../util';

export const moodInfo = (m: Mood) => MOODS.find((x) => x.mood === m) ?? MOODS[2];

export function MoodIcon({ mood, size = 22 }: { mood: Mood; size?: number }) {
  const m = moodInfo(mood);
  return (
    <span className="mood-icon" style={{ color: m.color }} title={m.label}>
      <Icon name={m.icon} size={size} />
    </span>
  );
}

export function DiaryPage() {
  const entries = useStore((s) => s.diary);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const l = entries
      .filter((e) => !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q))
      .sort((a, b) => b.createdDate - a.createdDate);
    const map = new Map<string, DiaryEntry[]>();
    l.forEach((e) => {
      const k = formatDate(e.createdDate, { month: 'long', year: 'numeric' });
      map.set(k, [...(map.get(k) ?? []), e]);
    });
    return [...map.entries()];
  }, [entries, query]);

  return (
    <div className="page">
      <TopBar title="Diary" subtitle={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`} actions={<IconButton icon="chart" label="Mood chart" onClick={() => navigate('/diary/chart')} />} />
      <div className="toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Search diary" />
      </div>
      {groups.length === 0 ? (
        <Empty image="img/penguin_diary.webp" text={query ? 'No entries match your search' : "You don't have any entries. Click + to write today's entry."} />
      ) : (
        groups.map(([month, list]) => (
          <section key={month} className="group">
            <h2 className="group-title">{month}</h2>
            <div className="list">
              {list.map((e) => (
                <button key={e.id} className="diary-row" onClick={() => navigate(`/diary/${e.id}`)}>
                  <div className="diary-date">
                    <strong>{new Date(e.createdDate).getDate()}</strong>
                    <span>{formatDate(e.createdDate, { weekday: 'short' })}</span>
                  </div>
                  <div className="diary-text">
                    <h3>{e.title || 'Untitled'}</h3>
                    <p>{plainPreview(e.content, 140)}</p>
                  </div>
                  <MoodIcon mood={e.mood} size={26} />
                </button>
              ))}
            </div>
          </section>
        ))
      )}
      <Fab label="New entry" onClick={() => navigate('/diary/new')} />
    </div>
  );
}

export function DiaryDetailPage({ id }: { id?: string }) {
  const stored = useStore((s) => (id ? s.diary.find((d) => d.id === id) : undefined));
  const draftRef = useRef<DiaryEntry>({ title: '', content: '', createdDate: now(), updatedDate: now(), mood: 'OKAY', id: uuid() });
  const [draft, setDraft] = useState<DiaryEntry | null>(null);
  const entry = stored ?? draft ?? draftRef.current;
  const exists = useStore((s) => s.diary.some((d) => d.id === entry.id));
  const [reading, setReading] = useState(!!stored && !!stored.content);
  const [confirm, setConfirm] = useState(false);

  const update = (patch: Partial<DiaryEntry>) => {
    const next = { ...entry, ...patch, updatedDate: now() };
    setDraft(next);
    if (exists || next.title.trim() || next.content.trim()) {
      actions.upsertEntry(next);
      if (!id) window.history.replaceState(null, '', `#/diary/${next.id}`);
    }
  };

  return (
    <div className="page narrow">
      <TopBar
        title={exists ? formatDate(entry.createdDate, { weekday: 'long', day: 'numeric', month: 'long' }) : 'New entry'}
        onBack={() => navigate('/diary')}
        actions={
          <>
            <IconButton icon={reading ? 'edit' : 'read_mode'} label={reading ? 'Edit' : 'Reading mode'} active={reading} onClick={() => setReading(!reading)} />
            {exists && <IconButton icon="delete" label="Delete entry" danger onClick={() => setConfirm(true)} />}
          </>
        }
      />
      <div className="card pad editor">
        <div className="mood-picker" role="radiogroup" aria-label="Mood">
          {MOODS.map((m) => (
            <button key={m.mood} role="radio" aria-checked={entry.mood === m.mood} className={entry.mood === m.mood ? 'on' : ''} style={{ ['--c' as string]: m.color }} onClick={() => update({ mood: m.mood })}>
              <Icon name={m.icon} size={30} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="editor-meta">
          <input className="input compact" type="datetime-local" aria-label="Entry date" value={toLocalInput(entry.createdDate)} onChange={(e) => update({ createdDate: fromLocalInput(e.target.value) || entry.createdDate })} />
          <span className="muted small">{formatTime(entry.createdDate)}</span>
        </div>
        <input className="input title-input bare" value={entry.title} placeholder="Title" aria-label="Entry title" onChange={(e) => update({ title: e.target.value })} />
        {reading ? (
          <div className="markdown" onDoubleClick={() => setReading(false)} dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.content) || '<p class="muted">Empty entry</p>' }} />
        ) : (
          <textarea className="input bare note-body" value={entry.content} placeholder="How was your day?" aria-label="Entry content" onChange={(e) => update({ content: e.target.value })} />
        )}
      </div>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete entry?"
        message="This deletes the diary entry on every synced device."
        onConfirm={() => {
          actions.deleteEntry(entry.id);
          navigate('/diary');
          toast('Entry deleted');
        }}
      />
    </div>
  );
}

export function MoodChart({ entries, days }: { entries: DiaryEntry[]; days: number }) {
  const since = now() - days * 86400000;
  const pts = entries.filter((e) => e.createdDate >= since).sort((a, b) => a.createdDate - b.createdDate);
  const W = 640;
  const H = 220;
  const pad = 28;
  if (pts.length === 0) return <p className="muted center">No entries in this period.</p>;
  const x = (t: number) => pad + ((t - since) / (now() - since)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - 1) / 4) * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.createdDate).toFixed(1)},${y(moodInfo(p.mood).value).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mood over time">
      {MOODS.map((m) => (
        <g key={m.mood}>
          <line x1={pad} x2={W - pad} y1={y(m.value)} y2={y(m.value)} className="grid" />
          <text x={4} y={y(m.value) + 4} className="axis">{m.value}</text>
        </g>
      ))}
      <path d={line} className="line" />
      {pts.map((p) => (
        <circle key={p.id} cx={x(p.createdDate)} cy={y(moodInfo(p.mood).value)} r={5} style={{ fill: moodInfo(p.mood).color }}>
          <title>{`${formatDate(p.createdDate)}: ${moodInfo(p.mood).label}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function DiaryChartPage() {
  const entries = useStore((s) => s.diary);
  const [days, setDays] = useState(30);
  const inRange = entries.filter((e) => e.createdDate >= now() - days * 86400000);
  const avg = inRange.length ? inRange.reduce((a, e) => a + moodInfo(e.mood).value, 0) / inRange.length : 0;
  const avgMood = MOODS.reduce((best, m) => (Math.abs(m.value - avg) < Math.abs(best.value - avg) ? m : best), MOODS[2]);
  return (
    <div className="page narrow">
      <TopBar title="Mood chart" onBack={() => navigate('/diary')} />
      <div className="toolbar">
        <Segmented label="Period" value={days} onChange={setDays} options={[{ value: 7, label: 'Week' }, { value: 30, label: 'Month' }, { value: 365, label: 'Year' }]} />
      </div>
      <div className="card pad">
        <MoodChart entries={entries} days={days} />
      </div>
      {inRange.length > 0 && (
        <div className="card pad">
          <div className="mood-summary">
            <div>
              <span className="muted small">Average mood</span>
              <div className="mood-avg" style={{ color: avgMood.color }}>
                <Icon name={avgMood.icon} size={34} /> <strong>{avgMood.label}</strong>
              </div>
            </div>
            <div className="mood-counts">
              {MOODS.map((m) => {
                const c = inRange.filter((e) => e.mood === m.mood).length;
                return (
                  <div key={m.mood} className="mood-count" style={{ color: m.color }}>
                    <Icon name={m.icon} size={22} />
                    <div className="bar"><span style={{ width: `${(c / inRange.length) * 100}%`, background: m.color }} /></div>
                    <span className="count">{c}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
