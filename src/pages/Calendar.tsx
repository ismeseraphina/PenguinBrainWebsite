import { useMemo, useState } from 'react';
import { actions, useStore } from '../store';
import type { CalEvent } from '../types';
import { Confirm, Empty, IconButton, Modal, Switch, TopBar, navigate } from '../ui';
import { notificationsSupported, onDay, parseRule, type Occurrence } from '../events';
import { now, uuid } from '../util';
import { formatDate, isSameDay, startOfDay } from '../util';
import { AddTaskModal, TaskRow } from './Tasks';
import { MoodIcon } from './Diary';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarPage() {
  const tasks = useStore((s) => s.tasks);
  const diary = useStore((s) => s.diary);
  const firstDay = useStore((s) => s.settings.firstDayOfWeek);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [selected, setSelected] = useState(() => startOfDay(Date.now()));
  const [adding, setAdding] = useState(false);
  const events = useStore((s) => s.events);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [perm, setPerm] = useState(() => (notificationsSupported() ? Notification.permission : 'denied'));

  const cells = useMemo(() => {
    const m = new Date(month);
    const offset = (m.getDay() - firstDay + 7) % 7;
    const start = new Date(m.getFullYear(), m.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime());
  }, [month, firstDay]);

  const dayTasks = (d: number) => tasks.filter((t) => t.dueDate && isSameDay(t.dueDate, d));
  const dayDiary = (d: number) => diary.filter((e) => isSameDay(e.createdDate, d));
  const dayEvents = (d: number) => onDay(events, d);
  const shift = (n: number) => {
    const d = new Date(month);
    setMonth(new Date(d.getFullYear(), d.getMonth() + n, 1).getTime());
  };
  const weekdays = [...WEEKDAYS.slice(firstDay), ...WEEKDAYS.slice(0, firstDay)];
  const selTasks = dayTasks(selected).sort((a, b) => a.dueDate - b.dueDate);
  const selDiary = dayDiary(selected);
  const selEvents = dayEvents(selected);
  const defaultDue = (() => {
    const d = new Date(selected);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  })();

  return (
    <div className="page">
      <TopBar
        title={formatDate(month, { month: 'long', year: 'numeric' })}
        subtitle="Events, tasks with due dates and diary entries"
        actions={
          <>
            <button className="btn text" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1).getTime()); setSelected(startOfDay(Date.now())); }}>Today</button>
            <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
            <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>›</button>
          </>
        }
      />
      <div className="calendar-layout">
        <div className="card calendar">
          <div className="cal-head">
            {weekdays.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="cal-grid">
            {cells.map((d) => {
              const inMonth = new Date(d).getMonth() === new Date(month).getMonth();
              const t = dayTasks(d);
              const e = dayDiary(d);
              const ev = dayEvents(d);
              return (
                <button key={d} className={`cal-cell ${inMonth ? '' : 'out'} ${isSameDay(d, Date.now()) ? 'today' : ''} ${isSameDay(d, selected) ? 'sel' : ''}`} onClick={() => setSelected(d)} aria-label={formatDate(d)}>
                  <span className="num">{new Date(d).getDate()}</span>
                  {ev.slice(0, 2).map((o) => (
                    <span key={o.event.id + o.start} className="cal-ev">{o.event.title || 'Event'}</span>
                  ))}
                  {ev.length > 2 && <span className="cal-ev more">+{ev.length - 2}</span>}
                  <span className="dots">
                    {t.slice(0, 3).map((x) => (
                      <i key={x.id} className={`dot prio-${x.priority} ${x.isCompleted ? 'done' : ''}`} />
                    ))}
                    {e.length > 0 && <i className="dot diary" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="agenda">
          <div className="agenda-head">
            <h2>{formatDate(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            <div className="row">
              <button className="btn" onClick={() => setEditing(newEvent(selected))}>New event</button>
              <IconButton icon="add" label="Add task on this day" onClick={() => setAdding(true)} />
            </div>
          </div>
          {selTasks.length === 0 && selDiary.length === 0 && selEvents.length === 0 ? (
            <Empty text="Nothing on this day." />
          ) : (
            <div className="list">
              {selEvents.map((o) => (
                <EventRow key={o.event.id + o.start} o={o} onClick={() => setEditing(o.event)} />
              ))}
              {selTasks.map((t) => (
                <TaskRow key={t.id} task={t} compact />
              ))}
              {selDiary.map((e) => (
                <button key={e.id} className="diary-row small" onClick={() => navigate(`/diary/${e.id}`)}>
                  <MoodIcon mood={e.mood} />
                  <div className="diary-text">
                    <h3>{e.title || 'Diary entry'}</h3>
                  </div>
                </button>
              ))}
            </div>
          )}
          {notificationsSupported() && perm === 'default' && (
            <button className="btn text" onClick={() => Notification.requestPermission().then(setPerm)}>Turn on event reminders</button>
          )}
          {perm === 'denied' && notificationsSupported() && <p className="muted small">Notifications are blocked for this site in your browser settings.</p>}
          <p className="muted small">Events sync with the "Penguin Brain" calendar in the Android app. Reminders show while this site is open in a tab or installed as an app. Other phone calendars (Google etc.) stay on the phone.</p>
        </div>
      </div>
      {editing && <EventModal event={editing} onClose={() => setEditing(null)} />}
      {adding && <AddTaskModal open={adding} onClose={() => setAdding(false)} initialDue={defaultDue} />}
    </div>
  );
}

const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toUtcDateInput = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).getTime() : 0);
const fromDateInput = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : 0;
};
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function newEvent(day: number): CalEvent {
  const d = new Date(day);
  const n = new Date();
  const hour = isSameDay(day, Date.now()) ? Math.min(n.getHours() + 1, 23) : 9;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime();
  return { title: '', description: '', location: '', start, end: start + 3600000, allDay: false, rrule: '', reminders: [10], updatedDate: 0, id: '' };
}

function EventRow({ o, onClick }: { o: Occurrence; onClick: () => void }) {
  const e = o.event;
  return (
    <button className="event-row" onClick={onClick}>
      <span className="event-bar" />
      <div>
        <h3>{e.title || 'Event'}</h3>
        <p className="muted small">
          {e.allDay ? 'All day' : `${time(o.start)} – ${time(o.end)}`}
          {e.location ? ` · ${e.location}` : ''}
          {e.rrule ? ' · repeats' : ''}
          {e.reminders.length ? ' · reminder' : ''}
        </p>
      </div>
    </button>
  );
}

const REPEATS = [
  { v: '', label: 'Does not repeat' },
  { v: 'FREQ=DAILY', label: 'Every day' },
  { v: 'FREQ=WEEKLY', label: 'Every week' },
  { v: 'FREQ=MONTHLY', label: 'Every month' },
  { v: 'FREQ=YEARLY', label: 'Every year' },
];
const REMINDERS = [
  { v: -1, label: 'No reminder' },
  { v: 0, label: 'At start time' },
  { v: 5, label: '5 minutes before' },
  { v: 10, label: '10 minutes before' },
  { v: 30, label: '30 minutes before' },
  { v: 60, label: '1 hour before' },
  { v: 1440, label: '1 day before' },
];

function EventModal({ event, onClose }: { event: CalEvent; onClose: () => void }) {
  const isNew = !event.id;
  const [title, setTitle] = useState(event.title);
  const [allDay, setAllDay] = useState(event.allDay);
  const [start, setStart] = useState(event.allDay ? toUtcDateInput(event.start) : toLocalInput(event.start));
  const [end, setEnd] = useState(event.allDay ? toUtcDateInput(Math.max(event.start, event.end - DAY)) : toLocalInput(event.end));
  const [location, setLocation] = useState(event.location);
  const [description, setDescription] = useState(event.description);
  const [rrule, setRrule] = useState(event.rrule);
  const [reminder, setReminder] = useState(event.reminders.length ? event.reminders[0] : -1);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const custom = rrule && !REPEATS.some((r) => r.v === rrule);

  const toggleAllDay = (v: boolean) => {
    // keep the same calendar day when switching
    if (v) {
      const s = new Date(fromLocalInput(start) || Date.now());
      const e = new Date(fromLocalInput(end) || s.getTime());
      setStart(`${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`);
      setEnd(`${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`);
    } else {
      setStart(`${start.slice(0, 10)}T09:00`);
      setEnd(`${end.slice(0, 10)}T10:00`);
    }
    setAllDay(v);
  };

  const save = () => {
    const s = allDay ? fromDateInput(start) : fromLocalInput(start);
    let e = allDay ? fromDateInput(end) + DAY : fromLocalInput(end);
    if (!s) return setError('Choose a start date');
    if (!e || e <= s) e = allDay ? s + DAY : s + 3600000;
    const extra = reminder >= 0 ? [reminder] : [];
    const reminders = reminder === (event.reminders[0] ?? -1) ? event.reminders : extra;
    actions.upsertEvent({ ...event, title: title.trim(), description, location: location.trim(), start: s, end: e, allDay, rrule, reminders, updatedDate: now(), id: event.id || uuid() });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New event' : 'Edit event'}
      footer={
        <>
          {!isNew && <button className="btn text danger" onClick={() => setConfirm(true)}>Delete</button>}
          <span style={{ flex: 1 }} />
          <button className="btn text" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save}>Save</button>
        </>
      }
    >
      <div className="form">
        <input className="input" autoFocus placeholder="Title" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="field row">
          <span className="field-label">All day</span>
          <Switch label="All day" checked={allDay} onChange={toggleAllDay} />
        </div>
        <label className="field">
          <span className="field-label">Starts</span>
          <input className="input" type={allDay ? 'date' : 'datetime-local'} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Ends</span>
          <input className="input" type={allDay ? 'date' : 'datetime-local'} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Repeat</span>
          <select className="input" value={rrule} onChange={(e) => setRrule(e.target.value)}>
            {custom && <option value={rrule}>{describeRule(rrule)}</option>}
            {REPEATS.map((r) => (
              <option key={r.v} value={r.v}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Reminder</span>
          <select className="input" value={reminder} onChange={(e) => setReminder(Number(e.target.value))}>
            {!REMINDERS.some((r) => r.v === reminder) && <option value={reminder}>{reminder} minutes before</option>}
            {REMINDERS.map((r) => (
              <option key={r.v} value={r.v}>{r.label}</option>
            ))}
          </select>
        </label>
        <input className="input" placeholder="Location" aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        <textarea className="input" rows={3} placeholder="Description" aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        {error && <p className="error small">{error}</p>}
        {!isNew && event.rrule && <p className="muted small">Changes apply to every repeat of this event.</p>}
      </div>
      <Confirm
        open={confirm}
        title="Delete event?"
        message={event.rrule ? 'All repeats of this event will be deleted on every device.' : 'It will be deleted on every device.'}
        confirmLabel="Delete"
        onConfirm={() => {
          actions.deleteEvent(event.id);
          onClose();
        }}
        onClose={() => setConfirm(false)}
      />
    </Modal>
  );
}

function describeRule(rrule: string) {
  const r = parseRule(rrule);
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year', '': 'time' }[r.freq];
  return r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
}
