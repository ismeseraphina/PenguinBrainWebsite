// Calendar events: recurrence expansion (subset of RRULE the Android app creates) and browser notifications.
import { getState, onDataChange } from './store';
import type { CalEvent } from './types';

const DAY = 86400000;
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export interface Occurrence {
  event: CalEvent;
  start: number;
  end: number;
}

export function parseRule(rrule: string) {
  const parts = Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, '')
      .split(';')
      .filter(Boolean)
      .map((p) => p.split('=') as [string, string]),
  );
  return {
    freq: (parts.FREQ ?? '').toUpperCase() as '' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    byDay: (parts.BYDAY ?? '').split(',').filter(Boolean).map((d: string) => BYDAY.indexOf(d.slice(-2).toUpperCase())).filter((i: number) => i >= 0),
    count: Number(parts.COUNT) || 0,
    until: parts.UNTIL ? parseUntil(parts.UNTIL) : 0,
  };
}
function parseUntil(s: string) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 23), +(m[5] ?? 59), +(m[6] ?? 59)) : 0;
}

/** Date parts of an event start: all-day events are stored at UTC midnight, timed events use local time. */
function parts(e: CalEvent, t: number) {
  const d = new Date(t);
  return e.allDay ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCDay()] : [d.getFullYear(), d.getMonth(), d.getDate(), d.getDay()];
}
function build(e: CalEvent, y: number, m: number, day: number) {
  const s = new Date(e.start);
  return e.allDay ? Date.UTC(y, m, day) : new Date(y, m, day, s.getHours(), s.getMinutes(), s.getSeconds()).getTime();
}


const p2 = (n: number) => String(n).padStart(2, '0');

/** Split a rule into the repeat pattern and its UNTIL date (YYYY-MM-DD, local for timed events). */
export function splitUntil(rrule: string, allDay: boolean): { base: string; until: string } {
  const parts = rrule.replace(/^RRULE:/i, '').split(';').filter(Boolean);
  const u = parts.find((x) => /^UNTIL=/i.test(x));
  const base = parts.filter((x) => !/^UNTIL=/i.test(x)).join(';');
  if (!u) return { base, until: '' };
  const t = parseUntil(u.slice(6));
  if (!t) return { base, until: '' };
  const d = new Date(t);
  const until = allDay || !/T/i.test(u) ? `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return { base, until };
}

/** Add UNTIL (inclusive last day, YYYY-MM-DD) to a repeat pattern. Timed events use the end of that local day in UTC. */
export function withUntil(base: string, until: string, allDay: boolean) {
  if (!base) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until);
  if (!m) return base;
  let v: string;
  if (allDay) v = `${m[1]}${m[2]}${m[3]}`;
  else {
    const d = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
    v = `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
  }
  return `${base};UNTIL=${v}`;
}

/**
 * A repeating event whose end is days after its start was almost always meant as
 * "every week from the start date until the end date". Turn it into one-occurrence
 * length + UNTIL. Returns null when nothing needs fixing.
 */
export function fixRepeatSpan(e: CalEvent): CalEvent | null {
  if (!e.rrule || !parseRule(e.rrule).freq) return null;
  const span = e.end - e.start;
  if (e.allDay ? span <= DAY : span < DAY) return null;
  const { base, until } = splitUntil(e.rrule, e.allDay);
  if (e.allDay) {
    const last = new Date(e.end - DAY);
    const u = until || `${last.getUTCFullYear()}-${p2(last.getUTCMonth() + 1)}-${p2(last.getUTCDate())}`;
    return { ...e, end: e.start + DAY, rrule: withUntil(base, u, true) };
  }
  const s = new Date(e.start);
  const en = new Date(e.end);
  let end = new Date(s.getFullYear(), s.getMonth(), s.getDate(), en.getHours(), en.getMinutes(), en.getSeconds()).getTime();
  if (end <= e.start) end = e.start + 3600000;
  const u = until || `${en.getFullYear()}-${p2(en.getMonth() + 1)}-${p2(en.getDate())}`;
  return { ...e, end, rrule: withUntil(base, u, false) };
}

