import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Task } from './types';

export const now = () => Date.now();

export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function endOfDay(t: number) {
  const d = new Date(t);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
export const isSameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);
export const isToday = (t: number) => isSameDay(t, Date.now());

export function formatDate(t: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(t).toLocaleDateString(undefined, opts);
}
export function formatTime(t: number) {
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export function formatDateTime(t: number) {
  return `${formatDate(t)}, ${formatTime(t)}`;
}
export function formatDue(t: number) {
  if (!t) return '';
  const today = startOfDay(Date.now());
  const day = startOfDay(t);
  const diff = Math.round((day - today) / 86400000);
  const time = formatTime(t);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  if (diff === -1) return `Yesterday, ${time}`;
  return formatDateTime(t);
}
export function relative(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return formatDateTime(t);
}

/** value for <input type="datetime-local"> */
export function toLocalInput(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function toDateInput(t: number) {
  return toLocalInput(t).slice(0, 10);
}
export function fromLocalInput(v: string) {
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Same rule as UpsertTaskUseCase.rollRecurringDueDateIfNeeded in the app */
export function advance(t: number, frequency: number, amount: number) {
  const d = new Date(t);
  const a = Math.max(1, amount || 1);
  switch (frequency) {
    case 0: d.setMinutes(d.getMinutes() + a); break;
    case 1: d.setHours(d.getHours() + a); break;
    case 2: d.setDate(d.getDate() + a); break;
    case 3: d.setDate(d.getDate() + 7 * a); break;
    case 4: d.setMonth(d.getMonth() + a); break;
    case 5: d.setFullYear(d.getFullYear() + a); break;
  }
  return d.getTime();
}

export function completeTask(task: Task, completed: boolean): Task {
  const t = now();
  if (completed && !task.isCompleted && task.recurring && task.dueDate !== 0) {
    let next = task.dueDate;
    do next = advance(next, task.frequency, task.frequencyAmount);
    while (next <= t);
    return { ...task, dueDate: next, isCompleted: false, updatedDate: t };
  }
  return { ...task, isCompleted: completed, updatedDate: t };
}

marked.setOptions({ gfm: true, breaks: true });
if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}
export function renderMarkdown(md: string) {
  return DOMPurify.sanitize(marked.parse(md || '', { async: false }) as string);
}

export function plainPreview(md: string, max = 160) {
  return (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
export function normalizeUrl(url: string) {
  const u = url.trim();
  if (!u) return u;
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
}
