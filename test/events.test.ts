import { onDay, occurrences } from '../src/events';
import { normEvent } from '../src/sync';
const base = { title: 'Lecture', description: '', location: '', allDay: false, rrule: '', reminders: [10], updatedDate: 1, id: 'e1' };
const fail = (m: string) => { console.log('FAIL', m); process.exit(1); };
// 2026-10-05 09:00 HKT == 01:00 UTC
const start = Date.UTC(2026, 9, 5, 1, 0);
const e = { ...base, start, end: start + 3600000 };
if (new Date(start).getHours() !== 9) fail('HK 9am shows as ' + new Date(start).getHours());
if (onDay([e], new Date(2026, 9, 5).getTime()).length !== 1) fail('timed on day');
if (onDay([e], new Date(2026, 9, 4).getTime()).length !== 0) fail('timed prev day');
// all-day Oct 6 (UTC midnight like Android)
const ad = { ...base, id: 'e2', allDay: true, start: Date.UTC(2026, 9, 6), end: Date.UTC(2026, 9, 7) };
if (onDay([ad], new Date(2026, 9, 6).getTime()).length !== 1 || onDay([ad], new Date(2026, 9, 5).getTime()).length !== 0 || onDay([ad], new Date(2026, 9, 7).getTime()).length !== 0) fail('all-day');
// weekly Mon+Wed, 4 times
const w = { ...e, id: 'e3', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4' };
const occ = occurrences(w, start - 1, start + 30 * 86400000);
if (occ.length !== 4 || new Date(occ[1].start).getDay() !== 3 || new Date(occ[3].start).getHours() !== 9) fail('weekly ' + occ.length);
if (occurrences({ ...e, rrule: 'FREQ=DAILY;INTERVAL=2' }, start, start + 7 * 86400000).length !== 4) fail('daily');
const n = normEvent({ id: 'x', start: 5, end: 2, reminders: [10, '5'] } as never);
if (n.end !== 5 || n.reminders.join() !== '10,5' || n.rrule !== '') fail('norm');
console.log('EVENTS PASSED');
