// Penguin Brain cloud sync (web side).
// Mirrors settings/data/.../sync/CloudSyncRepositoryImpl.kt in the Android app:
// one JSON file (penguinbrain-sync.json) in the user's private GitHub repo,
// per-item last-writer-wins on updatedDate, tombstones for deletions.

import type { AppData, AppState, Bookmark, CalEvent, EventCategory, DiaryEntry, Mood, Note, NoteFolder, SubTask, SyncFile, Task, Tombstone } from './types';
import { getState, setState } from './store';
import { uuid } from './util';

export const SYNC_FILE_PATH = 'penguinbrain-sync.json';
const FORMAT = 'penguinbrain-sync';
const TOMBSTONE_TTL = 180 * 24 * 60 * 60 * 1000;
const TYPES = ['notes', 'noteFolders', 'tasks', 'diary', 'bookmarks', 'events', 'categories'] as const;
type TypeKey = (typeof TYPES)[number];

export class SyncError extends Error {}
class ConflictError extends Error {}

// ---------------- normalization (same field set/order as the Kotlin entities) ----------------
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d);
const moods: Mood[] = ['AWESOME', 'GOOD', 'OKAY', 'BAD', 'TERRIBLE'];
const idOf = (v: unknown) => {
  const s = str(v);
  // very old MyBrain backups used integer ids
  return !s || /^\d+$/.test(s) ? '' : s;
};

type Raw = Record<string, unknown>;
export function normNote(r: Raw): Note {
  const folder = r.folderId == null || r.folderId === 'null' || r.folderId === '' ? null : str(r.folderId);
  return {
    title: str(r.title),
    content: str(r.content),
    createdDate: num(r.createdDate),
    updatedDate: num(r.updatedDate),
    pinned: bool(r.pinned),
    folderId: folder,
    id: str(r.id),
  };
}
export function normFolder(r: Raw): NoteFolder {
  return { name: str(r.name), id: str(r.id) };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normSub(r: Raw): SubTask {
  return { title: str(r.title ?? r.a), isCompleted: bool(r.isCompleted ?? r.b), id: UUID_RE.test(str(r.id ?? r.c)) ? str(r.id ?? r.c) : uuid() };
}
export function normTask(r: Raw): Task {
  return {
    title: str(r.title),
    description: str(r.description),
    isCompleted: bool(r.isCompleted),
    priority: num(r.priority),
    createdDate: num(r.createdDate),
    updatedDate: num(r.updatedDate),
    subTasks: Array.isArray(r.subTasks) ? (r.subTasks as Raw[]).map(normSub) : [],
    dueDate: num(r.dueDate),
    recurring: bool(r.recurring),
    frequency: num(r.frequency, 2),
    frequencyAmount: num(r.frequencyAmount, 1),
    alarmId: null,
    id: str(r.id),
  };
}
export function normEntry(r: Raw): DiaryEntry {
  const m = str(r.mood) as Mood;
  const mood: Mood = moods.includes(m) ? m : typeof r.mood === 'number' ? moods[r.mood] ?? 'OKAY' : 'OKAY';
  return {
    title: str(r.title),
    content: str(r.content),
    createdDate: num(r.createdDate),
    updatedDate: num(r.updatedDate),
    mood,
    id: str(r.id),
  };
}
export function normBookmark(r: Raw): Bookmark {
  return {
    url: str(r.url),
    title: str(r.title),
    description: str(r.description),
    createdDate: num(r.createdDate),
    updatedDate: num(r.updatedDate),
    id: str(r.id),
  };
}

const hex = (v: unknown) => {
  const s = str(v).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : '';
};
export function normCategory(r: Raw): EventCategory {
  return { name: str(r.name), color: hex(r.color) || '#d6336c', updatedDate: num(r.updatedDate), id: str(r.id) };
}
export function normEvent(r: Raw): CalEvent {
  const start = num(r.start);
  return {
    title: str(r.title),
    description: str(r.description),
    location: str(r.location),
    start,
    end: Math.max(num(r.end, start), start),
    allDay: bool(r.allDay),
    rrule: str(r.rrule),
    reminders: Array.isArray(r.reminders) ? (r.reminders as unknown[]).map((x) => num(x)).filter((x) => x >= 0) : [],
    category: str(r.category),
    color: hex(r.color),
    updatedDate: num(r.updatedDate),
    id: str(r.id),
  };
}

export function parseData(raw: Raw): AppData & { deleted: Tombstone[] } {
  const list = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as Raw[]) : []);
  // map legacy integer folder ids like the app's importer does
  const folderMap = new Map<string, string>();
  const noteFolders = list('noteFolders').map((f) => {
    const n = normFolder(f);
    if (!idOf(n.id)) {
      const nid = uuid();
      folderMap.set(n.id, nid);
      n.id = nid;
    }
    return n;
  });
  const fix = <T extends { id: string }>(x: T) => (idOf(x.id) ? x : { ...x, id: uuid() });
  return {
    notes: list('notes').map(normNote).map((n) => fix({ ...n, folderId: n.folderId && folderMap.has(n.folderId) ? folderMap.get(n.folderId)! : n.folderId })),
    noteFolders,
    tasks: list('tasks').map(normTask).map(fix),
    diary: list('diary').map(normEntry).map(fix),
    bookmarks: list('bookmarks').map(normBookmark).map(fix),
    events: list('events').map(normEvent).filter((e) => e.id && e.start > 0),
    categories: list('categories').map(normCategory).filter((c) => c.id),
    deleted: list('deleted').map((t) => ({ type: str(t.type), id: str(t.id), at: num(t.at) })),
  };
}

