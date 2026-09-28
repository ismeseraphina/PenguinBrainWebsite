import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Empty, IconButton, TopBar, navigate } from '../ui';
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

  const cells = useMemo(() => {
    const m = new Date(month);
    const offset = (m.getDay() - firstDay + 7) % 7;
    const start = new Date(m.getFullYear(), m.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime());
  }, [month, firstDay]);

  const dayTasks = (d: number) => tasks.filter((t) => t.dueDate && isSameDay(t.dueDate, d));
  const dayDiary = (d: number) => diary.filter((e) => isSameDay(e.createdDate, d));
  const shift = (n: number) => {
    const d = new Date(month);
    setMonth(new Date(d.getFullYear(), d.getMonth() + n, 1).getTime());
  };
  const weekdays = [...WEEKDAYS.slice(firstDay), ...WEEKDAYS.slice(0, firstDay)];
  const selTasks = dayTasks(selected).sort((a, b) => a.dueDate - b.dueDate);
  const selDiary = dayDiary(selected);
  const defaultDue = (() => {
    const d = new Date(selected);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  })();

  return (
    <div className="page">
      <TopBar
        title={formatDate(month, { month: 'long', year: 'numeric' })}
        subtitle="Tasks with due dates and diary entries"
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
              return (
                <button key={d} className={`cal-cell ${inMonth ? '' : 'out'} ${isSameDay(d, Date.now()) ? 'today' : ''} ${isSameDay(d, selected) ? 'sel' : ''}`} onClick={() => setSelected(d)} aria-label={formatDate(d)}>
                  <span className="num">{new Date(d).getDate()}</span>
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
            <IconButton icon="add" label="Add task on this day" onClick={() => setAdding(true)} />
          </div>
          {selTasks.length === 0 && selDiary.length === 0 ? (
            <Empty text="Nothing on this day." />
          ) : (
            <div className="list">
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
          <p className="muted small">Phone calendar events stay on your phone. The Android app reads them from the device calendar, so they are not part of sync.</p>
        </div>
      </div>
      {adding && <AddTaskModal open={adding} onClose={() => setAdding(false)} initialDue={defaultDue} />}
    </div>
  );
}
