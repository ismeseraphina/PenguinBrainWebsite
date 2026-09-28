// Node test of the web sync engine against an in-memory fake GitHub Contents API.
import { actions, getState, setState } from '../src/store';
import { syncNow } from '../src/sync';

let remote: { content: string; sha: string } | null = null;
let shaN = 0;
(globalThis as any).fetch = async (url: string, init: any) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ status, json: async () => body });
  if (u.endsWith('/user')) return json(200, { login: 'ismeseraphina' });
  if (u.includes('/contents/')) {
    if (init.method === 'GET') return remote ? json(200, { sha: remote.sha, content: remote.content, size: 10 }) : json(404, {});
    const body = JSON.parse(init.body);
    if ((remote?.sha ?? null) !== (body.sha ?? null)) return json(409, {});
    remote = { content: body.content, sha: `s${++shaN}` };
    return json(201, {});
  }
  return json(200, { private: true });
};
const dec = () => JSON.parse(Buffer.from(remote!.content, 'base64').toString('utf8'));
const enc = (o: any) => { remote = { content: Buffer.from(JSON.stringify(o)).toString('base64'), sha: `s${++shaN}` }; };
const assert = (c: any, m: string) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };

actions.updateSync({ token: 't', owner: 'o', repo: 'r', login: 'x' });
// 1. local data uploaded on first sync (unicode too)
const t1 = actions.newTask({ title: '交功課 🐧', dueDate: Date.now() + 3600e3 });
actions.upsertTask(t1);
const n1 = actions.newNote(); actions.upsertNote({ ...n1, title: 'Hi', content: '| a | b |\n|---|---|\n| 1 | 2 |' });
let r = await syncNow();
assert(r.uploaded && dec().tasks.length === 1 && dec().tasks[0].title === '交功課 🐧', 'first upload');
assert(dec().format === 'penguinbrain-sync' && dec().tasks[0].alarmId === null, 'format');

// 2. "app" adds a diary entry + edits task (newer) -> pulled
const f = dec();
f.diary.push({ title: 'from app', content: 'x', createdDate: 1, updatedDate: Date.now(), mood: 'GOOD', id: 'd-app' });
f.tasks[0] = { ...f.tasks[0], title: 'edited on phone', updatedDate: Date.now() + 5, alarmId: 7 };
f.updatedBy = 'android'; enc(f);
r = await syncNow();
assert(getState().diary.some((d) => d.id === 'd-app'), 'pulled diary');
assert(getState().tasks[0].title === 'edited on phone', 'newer remote edit wins');

// 3. delete locally -> tombstone uploaded, removed remotely
actions.deleteEntry('d-app');
r = await syncNow();
assert(!dec().diary.some((d: any) => d.id === 'd-app') && dec().deleted.some((x: any) => x.id === 'd-app' && x.type === 'diary'), 'local delete -> tombstone');

// 4. remote deletes note via tombstone -> removed locally
const f2 = dec();
f2.notes = []; f2.deleted.push({ type: 'notes', id: n1.id, at: Date.now() + 10 }); enc(f2);
await syncNow();
assert(!getState().notes.some((n) => n.id === n1.id), 'remote tombstone deletes local note');

// 5. no change -> no upload
const before = remote!.sha;
r = await syncNow();
assert(!r.uploaded && remote!.sha === before, 'idempotent');

// 6. conflict retry
let first = true;
const orig = (globalThis as any).fetch;
(globalThis as any).fetch = async (url: string, init: any) => {
  if (init.method === 'PUT' && first) { first = false; const f3 = dec(); f3.bookmarks.push({ url: 'https://a.com', title: 'A', description: '', createdDate: 1, updatedDate: 2, id: 'b1' }); enc(f3); }
  return orig(url, init);
};
actions.upsertTask(actions.newTask({ title: 'second' }));
r = await syncNow();
assert(dec().tasks.length === 2 && dec().bookmarks.length === 1 && getState().bookmarks.length === 1, 'conflict retried and merged');

// 7. old-format backup data from Kotlin (missing defaults, legacy subtask keys)
const f4 = dec();
f4.tasks.push({ title: 'legacy', id: 'legacy1', subTasks: [{ a: 'sub', b: true, c: '0f8fad5b-d9cb-469f-a165-70867728950e' }] });
enc(f4);
await syncNow();
const lg = getState().tasks.find((t) => t.id === 'legacy1')!;
assert(lg && lg.subTasks[0].title === 'sub' && lg.subTasks[0].isCompleted && lg.frequency === 2, 'legacy fields normalized');
actions.upsertTask({ ...lg, title: 'legacy edited', updatedDate: Date.now() + 100, subTasks: [...lg.subTasks, { title: '中文 sub', isCompleted: false, id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' }] });
const n2 = actions.newNote(); actions.upsertNote({ ...n2, title: '筆記', content: '# hi', pinned: true });
actions.upsertEntry({ title: 'web diary', content: 'x', createdDate: Date.now(), updatedDate: Date.now(), mood: 'AWESOME', id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' });
r = await syncNow();
assert(r.uploaded && dec().tasks.find((t: any) => t.id === 'legacy1').subTasks.length === 2, 'normalized upload');
(await import('node:fs')).writeFileSync('test/web-sync-sample.json', JSON.stringify(dec(), null, 1));
console.log('ALL PASSED');