const canon = (x: unknown) => JSON.stringify(x);
const NORM: Record<string, (r: Raw) => unknown> = {
  notes: normNote as (r: Raw) => unknown,
  noteFolders: normFolder as (r: Raw) => unknown,
  tasks: normTask as (r: Raw) => unknown,
  diary: normEntry as (r: Raw) => unknown,
  bookmarks: normBookmark as (r: Raw) => unknown,
  events: normEvent as (r: Raw) => unknown,
  categories: normCategory as (r: Raw) => unknown,
};
const cn = (k: string, x: unknown) => canon(NORM[k](x as Raw));

// ---------------- base64 utf-8 ----------------
function b64encode(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64: string) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------- GitHub API ----------------
async function gh(token: string, method: string, url: string, body?: unknown) {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError('Network error, check your connection');
  }
  let data: Raw = {};
  try {
    data = (await res.json()) as Raw;
  } catch {
    /* empty body */
  }
  return { status: res.status, data };
}

const enc = encodeURIComponent;
/** owner can be a Penguin Brain server URL (account sync) instead of a GitHub user */
export const isServer = (o: string) => /^https?:\/\//i.test(o);
const apiBase = (o: string) => (isServer(o) ? o.replace(/\/+$/, '') : 'https://api.github.com');
const repoUrl = (o: string, r: string) => `${apiBase(o)}/repos/${isServer(o) ? 'me' : enc(o)}/${enc(r)}`;

export async function verifyAccount(token: string, owner: string, repo: string) {
  const u = await gh(token, 'GET', `${apiBase(owner)}/user`);
  if (u.status === 401) throw new SyncError(isServer(owner) ? 'Signed out, please sign in again' : 'Invalid GitHub token');
  if (u.status >= 300) throw new SyncError(`GitHub error ${u.status}`);
  const r = await gh(token, 'GET', repoUrl(owner, repo));
  if (r.status === 404 || r.status === 403) throw new SyncError(`Repository ${owner}/${repo} not found, or the token has no access to it`);
  if (r.status >= 300) throw new SyncError(`GitHub error ${r.status}`);
  return { login: str(u.data.login), isPrivate: bool(r.data.private, true) };
}

async function getRemote(token: string, owner: string, repo: string): Promise<{ file: Raw; sha: string } | null> {
  const r = await gh(token, 'GET', `${repoUrl(owner, repo)}/contents/${SYNC_FILE_PATH}`);
  if (r.status === 404) return null;
  if (r.status === 401) throw new SyncError('Invalid GitHub token');
  if (r.status >= 300) throw new SyncError(`Could not read sync file (GitHub error ${r.status})`);
  const sha = str(r.data.sha);
  let content = str(r.data.content);
  if (!content && num(r.data.size) > 0) {
    const b = await gh(token, 'GET', `${repoUrl(owner, repo)}/git/blobs/${sha}`);
    if (b.status >= 300) throw new SyncError(`Could not read sync file (GitHub error ${b.status})`);
    content = str(b.data.content);
  }
  try {
    return { file: JSON.parse(b64decode(content)) as Raw, sha };
  } catch {
    throw new SyncError('Sync file in the repository is not valid JSON');
  }
}

