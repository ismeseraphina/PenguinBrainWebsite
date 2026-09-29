// Clock: focus timer + "what should I start now" cards built from calendar events, tasks and routines.
// Nothing starts by itself: events, tasks and routines only notify and offer a START button,
// so the session log only contains sessions you really started.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { eventsBetween, show } from './events';
import { getState } from './store';
import type { Routine } from './types';

const MIN = 60000;
const TIMER_KEY = 'pb-timer';
const LOG_KEY = 'pb-sessions';
const FIRED_KEY = 'pb-clock-fired';
const DISMISS_KEY = 'pb-clock-dismissed';

export type SourceKind = 'event' | 'task' | 'routine' | 'manual';
export interface Timer {
  label: string;
  kind: SourceKind;
  refId: string;
  duration: number; // ms
  startedAt: number; // when the current run started, 0 while paused
  elapsed: number; // ms counted before the current run
  finished: boolean;
}
export interface Session {
  label: string;
  kind: SourceKind;
  planned: number; // minutes
  actual: number; // minutes
  completed: boolean;
  at: number;
}

// ---------------- timer store ----------------
const listeners = new Set<() => void>();
const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};
let timer: Timer | null = read<Timer | null>(TIMER_KEY, null);
const emit = () => listeners.forEach((l) => l());
const setTimer = (t: Timer | null) => {
  timer = t;
  write(TIMER_KEY, t);
  emit();
};

export const elapsedOf = (t: Timer, at = Date.now()) => t.elapsed + (t.startedAt ? at - t.startedAt : 0);
export const remainingOf = (t: Timer, at = Date.now()) => Math.max(0, t.duration - elapsedOf(t, at));

function log(t: Timer, completed: boolean) {
  const mins = Math.round(elapsedOf(t) / MIN);
  if (mins < 1 && !completed) return; // accidental taps are not "failed" sessions
  const list = read<Session[]>(LOG_KEY, []);
  list.unshift({ label: t.label, kind: t.kind, planned: Math.round(t.duration / MIN), actual: Math.min(mins, Math.round(t.duration / MIN)), completed, at: Date.now() });
  write(LOG_KEY, list.slice(0, 200));
  emit();
}

export const timerActions = {
  start(label: string, minutes: number, kind: SourceKind = 'manual', refId = '') {
    if (timer && !timer.finished) log(timer, false);
    setTimer({ label, kind, refId, duration: Math.max(1, Math.round(minutes)) * MIN, startedAt: Date.now(), elapsed: 0, finished: false });
    ensureNotifyPermission();
  },
  pause() {
    if (timer?.startedAt) setTimer({ ...timer, elapsed: elapsedOf(timer), startedAt: 0 });
  },
  resume() {
    if (timer && !timer.startedAt && !timer.finished) setTimer({ ...timer, startedAt: Date.now() });
  },
  add(minutes: number) {
    if (!timer) return;
    const duration = Math.max(MIN, timer.duration + minutes * MIN);
    setTimer({ ...timer, duration, finished: false, startedAt: timer.finished ? Date.now() : timer.startedAt, elapsed: timer.finished ? elapsedOf(timer) : timer.elapsed });
  },
  /** Stop early. Counted as a partial session, never as a failure record. */
  stop() {
    if (timer && !timer.finished) log(timer, false);
    setTimer(null);
  },
  done() {
    if (timer && !timer.finished) log({ ...timer }, true);
    setTimer(null);
  },
};

export function useTimer() {
  const t = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => timer,
  );
  const [, tick] = useState(0);
  useEffect(() => {
    if (!t?.startedAt) return;
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [t?.startedAt]);
  return t;
}

export function useSessions() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => localStorage.getItem(LOG_KEY) ?? '[]',
  );
}
export const sessions = (raw: string) => {
  try {
    return JSON.parse(raw) as Session[];
  } catch {
    return [];
  }
};

// ---------------- suggestion cards ----------------
export type CardKind = 'event-live' | 'event-next' | 'task' | 'routine';
export interface Card {
  key: string;
  kind: CardKind;
  source: SourceKind;
  refId: string;
  title: string;
  detail: string;
  minutes: number;
  at: number; // start time / due date / routine time
  end?: number;
}

export function routineAt(r: Routine, day: number) {
  const [h, m] = r.time.split(':').map(Number);
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0).getTime();
}