/** Occurrences overlapping [from, to). */
export function occurrences(e: CalEvent, from: number, to: number): Occurrence[] {
  e = fixRepeatSpan(e) ?? e;
  const len = Math.max(0, e.end - e.start);
  const r = e.rrule ? parseRule(e.rrule) : null;
  if (!r || !r.freq) return e.start < to && e.start + Math.max(len, 1) > from ? [{ event: e, start: e.start, end: e.end }] : [];
  const out: Occurrence[] = [];
  const [y0, m0, d0, wd0] = parts(e, e.start);
  let n = 0;
  const push = (t: number) => {
    if (t < e.start) return true;
    if ((r.until && t > r.until) || (r.count && n >= r.count) || t >= to) return false;
    n++;
    if (t + Math.max(len, 1) > from) out.push({ event: e, start: t, end: t + len });
    return true;
  };
  for (let i = 0; i < 5000; i++) {
    const k = i * r.interval;
    if (r.freq === 'DAILY') {
      if (!push(build(e, y0, m0, d0 + k))) break;
    } else if (r.freq === 'WEEKLY') {
      const days = r.byDay.length ? [...r.byDay].sort() : [wd0];
      let go = true;
      for (const wd of days) if (!(go = push(build(e, y0, m0, d0 - wd0 + k * 7 + wd)))) break;
      if (!go) break;
    } else if (r.freq === 'MONTHLY') {
      const probe = new Date(Date.UTC(y0, m0 + k, 1));
      const dim = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate();
      if (d0 <= dim && !push(build(e, probe.getUTCFullYear(), probe.getUTCMonth(), d0))) break;
    } else if (r.freq === 'YEARLY') {
      if (!push(build(e, y0 + k, m0, d0))) break;
    } else break;
  }
  return out;
}

export function eventsBetween(events: CalEvent[], from: number, to: number) {
  return events.flatMap((e) => occurrences(e, from, to)).sort((a, b) => Number(b.event.allDay) - Number(a.event.allDay) || a.start - b.start);
}

/** For all-day events, the local-midnight day the UTC date refers to. */
export function occurrenceDay(o: Occurrence, which: 'start' | 'end' = 'start') {
  const t = which === 'start' ? o.start : Math.max(o.start, o.end - 1);
  if (!o.event.allDay) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  const d = new Date(t);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

export function onDay(events: CalEvent[], day: number) {
  // widen by a day either side so all-day (UTC) events are caught, then filter by local day
  return eventsBetween(events, day - DAY, day + 2 * DAY).filter((o) => occurrenceDay(o) <= day && occurrenceDay(o, 'end') >= day);
}

// ---------------- notifications ----------------
const FIRED_KEY = 'pb-fired-reminders';
let timer = 0;

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function fired(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}');
  } catch {
    return {};
  }
}

export async function show(title: string, body: string, tag: string) {
  try {
    const reg = await navigator.serviceWorker?.register?.('sw.js');
    if (reg) await reg.showNotification(title, { body, tag, icon: 'img/icon-192.png' });
    else new Notification(title, { body, tag, icon: 'img/icon-192.png' });
  } catch {
    /* ignore */
  }
}

function check() {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const t = Date.now();
  const done = fired();
  const events = getState().events.filter((e) => e.reminders.length);
  for (const o of eventsBetween(events, t - DAY, t + 8 * DAY)) {
    for (const min of o.event.reminders) {
      const at = o.event.allDay ? occurrenceDay(o) - min * 60000 : o.start - min * 60000;
      const key = `${o.event.id}@${o.start}@${min}`;
      if (at <= t && t - at < 15 * 60000 && !done[key]) {
        done[key] = t;
        const when = o.event.allDay ? 'All day' : new Date(o.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        show(o.event.title || 'Event', `${when}${o.event.location ? ' · ' + o.event.location : ''}`, key);
      }
    }
  }
  for (const k of Object.keys(done)) if (t - done[k] > 10 * DAY) delete done[k];
  localStorage.setItem(FIRED_KEY, JSON.stringify(done));
}

export function startReminders() {
  if (timer) return;
  check();
  timer = window.setInterval(check, 30000);
  onDataChange(check);
}
