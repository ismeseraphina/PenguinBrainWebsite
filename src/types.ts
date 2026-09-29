// Data model – identical JSON shape to the Android app's Room entities / JSON backup
// (see core/database/.../entity/*.kt in Penguin Brain / MyBrain).

export type Mood = 'AWESOME' | 'GOOD' | 'OKAY' | 'BAD' | 'TERRIBLE';

export interface Note {
  title: string;
  content: string;
  createdDate: number;
  updatedDate: number;
  pinned: boolean;
  folderId: string | null;
  id: string;
}

export interface NoteFolder {
  name: string;
  id: string;
}

export interface SubTask {
  title: string;
  isCompleted: boolean;
  id: string;
}

export interface Task {
  title: string;
  description: string;
  isCompleted: boolean;
  priority: number; // 0 low, 1 medium, 2 high
  createdDate: number;
  updatedDate: number;
  subTasks: SubTask[];
  dueDate: number; // 0 = no due date
  recurring: boolean;
  frequency: number; // 0 every minutes, 1 hourly, 2 daily, 3 weekly, 4 monthly, 5 annual
  frequencyAmount: number;
  alarmId: number | null;
  id: string;
}

export interface DiaryEntry {
  title: string;
  content: string;
  createdDate: number;
  updatedDate: number;
  mood: Mood;
  id: string;
}

export interface Bookmark {
  url: string;
  title: string;
  description: string;
  createdDate: number;
  updatedDate: number;
  id: string;
}

// Calendar event synced with the "Penguin Brain" calendar in the Android app.
// start/end are epoch milliseconds (UTC instants). All-day events use UTC midnight like Android.
export interface CalEvent {
  title: string;
  description: string;
  location: string;
  start: number;
  end: number;
  allDay: boolean;
  rrule: string; // RFC 5545 RRULE without the "RRULE:" prefix, empty = no repeat
  reminders: number[]; // minutes before start
  updatedDate: number;
  id: string;
}

export interface Tombstone {
  type: string;
  id: string;
  at: number;
}

export interface SyncFile {
  format: string;
  version: number;
  updatedAt: number;
  updatedBy: string;
  notes: Note[];
  noteFolders: NoteFolder[];
  tasks: Task[];
  diary: DiaryEntry[];
  bookmarks: Bookmark[];
  events: CalEvent[];
  deleted: Tombstone[];
}

export interface SyncSettings {
  token: string;
  owner: string;
  repo: string;
  login: string;
  auto: boolean;
  lastSync: number;
  lastError: string;
  isAdmin?: boolean;
}

export type AiProviderId = 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'lmstudio' | 'ollama';
export interface AiSettings {
  provider: AiProviderId | 'none';
  keys: Partial<Record<AiProviderId, string>>;
  models: Partial<Record<AiProviderId, string>>;
  urls: Partial<Record<AiProviderId, string>>;
  tools: boolean;
}

export interface Routine {
  id: string;
  name: string;
  time: string; // HH:mm local time
  minutes: number;
  days: number[]; // 0 = Sunday
  enabled: boolean;
}
export interface ClockSettings {
  focusLeadMin: number; // how long before a task's due date the focus window opens
  focusMinutes: number; // suggested focus session length
  routines: Routine[];
  notify: boolean;
}

export interface Settings {
  clock: ClockSettings;
  ai: AiSettings;
  theme: 'auto' | 'light' | 'dark';
  firstDayOfWeek: 0 | 1; // 0 sunday, 1 monday
  showCompletedTasks: boolean;
  taskOrder: 'priority' | 'dueDate' | 'updated' | 'created' | 'title';
  noteView: 'grid' | 'list';
  sync: SyncSettings;
}

export interface SyncBase {
  account: string;
  ids: Record<string, string[]>;
}

export interface AppData {
  notes: Note[];
  noteFolders: NoteFolder[];
  tasks: Task[];
  diary: DiaryEntry[];
  bookmarks: Bookmark[];
  events: CalEvent[];
}

export interface AppState extends AppData {
  settings: Settings;
  syncBase: SyncBase;
}

export const MOODS: { mood: Mood; value: number; label: string; icon: string; color: string }[] = [
  { mood: 'AWESOME', value: 5, label: 'Awesome', icon: 'very_happy', color: 'var(--mood-awesome)' },
  { mood: 'GOOD', value: 4, label: 'Good', icon: 'happy', color: 'var(--mood-good)' },
  { mood: 'OKAY', value: 3, label: 'Okay', icon: 'ok_face', color: 'var(--mood-okay)' },
  { mood: 'BAD', value: 2, label: 'Bad', icon: 'sad', color: 'var(--mood-bad)' },
  { mood: 'TERRIBLE', value: 1, label: 'Terrible', icon: 'very_sad', color: 'var(--mood-terrible)' },
];

export const PRIORITIES = [
  { value: 0, label: 'Low', color: 'var(--prio-low)' },
  { value: 1, label: 'Medium', color: 'var(--prio-medium)' },
  { value: 2, label: 'High', color: 'var(--prio-high)' },
];

export const FREQUENCIES = [
  { value: 0, label: 'Minutes' },
  { value: 1, label: 'Hours' },
  { value: 2, label: 'Days' },
  { value: 3, label: 'Weeks' },
  { value: 4, label: 'Months' },
  { value: 5, label: 'Years' },
];