export const fmtDur = (ms: number) => {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
};
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function buildCards(at = Date.now()): Card[] {
  const s = getState();
  const cfg = s.settings.clock;
  const dismissed = read<Record<string, number>>(DISMISS_KEY, {});
  const cards: Card[] = [];

  // calendar events: live now, or starting within 12 hours
  for (const o of eventsBetween(s.events, at - 36 * 60 * MIN, at + 12 * 60 * MIN)) {
    const e = o.event;
    if (e.allDay) continue;
    const key = `ev:${e.id}@${o.start}`;
    if (o.start <= at && o.end > at) {
      cards.push({ key, kind: 'event-live', source: 'event', refId: e.id, title: e.title || 'Event', detail: `In progress · ${fmtDur(o.end - at)} left · until ${hm(o.end)}`, minutes: Math.max(1, Math.ceil((o.end - at) / MIN)), at: o.start, end: o.end });
    } else if (o.start > at) {
      cards.push({ key, kind: 'event-next', source: 'event', refId: e.id, title: e.title || 'Event', detail: `${hm(o.start)}–${hm(o.end)}${e.location ? ' · ' + e.location : ''}`, minutes: Math.max(1, Math.round((o.end - o.start) / MIN)), at: o.start, end: o.end });
    }
  }

  // tasks: focus window opens `focusLeadMin` before the due date
  for (const t of s.tasks) {
    if (t.isCompleted || !t.dueDate) continue;
    const opens = t.dueDate - cfg.focusLeadMin * MIN;
    if (at < opens || at > t.dueDate + 24 * 60 * MIN) continue;
    const left = t.dueDate - at;
    const minutes = left > 0 ? Math.max(5, Math.min(cfg.focusMinutes, Math.floor(left / MIN))) : cfg.focusMinutes;
    cards.push({ key: `task:${t.id}@${t.dueDate}`, kind: 'task', source: 'task', refId: t.id, title: t.title || 'Task', detail: left > 0 ? `Due in ${fmtDur(left)} · do it now` : `Overdue by ${fmtDur(-left)}`, minutes, at: t.dueDate });
  }

  // routines: from 30 min before to 60 min after their time
  const dayStart = new Date(new Date(at).toDateString()).getTime();
  const weekday = new Date(at).getDay();
  for (const r of cfg.routines) {
    if (!r.enabled || !r.days.includes(weekday)) continue;
    const t = routineAt(r, dayStart);
    if (at < t - 30 * MIN || at > t + 60 * MIN) continue;
    cards.push({ key: `rt:${r.id}@${t}`, kind: 'routine', source: 'routine', refId: r.id, title: r.name, detail: at < t ? `At ${r.time} · in ${fmtDur(t - at)}` : `Now · ${r.minutes} min`, minutes: r.minutes, at: t });
  }

  const rank: Record<CardKind, number> = { 'event-live': 0, routine: 1, task: 2, 'event-next': 3 };
  return cards.filter((c) => !dismissed[c.key]).sort((a, b) => rank[a.kind] - rank[b.kind] || a.at - b.at);
}

export function dismissCard(key: string) {
  const d = read<Record<string, number>>(DISMISS_KEY, {});
  d[key] = Date.now();
  for (const k of Object.keys(d)) if (Date.now() - d[k] > 3 * 86400000) delete d[k];
  write(DISMISS_KEY, d);
  emit();
}
export function useClockVersion() {
  // re-render when dismissals change
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => localStorage.getItem(DISMISS_KEY) ?? '',
  );
}

// ---------------- notifications ----------------
function ensureNotifyPermission() {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

let started = false;
export function startClock() {
  if (started) return;
  started = true;
  const check = () => {
    const t = Date.now();
    // timer finished
    if (timer && !timer.finished && remainingOf(timer, t) <= 0) {
      const done = { ...timer, finished: true, elapsed: timer.duration, startedAt: 0 };
      log(done, true);
      setTimer(done);
      navigator.vibrate?.([300, 150, 300]);
      if ('Notification' in window && Notification.permission === 'granted') show(`Done: ${done.label}`, 'Time is up. Take a breath, then pick the next card.', 'pb-timer');
    }
    if (!getState().settings.clock.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const fired = read<Record<string, number>>(FIRED_KEY, {});
    for (const c of buildCards(t)) {
      // events: at start time. tasks: when the focus window opens. routines: at their time.
      const due = c.kind === 'task' ? c.at - getState().settings.clock.focusLeadMin * MIN : c.at;
      if (t >= due && t - due < 10 * MIN && !fired[c.key]) {
        fired[c.key] = t;
        const title = c.kind === 'task' ? `Time to start: ${c.title}` : c.kind === 'routine' ? `${c.title} · ${c.minutes} min` : `${c.title} is starting`;
        show(title, 'Open Clock and press START when you are ready.', c.key);
      }
    }
    for (const k of Object.keys(fired)) if (t - fired[k] > 3 * 86400000) delete fired[k];
    write(FIRED_KEY, fired);
  };
  check();
  window.setInterval(check, 15000);
  // also catch the exact end of a running timer
  window.setInterval(() => timer?.startedAt && remainingOf(timer) <= 0 && check(), 1000);
}