async function putRemote(token: string, owner: string, repo: string, file: SyncFile, sha: string | null) {
  const r = await gh(token, 'PUT', `${repoUrl(owner, repo)}/contents/${SYNC_FILE_PATH}`, {
    message: 'Penguin Brain sync from web',
    content: b64encode(JSON.stringify(file)),
    ...(sha ? { sha } : {}),
  });
  if (r.status === 409 || r.status === 422) throw new ConflictError();
  if (r.status === 401) throw new SyncError('Invalid GitHub token');
  if (r.status === 403 || r.status === 404) throw new SyncError(`Token has no write access to ${owner}/${repo} (needs Contents: Read and write)`);
  if (r.status >= 300) throw new SyncError(`Could not upload sync file (GitHub error ${r.status})`);
}

// ---------------- merge ----------------
function merge<T extends { id: string }>(
  type: string,
  local: T[],
  remote: T[],
  updated: (x: T) => number | null,
  base: Set<string>,
  tombs: Map<string, number>,
  t: number,
): T[] {
  const localIds = new Set(local.map((x) => x.id));
  base.forEach((id) => {
    if (!localIds.has(id)) {
      const k = `${type}::${id}`;
      tombs.set(k, Math.max(tombs.get(k) ?? 0, t));
    }
  });
  const map = new Map<string, T>();
  remote.forEach((x) => map.set(x.id, x));
  local.forEach((x) => {
    const ex = map.get(x.id);
    const lu = updated(x);
    if (!ex || lu == null || lu > (updated(ex) ?? 0)) map.set(x.id, x);
  });
  for (const [id, item] of [...map.entries()]) {
    const k = `${type}::${id}`;
    const at = tombs.get(k);
    if (at == null) continue;
    const u = updated(item);
    if (u != null && u > at) tombs.delete(k);
    else map.delete(id);
  }
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  uploaded: boolean;
}

let running: Promise<SyncResult> | null = null;
export const isSyncing = () => running != null;

