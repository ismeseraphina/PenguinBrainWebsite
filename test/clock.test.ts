const mem: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => (mem[k] = v) };
const { actions } = await import('../src/store');
const { buildCards, timerActions, remainingOf } = await import('../src/clock');
const fail = (m: string) => { console.log('FAIL', m); process.exit(1); };
const at = new Date(2026, 9, 5, 12, 40).getTime(); // Monday 12:40 local
actions.upsertTask(actions.newTask({ title: 'CB2100 revision', dueDate: at + 2 * 3600e3 }));
actions.upsertTask(actions.newTask({ title: 'far away', dueDate: at + 48 * 3600e3 }));
actions.upsertEvent({ title: 'CS tutorial', description: '', location: '', start: at - 10 * 60e3, end: at + 40 * 60e3, allDay: false, rrule: '', reminders: [], updatedDate: 1, id: 'ev1' });
actions.upsertEvent({ title: 'Lab', description: '', location: '', start: at + 3 * 3600e3, end: at + 4 * 3600e3, allDay: false, rrule: '', reminders: [], updatedDate: 1, id: 'ev2' });
const cards = buildCards(at);
const kinds = cards.map((c) => c.kind + ':' + c.title).join(',');
if (kinds !== 'event-live:CS tutorial,routine:Lunch,task:CB2100 revision,event-next:Lab') fail(kinds);
if (cards[0].minutes !== 40 || cards[2].minutes !== 50) fail('minutes ' + cards[0].minutes + ' ' + cards[2].minutes);
timerActions.start('x', 25);
timerActions.pause();
const t = JSON.parse(mem['pb-timer']);
if (t.startedAt !== 0 || remainingOf(t) > 25 * 60e3) fail('pause');
console.log('CLOCK PASSED');
