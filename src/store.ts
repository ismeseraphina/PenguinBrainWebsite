import { useSyncExternalStore } from 'react';
import type { AppState, Bookmark, CalEvent, EventCategory, DiaryEntry, Note, NoteFolder, Settings, Task } from './types';
import { now, uuid } from './util';

const DB_NAME = 'penguinbrain';
const STORE = 'kv';
const KEY = 'state';

export const defaultSettings: Settings = {
  theme: 'auto',
  firstDayOfWeek: 0,
  showCompletedTasks: true,
  taskOrder: 'priority',
  noteView: 'grid',
  clock: {
    focusLeadMin: 180,
    focusMinutes: 50,
    notify: true,
    routines: [
      { id: 'r-lunch', name: 'Lunch', time: '12:30', minutes: 50, days: [1, 2, 3, 4, 5, 6, 0], enabled: true },
      { id: 'r-eyes', name: 'Eye break & walk', time: '16:00', minutes: 10, days: [1, 2, 3, 4, 5], enabled: true },
      { id: 'r-dinner', name: 'Dinner', time: '19:00', minutes: 50, days: [1, 2, 3, 4, 5, 6, 0], enabled: true },
      { id: 'r-shutdown', name: 'Evening shutdown', time: '22:30', minutes: 10, days: [1, 2, 3, 4, 5, 6, 0], enabled: true },
    ],
  },
  ai: { provider: 'none', keys: {}, models: {}, urls: {}, tools: true },
  sync: { token: '', owner: '', repo: 'PenguinBrainData', login: '', auto: true, lastSync: 0, lastError: '' },
};

const emptyState: AppState = {
  notes: [],
  noteFolders: [],
  tasks: [],
  diary: [],
  bookmarks: [],
  events: [],
  // fixed ids so every device seeds the same defaults without duplicates
  categories: [
    { name: 'Class', color: '#6f4cad', updatedDate: 1, id: 'cat-class' },
    { name: 'Study', color: '#2965c9', updatedDate: 1, id: 'cat-study' },
    { name: 'Work', color: '#e78a00', updatedDate: 1, id: 'cat-work' },
    { name: 'Personal', color: '#1e9651', updatedDate: 1, id: 'cat-personal' },
    { name: 'Social', color: '#d6336c', updatedDate: 1, id: 'cat-social' },
  ],
  settings: defaultSettings,
  syncBase: { account: '', ids: {} },
};

let state: AppState = emptyState;
let loaded = false;
let persistent = true;
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

// ---------- IndexedDB (falls back to memory if blocked, e.g. in sandboxed previews) ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}
let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= openDb());

async function readPersisted(): Promise<AppState | null> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve((r.result as AppState) ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    persistent = false;
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (!persistent) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const d = await db();
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, KEY);
    } catch {
      persistent = false;
    }
  }, 150);
}

export async function loadState() {
  const saved = await readPersisted();
  if (saved) {
    state = {
      ...emptyState,
      ...saved,
      settings: { ...defaultSettings, ...saved.settings, sync: { ...defaultSettings.sync, ...(saved.settings?.sync ?? {}) } },
      syncBase: saved.syncBase ?? emptyState.syncBase,
    };
  }
  loaded = true;
  emit();
}
export const isPersistent = () => persistent;
export const isLoaded = () => loaded;

function emit() {
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

/** Replace state. `dataChanged` = user edited data (triggers auto sync). */
export function setState(updater: (s: AppState) => AppState, dataChanged = true) {
  state = updater(state);
  schedulePersist();
  emit();
  if (dataChanged) changeListeners.forEach((l) => l());
}

export function onDataChange(cb: () => void) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

// ---------- actions ----------
function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

export const actions = {
  // tasks
  upsertTask(task: Task) {
    setState((s) => ({ ...s, tasks: upsert(s.tasks, task) }));
  },
  deleteTask(id: string) {
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
  },
  newTask(partial: Partial<Task> = {}): Task {
    const t = now();
    return {
      title: '',
      description: '',
      isCompleted: false,
      priority: 0,
      createdDate: t,
      updatedDate: t,
      subTasks: [],
      dueDate: 0,
      recurring: false,
      frequency: 2,
      frequencyAmount: 1,
      alarmId: null,
      id: uuid(),
      ...partial,
    };
  },
  // notes
  upsertNote(note: Note) {
    setState((s) => ({ ...s, notes: upsert(s.notes, note) }));
  },
  deleteNote(id: string) {
    setState((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }));
  },
  newNote(folderId: string | null = null): Note {
    const t = now();
    return { title: '', content: '', createdDate: t, updatedDate: t, pinned: false, folderId, id: uuid() };
  },
  upsertFolder(folder: NoteFolder) {
    setState((s) => ({ ...s, noteFolders: upsert(s.noteFolders, folder) }));
  },
  deleteFolder(id: string) {
    // same as the app: deleting a folder deletes its notes
    setState((s) => ({
      ...s,
      noteFolders: s.noteFolders.filter((f) => f.id !== id),
      notes: s.notes.filter((n) => n.folderId !== id),
    }));
  },
  // diary
  upsertEntry(entry: DiaryEntry) {
    setState((s) => ({ ...s, diary: upsert(s.diary, entry) }));
  },
  deleteEntry(id: string) {
    setState((s) => ({ ...s, diary: s.diary.filter((d) => d.id !== id) }));
  },
  // bookmarks
  upsertBookmark(b: Bookmark) {
    setState((s) => ({ ...s, bookmarks: upsert(s.bookmarks, b) }));
  },
  deleteBookmark(id: string) {
    setState((s) => ({ ...s, bookmarks: s.bookmarks.filter((b) => b.id !== id) }));
  },
  // calendar events
  upsertEvent(e: CalEvent) {
    setState((s) => ({ ...s, events: upsert(s.events, e) }));
  },
  deleteEvent(id: string) {
    setState((s) => ({ ...s, events: s.events.filter((x) => x.id !== id) }));
  },
  upsertCategory(c: EventCategory) {
    // keep the colour on every event of this category so the Android app shows it too
    setState((s) => ({
      ...s,
      categories: upsert(s.categories, c),
      events: s.events.map((e) => (e.category === c.id && e.color !== c.color ? { ...e, color: c.color, updatedDate: now() } : e)),
    }));
  },
  deleteCategory(id: string) {
    setState((s) => ({
      ...s,
      categories: s.categories.filter((c) => c.id !== id),
      events: s.events.map((e) => (e.category === id ? { ...e, category: '', color: '', updatedDate: now() } : e)),
    }));
  },
  // settings
  updateSettings(patch: Partial<Settings>) {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }), false);
  },
  updateSync(patch: Partial<Settings['sync']>) {
    setState((s) => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, ...patch } } }), false);
  },
};