export function syncNow(): Promise<SyncResult> {
  if (running) return running;
  running = (async () => {
    try {
      let attempt = 0;
      for (;;) {
        try {
          const r = await syncOnce();
          setState((s) => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, lastSync: Date.now(), lastError: '' } } }), false);
          return r;
        } catch (e) {
          if (e instanceof ConflictError && ++attempt < 3) continue;
          throw e;
        }
      }
    } catch (e) {
      const msg = e instanceof ConflictError ? 'Sync conflict, please try again' : e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, lastError: msg } } }), false);
      throw new SyncError(msg);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce(): Promise<SyncResult> {
  const snapshot = getState();
  const { token, owner, repo } = snapshot.settings.sync;
  if (!token || !owner || !repo) throw new SyncError('Not signed in');
  const account = `${owner}/${repo}`;
  const t = Date.now();

  const remoteRes = await getRemote(token, owner, repo);
  const remote = remoteRes ? parseData(remoteRes.file) : parseData({});
  const baseState = snapshot.syncBase.account === account ? snapshot.syncBase : { account, ids: {} };
  const base = (k: TypeKey) => new Set(baseState.ids[k] ?? []);

  const tombs = new Map<string, number>();
  remote.deleted.forEach((d) => {
    const k = `${d.type}::${d.id}`;
    tombs.set(k, Math.max(tombs.get(k) ?? 0, d.at));
  });

  const merged: AppData = {
    noteFolders: merge('noteFolders', snapshot.noteFolders, remote.noteFolders, () => null, base('noteFolders'), tombs, t),
    notes: merge('notes', snapshot.notes, remote.notes, (x) => x.updatedDate, base('notes'), tombs, t),
    tasks: merge('tasks', snapshot.tasks.map((x) => ({ ...x, alarmId: null })), remote.tasks, (x) => x.updatedDate, base('tasks'), tombs, t),
    diary: merge('diary', snapshot.diary, remote.diary, (x) => x.updatedDate, base('diary'), tombs, t),
    bookmarks: merge('bookmarks', snapshot.bookmarks, remote.bookmarks, (x) => x.updatedDate, base('bookmarks'), tombs, t),
    events: merge('events', snapshot.events ?? [], remote.events, (x) => x.updatedDate, base('events'), tombs, t),
    categories: merge('categories', snapshot.categories ?? [], remote.categories, (x) => x.updatedDate, base('categories'), tombs, t),
  };

  const deleted: Tombstone[] = [...tombs.entries()]
    .filter(([, at]) => t - at < TOMBSTONE_TTL)
    .map(([k, at]) => {
      const i = k.indexOf('::');
      return { type: k.slice(0, i), id: k.slice(i + 2), at };
    })
    .sort((a, b) => (a.type + a.id < b.type + b.id ? -1 : 1));

  const file: SyncFile = {
    format: FORMAT,
    version: 1,
    updatedAt: t,
    updatedBy: 'web',
    notes: merged.notes.map((x) => normNote(x as unknown as Raw)),
    noteFolders: merged.noteFolders.map((x) => normFolder(x as unknown as Raw)),
    tasks: merged.tasks.map((x) => normTask(x as unknown as Raw)),
    diary: merged.diary.map((x) => normEntry(x as unknown as Raw)),
    bookmarks: merged.bookmarks.map((x) => normBookmark(x as unknown as Raw)),
    events: merged.events.map((x) => normEvent(x as unknown as Raw)),
    categories: merged.categories.map((x) => normCategory(x as unknown as Raw)),
    deleted,
  };

  // count + decide upload
  let pushed = 0;
  let pulled = 0;
  for (const k of TYPES) {
    const r = new Map((remote[k] as { id: string }[]).map((x) => [x.id, cn(k, x)]));
    const l = new Map((snapshot[k] as { id: string }[]).map((x) => [x.id, cn(k, x)]));
    const m = merged[k] as { id: string }[];
    const mIds = new Set(m.map((x) => x.id));
    m.forEach((x) => {
      const c = cn(k, x);
      if (r.get(x.id) !== c) pushed++;
      if (l.get(x.id) !== c) pulled++;
    });
    r.forEach((_, id) => !mIds.has(id) && pushed++);
    l.forEach((_, id) => !mIds.has(id) && pulled++);
  }
  const remoteDeleted = canon([...remote.deleted].sort((a, b) => (a.type + a.id < b.type + b.id ? -1 : 1)));
  const needsUpload = !remoteRes || pushed > 0 || remoteDeleted !== canon(deleted);
  if (needsUpload) await putRemote(token, owner, repo, file, remoteRes?.sha ?? null);

  // apply locally, keeping anything the user edited while the sync was running
  setState((cur: AppState) => {
    const next: AppState = { ...cur };
    for (const k of TYPES) {
      const snapMap = new Map((snapshot[k] as { id: string }[]).map((x) => [x.id, x]));
      const curList = cur[k] as { id: string }[];
      const curMap = new Map(curList.map((x) => [x.id, x]));
      const out = new Map((merged[k] as { id: string }[]).map((x) => [x.id, x]));
      curList.forEach((x) => {
        if (snapMap.get(x.id) !== x) out.set(x.id, x); // new or edited during sync
      });
      snapMap.forEach((_, id) => {
        if (!curMap.has(id)) out.delete(id); // deleted during sync
      });
      (next as unknown as Record<string, unknown>)[k] = [...out.values()];
    }
    next.syncBase = {
      account,
      ids: Object.fromEntries(TYPES.map((k) => [k, (merged[k] as { id: string }[]).map((x) => x.id)])),
    };
    return next;
  }, false);

  return { pulled, pushed: needsUpload ? pushed : 0, uploaded: needsUpload };
}

export function exportBackup(s: AppState): string {
  const file: SyncFile = {
    format: FORMAT,
    version: 1,
    updatedAt: Date.now(),
    updatedBy: 'web-export',
    notes: s.notes,
    noteFolders: s.noteFolders,
    tasks: s.tasks.map((x) => ({ ...x, alarmId: null })),
    diary: s.diary,
    bookmarks: s.bookmarks,
    events: s.events,
    categories: s.categories,
    deleted: [],
  };
  return JSON.stringify(file);
}
