import { useEffect, useRef, useState } from 'react';
import { buildCards, dismissCard, elapsedOf, fmtDur, remainingOf, sessions, timerActions, useClockVersion, useSessions, useTimer, type Card } from '../clock';
import { actions, useStore } from '../store';
import type { ClockSettings, Routine } from '../types';
import { IconButton, Modal, Switch, TopBar, navigate } from '../ui';
import { uuid } from '../util';

const KIND: Record<string, { label: string; color: string }> = {
  'event-live': { label: 'Happening now', color: 'var(--space-purple)' },
  'event-next': { label: 'Coming up', color: 'var(--space-blue)' },
  task: { label: 'Do now', color: 'var(--space-red)' },
  routine: { label: 'Routine', color: 'var(--space-green)' },
  manual: { label: 'Your timer', color: 'var(--primary-strong)' },
  event: { label: 'Event', color: 'var(--space-purple)' },
};
const PRESETS = [25, 50, 90];
const pad = (n: number) => String(n).padStart(2, '0');
const clockText = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function useNow(ms = 1000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

function Ring({ progress, color, children }: { progress: number; color: string; children: React.ReactNode }) {
  const r = 132;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg viewBox="0 0 300 300" aria-hidden="true">
        <circle cx="150" cy="150" r={r} className="ring-track" />
        <circle cx="150" cy="150" r={r} className="ring-bar" style={{ stroke: color, strokeDasharray: c, strokeDashoffset: c * (1 - Math.min(1, Math.max(0, progress))) }} />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="150" y1="30" x2="150" y2={i % 3 ? 38 : 44} className="ring-tick" transform={`rotate(${i * 30} 150 150)`} />
        ))}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

function TimerCard() {
  const t = useTimer();
  const now = useNow(1000);
  if (!t) {
    const d = new Date(now);
    return (
      <section className="timer-card idle" style={{ ['--tint' as string]: KIND.manual.color }}>
        <Ring progress={(d.getSeconds() + d.getMilliseconds() / 1000) / 60} color="var(--primary-strong)">
          <img src="img/penguin_clock.webp" alt="" width={84} height={84} className="ring-penguin" />
          <div className="big-time">{pad(d.getHours())}:{pad(d.getMinutes())}</div>
          <div className="muted">{d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}</div>
        </Ring>
        <p className="timer-hint">Nothing running. Swipe the cards below and press START, or pick a length.</p>
        <div className="preset-row">
          {PRESETS.map((m) => (
            <button key={m} className="preset" onClick={() => timerActions.start(`Focus ${m} min`, m)}>{m}<small>min</small></button>
          ))}
        </div>
      </section>
    );
  }
  const k = KIND[t.kind] ?? KIND.manual;
  const remaining = remainingOf(t);
  const progress = elapsedOf(t) / t.duration;
  const running = !!t.startedAt;
  return (
    <section className={`timer-card ${running ? 'running' : 'paused'} ${t.finished ? 'finished' : ''}`} style={{ ['--tint' as string]: k.color }}>
      <div className="timer-top">
        <span className="kind-chip" style={{ background: k.color }}>{t.finished ? 'Finished' : running ? k.label : 'Paused'}</span>
        <span className="muted small">{fmtDur(t.duration)} session</span>
      </div>
      <Ring progress={progress} color={k.color}>
        <div className="big-time" aria-live="off">{clockText(remaining)}</div>
        <div className="timer-label">{t.label}</div>
        {!t.finished && <div className="muted small">ends {hm(Date.now() + remaining)}</div>}
      </Ring>
      <div className="countdown-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style={{ width: `${Math.min(100, progress * 100)}%`, background: k.color }} />
      </div>
      <div className="timer-actions">
        {t.finished ? (
          <>
            <button className="btn big" onClick={() => timerActions.done()}>Done</button>
            <button className="btn text big" onClick={() => timerActions.add(5)}>+5 min</button>
          </>
        ) : (
          <>
            <button className="btn text big" onClick={() => timerActions.stop()}>Stop</button>
            {running ? (
              <button className="btn big pause" onClick={() => timerActions.pause()}>Pause</button>
            ) : (
              <button className="btn big" onClick={() => timerActions.resume()}>Resume</button>
            )}
            <button className="btn text big" onClick={() => timerActions.add(5)}>+5 min</button>
          </>
        )}
      </div>
      <span className="sr-only" aria-live="polite">{now && t.finished ? 'Timer finished' : ''}</span>
    </section>
  );
}

function SuggestionCard({ c, now }: { c: Card; now: number }) {
  const k = KIND[c.kind];
  const countdown = c.kind === 'event-next' || (c.kind === 'routine' && c.at > now) ? c.at - now : 0;
  const live = c.kind === 'event-live' && c.end ? (now - c.at) / (c.end - c.at) : 0;
  const [mins, setMins] = useState(c.minutes);
  return (
    <article className="deck-card" style={{ ['--tint' as string]: k.color }}>
      <div className="deck-top">
        <span className="kind-chip" style={{ background: k.color }}>{k.label}</span>
        <button className="icon-btn" aria-label="Skip this card" onClick={() => dismissCard(c.key)}>×</button>
      </div>
      <h3>{c.title}</h3>
      <p className="muted">{c.detail}</p>
      {countdown > 0 && <div className="deck-count">starts in <b>{clockText(countdown)}</b></div>}
      {c.kind === 'event-live' && (
        <div className="countdown-bar small">
          <span style={{ width: `${Math.min(100, live * 100)}%`, background: k.color }} />
        </div>
      )}
      <div className="deck-foot">
        <div className="stepper" aria-label="Minutes">
          <button onClick={() => setMins((m) => Math.max(5, m - 5))} aria-label="5 minutes less">−</button>
          <span>{mins} min</span>
          <button onClick={() => setMins((m) => m + 5)} aria-label="5 minutes more">+</button>
        </div>
        <button className="btn big" onClick={() => { timerActions.start(c.title, mins, c.source, c.refId); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>START</button>
      </div>
      {c.source === 'task' && (
        <button className="btn text small" onClick={() => navigate(`/tasks/${c.refId}`)}>Open task</button>
      )}
    </article>
  );
}

function ManualCard() {
  const [mins, setMins] = useState(25);
  const [label, setLabel] = useState('');
  return (
    <article className="deck-card" style={{ ['--tint' as string]: KIND.manual.color }}>
      <div className="deck-top">
        <span className="kind-chip" style={{ background: KIND.manual.color }}>Manual</span>
      </div>
      <h3>Any time</h3>
      <input className="input" placeholder="What are you doing? (debug, past paper…)" aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
      <div className="preset-row">
        {PRESETS.map((m) => (
          <button key={m} className={`preset ${mins === m ? 'on' : ''}`} onClick={() => setMins(m)}>{m}<small>min</small></button>
        ))}
      </div>
      <div className="deck-foot">
        <div className="stepper">
          <button onClick={() => setMins((m) => Math.max(1, m - 5))} aria-label="5 minutes less">−</button>
          <span>{mins} min</span>
          <button onClick={() => setMins((m) => m + 5)} aria-label="5 minutes more">+</button>
        </div>
        <button className="btn big" onClick={() => { timerActions.start(label.trim() || `Focus ${mins} min`, mins); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>START</button>
      </div>
    </article>
  );
}

function Deck({ cards, now }: { cards: Card[]; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const total = cards.length + 1;
  const go = (i: number) => {
    const el = ref.current;
    const child = el?.children[Math.max(0, Math.min(total - 1, i))] as HTMLElement | undefined;
    if (el && child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  };
  return (
    <div className="deck-wrap">
      <div
        className="deck"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          const w = (el.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
          setIdx(Math.round(el.scrollLeft / (w + 14)));
        }}
      >
        {cards.map((c) => (
          <SuggestionCard key={c.key} c={c} now={now} />
        ))}
        <ManualCard />
      </div>
      <div className="deck-nav">
        <button className="icon-btn" aria-label="Previous card" onClick={() => go(idx - 1)} disabled={idx <= 0}>‹</button>
        <div className="dots">
          {Array.from({ length: total }, (_, i) => (
            <button key={i} className={`dot-btn ${i === idx ? 'on' : ''}`} aria-label={`Card ${i + 1}`} onClick={() => go(i)} />
          ))}
        </div>
        <button className="icon-btn" aria-label="Next card" onClick={() => go(idx + 1)} disabled={idx >= total - 1}>›</button>
      </div>
    </div>
  );
}

const LEADS = [
  { v: 30, label: '30 minutes' },
  { v: 60, label: '1 hour' },
  { v: 180, label: '3 hours' },
  { v: 360, label: '6 hours' },
  { v: 1440, label: '1 day' },
  { v: 2880, label: '2 days' },
];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function ClockSettingsModal({ onClose }: { onClose: () => void }) {
  const cfg = useStore((s) => s.settings.clock);
  const [draft, setDraft] = useState<ClockSettings>(cfg);
  const setR = (id: string, patch: Partial<Routine>) => setDraft((d) => ({ ...d, routines: d.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Clock settings"
      footer={
        <>
          <button className="btn text" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={() => { actions.updateSettings({ clock: draft }); onClose(); }}>Save</button>
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span className="field-label">Task focus window opens before the due date</span>
          <select className="input" value={draft.focusLeadMin} onChange={(e) => setDraft({ ...draft, focusLeadMin: Number(e.target.value) })}>
            {LEADS.map((l) => (
              <option key={l.v} value={l.v}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Suggested focus length</span>
          <select className="input" value={draft.focusMinutes} onChange={(e) => setDraft({ ...draft, focusMinutes: Number(e.target.value) })}>
            {[25, 50, 90].map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
        </label>
        <div className="field row">
          <span className="field-label">Notify when events start, task windows open and routines are due</span>
          <Switch label="Notifications" checked={draft.notify} onChange={(v) => setDraft({ ...draft, notify: v })} />
        </div>
        <h3 className="section-title">Routines</h3>
        {draft.routines.map((r) => (
          <div key={r.id} className="routine-row">
            <input className="input" aria-label="Routine name" value={r.name} onChange={(e) => setR(r.id, { name: e.target.value })} />
            <input className="input" type="time" aria-label="Time" value={r.time} onChange={(e) => setR(r.id, { time: e.target.value })} />
            <label className="mins">
              <input className="input" type="number" min={1} aria-label="Minutes" value={r.minutes} onChange={(e) => setR(r.id, { minutes: Math.max(1, Number(e.target.value) || 1) })} />
              <span className="muted small">min</span>
            </label>
            <div className="days">
              {DAYS.map((d, i) => (
                <button key={i} className={r.days.includes(i) ? 'on' : ''} aria-label={`Day ${i}`} aria-pressed={r.days.includes(i)} onClick={() => setR(r.id, { days: r.days.includes(i) ? r.days.filter((x) => x !== i) : [...r.days, i] })}>{d}</button>
              ))}
            </div>
            <Switch label="Enabled" checked={r.enabled} onChange={(v) => setR(r.id, { enabled: v })} />
            <IconButton icon="delete" label="Delete routine" onClick={() => setDraft((d) => ({ ...d, routines: d.routines.filter((x) => x.id !== r.id) }))} />
          </div>
        ))}
        <button className="btn text" onClick={() => setDraft((d) => ({ ...d, routines: [...d.routines, { id: uuid(), name: 'New routine', time: '09:00', minutes: 10, days: [1, 2, 3, 4, 5], enabled: true }] }))}>Add routine</button>
      </div>
    </Modal>
  );
}

export function ClockPage() {
  useStore((s) => s.events);
  useStore((s) => s.tasks);
  useStore((s) => s.settings.clock);
  useClockVersion();
  const log = sessions(useSessions());
  const now = useNow(1000);
  const [settings, setSettings] = useState(false);
  const cards = buildCards(now);
  const today = log.filter((s) => new Date(s.at).toDateString() === new Date(now).toDateString());
  const focused = today.reduce((a, s) => a + s.actual, 0);
  const perm = 'Notification' in window ? Notification.permission : 'denied';
  return (
    <div className="page clock-page">
      <TopBar
        title="Clock"
        subtitle="Events, task deadlines and routines, ready to start"
        actions={<IconButton icon="settings" label="Clock settings" onClick={() => setSettings(true)} />}
      />
      <div className="clock-layout">
        <TimerCard />
        <div className="clock-side">
          <div className="deck-head">
            <h2>Start next</h2>
            <span className="muted small">{cards.length ? `${cards.length} ready · swipe` : 'Swipe for manual timer'}</span>
          </div>
          <Deck cards={cards} now={now} />
          {perm === 'default' && <button className="btn text" onClick={() => Notification.requestPermission()}>Turn on clock notifications</button>}
          <div className="card today-card">
            <h3>Today</h3>
            <p className="big-stat">{fmtDur(focused * 60000)} <span className="muted small">in {today.length} session{today.length === 1 ? '' : 's'}</span></p>
            {today.slice(0, 6).map((s, i) => (
              <div key={i} className="session-row">
                <span className={`dot ${s.completed ? 'ok' : ''}`} />
                <span className="grow">{s.label}</span>
                <span className="muted small">{s.actual}/{s.planned} min · {hm(s.at)}</span>
              </div>
            ))}
            {today.length === 0 && <p className="muted small">Only sessions you start are counted. Stopping early is fine and saved as a partial session.</p>}
          </div>
        </div>
      </div>
      {settings && <ClockSettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

/** Small pill shown on other pages while a timer is running. */
export function TimerPill() {
  const t = useTimer();
  if (!t) return null;
  const k = KIND[t.kind] ?? KIND.manual;
  return (
    <button className="timer-pill" style={{ background: k.color }} onClick={() => navigate('/clock')} aria-label="Open clock">
      <span>{t.finished ? 'Done' : t.startedAt ? clockText(remainingOf(t)) : 'Paused'}</span>
      <small>{t.label}</small>
    </button>
  );
}
