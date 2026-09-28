// AI assistant, following the Penguin Brain / MyBrain app: same providers, same system prompt and the same tools
// (notes, folders, tasks, diary, bookmarks, date formatting). The browser calls the provider directly with the
// user's own API key, which stays in this browser and is never synced.
import { actions, getState } from './store';
import type { AiProviderId, AiSettings, Mood } from './types';
import { MOODS } from './types';
import { now, uuid } from './util';

export interface ProviderInfo {
  id: AiProviderId;
  name: string;
  defaultModel: string;
  keyUrl?: string;
  modelsUrl: string;
  needsKey: boolean;
  defaultUrl?: string;
  customUrl?: 'optional' | 'required';
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-5.4', keyUrl: 'https://platform.openai.com/api-keys', modelsUrl: 'https://platform.openai.com/docs/models', needsKey: true, defaultUrl: 'https://api.openai.com/v1', customUrl: 'optional' },
  { id: 'gemini', name: 'Gemini', defaultModel: 'gemini-3.1-pro-preview', keyUrl: 'https://aistudio.google.com/apikey', modelsUrl: 'https://ai.google.dev/gemini-api/docs/models', needsKey: true },
  { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-opus-4-6', keyUrl: 'https://console.anthropic.com/settings/keys', modelsUrl: 'https://platform.claude.com/docs/en/about-claude/models/overview', needsKey: true },
  { id: 'openrouter', name: 'OpenRouter', defaultModel: 'openrouter/auto', keyUrl: 'https://openrouter.ai/keys', modelsUrl: 'https://openrouter.ai/models', needsKey: true },
  { id: 'lmstudio', name: 'LM Studio', defaultModel: 'openai/gpt-oss-20b', modelsUrl: 'https://lmstudio.ai/models', needsKey: false, defaultUrl: 'http://localhost:1234', customUrl: 'required' },
  { id: 'ollama', name: 'Ollama', defaultModel: 'gpt-oss:latest', modelsUrl: 'https://ollama.com/library', needsKey: false, defaultUrl: 'http://localhost:11434', customUrl: 'required' },
];
export const providerInfo = (id: string) => PROVIDERS.find((p) => p.id === id);

const baseChatSystemMessage = `You are a personal AI assistant.
You help users with their questions and requests and provide detailed explanations if needed.`;
const toolsSystemMessage = `You can make multiple tool calls after each other to fulfill the user's request.
no need to ask the user to proceed after each tool.
it's highly encouraged to make multiple tool calls in one response when possible.
after you no need to make tool calls any more, give the user a short summary of what you did.`;

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDateTime = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const parseDateTime = (s?: string | null) => {
  if (!s) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s.trim());
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 9), +(m[5] ?? 0)).getTime();
};

function systemMessage(tools: boolean) {
  const d = new Date();
  return `${baseChatSystemMessage}\n${tools ? toolsSystemMessage + '\n' : ''}Current date & time: ${d.toLocaleDateString('en-US', { weekday: 'long' })} ${fmtDateTime(d.getTime())}\nTime zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\nDates in tools use the format yyyy-MM-dd HH:mm.`;
}

// ---------------- tools ----------------
type Json = Record<string, unknown>;
interface ToolDef {
  name: string;
  description: string;
  params: Json; // JSON schema properties
  required?: string[];
  run: (a: Json) => unknown;
}
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const cut = (s: string, n = 100) => (s.length > n ? s.slice(0, n) + '…' : s);
const has = (q: string, ...f: string[]) => !q || f.some((x) => x.toLowerCase().includes(q.toLowerCase()));
const S = (description: string) => ({ type: 'string', description });
const prioOf = (v: unknown) => ({ low: 0, medium: 1, high: 2 } as Record<string, number>)[str(v).toLowerCase()] ?? 0;
const PRIO = ['low', 'medium', 'high'];

function createTask(a: Json) {
  const t = actions.newTask({ title: str(a.title), description: str(a.description), priority: prioOf(a.priority), dueDate: parseDateTime(str(a.dueDate)) });
  if (Array.isArray(a.subTasks)) t.subTasks = (a.subTasks as unknown[]).map((x) => ({ title: str(x), isCompleted: false, id: uuid() }));
  actions.upsertTask(t);
  return t.id;
}
function createNote(a: Json) {
  const n = { ...actions.newNote(), title: str(a.title), content: str(a.content), folderId: str(a.folderId) || null };
  if (n.folderId && !getState().noteFolders.some((f) => f.id === n.folderId)) n.folderId = null;
  actions.upsertNote(n);
  return n.id;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'searchNotes',
    description: 'Search notes by title/content (partial match, content truncated to 100 chars). If the query is empty, returns all notes.',
    params: { query: S('Search query') },
    run: (a) => getState().notes.filter((n) => has(str(a.query), n.title, n.content)).slice(0, 50).map((n) => ({ id: n.id, title: n.title, content: cut(n.content), folderId: n.folderId, pinned: n.pinned, updatedDate: fmtDateTime(n.updatedDate) })),
  },
  {
    name: 'createNote',
    description: 'Create a note. Returns ID.',
    params: { title: S('Note title'), content: S('Markdown content'), folderId: S('Optional Folder ID. If empty, the note will be in the root folder. Use searchNoteFolders to find an ID.') },
    required: ['title', 'content'],
    run: (a) => ({ id: createNote(a) }),
  },
  {
    name: 'createMultipleNotes',
    description: 'Create multiple notes. Returns IDs.',
    params: { notes: { type: 'array', items: { type: 'object', properties: { title: S('Title'), content: S('Content'), folderId: S('Optional folder ID') }, required: ['title', 'content'] } } },
    required: ['notes'],
    run: (a) => ({ ids: ((a.notes as Json[]) ?? []).map(createNote) }),
  },
  {
    name: 'getNoteById',
    description: 'Get full note by ID.',
    params: { id: S('Note ID') },
    required: ['id'],
    run: (a) => {
      const n = getState().notes.find((x) => x.id === str(a.id));
      return n ? { ...n, createdDate: fmtDateTime(n.createdDate), updatedDate: fmtDateTime(n.updatedDate) } : { error: 'Note not found' };
    },
  },
  {
    name: 'searchNoteFolders',
    description: 'Search folders by name (partial match). Returns folder IDs.',
    params: { name: S('Folder name query') },
    run: (a) => getState().noteFolders.filter((f) => has(str(a.name), f.name)).map((f) => ({ id: f.id, name: f.name })),
  },
  {
    name: 'searchTasks',
    description: 'Search tasks by title (partial match). If the query is empty, returns all tasks.',
    params: { query: S('Search query') },
    run: (a) =>
      getState()
        .tasks.filter((t) => has(str(a.query), t.title))
        .slice(0, 80)
        .map((t) => ({ id: t.id, title: t.title, description: cut(t.description), isCompleted: t.isCompleted, priority: PRIO[t.priority], dueDate: t.dueDate ? fmtDateTime(t.dueDate) : null, subTasks: t.subTasks.map((s) => ({ title: s.title, isCompleted: s.isCompleted })) })),
  },
  {
    name: 'createTask',
    description: 'Create a task. `isCompleted` = false initially. Returns ID.',
    params: { title: S('Task title'), description: S('Optional description'), priority: { type: 'string', enum: PRIO }, dueDate: S('Optional. Format: yyyy-MM-dd HH:mm'), subTasks: { type: 'array', items: { type: 'string' }, description: 'Optional sub-task titles' } },
    required: ['title'],
    run: (a) => ({ id: createTask(a) }),
  },
  {
    name: 'createMultipleTasks',
    description: 'Create multiple tasks. Returns IDs.',
    params: { tasks: { type: 'array', items: { type: 'object', properties: { title: S('Title'), description: S('Description'), priority: { type: 'string', enum: PRIO }, dueDate: S('Format: yyyy-MM-dd HH:mm') }, required: ['title'] } } },
    required: ['tasks'],
    run: (a) => ({ ids: ((a.tasks as Json[]) ?? []).map(createTask) }),
  },
  {
    name: 'updateTaskCompleted',
    description: 'Update task completed status.',
    params: { id: S('Task ID'), isCompleted: { type: 'boolean' } },
    required: ['id', 'isCompleted'],
    run: (a) => {
      const t = getState().tasks.find((x) => x.id === str(a.id));
      if (!t) return { error: 'Task not found' };
      actions.upsertTask({ ...t, isCompleted: !!a.isCompleted, updatedDate: now() });
      return { ok: true };
    },
  },
  {
    name: 'createDiaryEntry',
    description: 'Create diary entry. Returns ID.',
    params: { title: S('Title'), content: S('Content'), mood: { type: 'string', enum: MOODS.map((m) => m.mood) }, date: S('Optional. Format: yyyy-MM-dd HH:mm. Defaults to now') },
    required: ['title', 'content'],
    run: (a) => {
      const t = now();
      const mood = (MOODS.some((m) => m.mood === a.mood) ? a.mood : 'OKAY') as Mood;
      const e = { id: uuid(), title: str(a.title), content: str(a.content), mood, createdDate: parseDateTime(str(a.date)) || t, updatedDate: t };
      actions.upsertEntry(e);
      return { id: e.id };
    },
  },
  {
    name: 'searchDiaryEntries',
    description: 'Search diary entries by title/content (partial match, content truncated to 100 chars). If the query is empty, returns all entries.',
    params: { query: S('Search query') },
    run: (a) => getState().diary.filter((e) => has(str(a.query), e.title, e.content)).sort((x, y) => y.createdDate - x.createdDate).slice(0, 60).map((e) => ({ id: e.id, title: e.title, content: cut(e.content), mood: e.mood, date: fmtDateTime(e.createdDate) })),
  },
  {
    name: 'getDiaryEntry',
    description: 'Get diary entry by ID.',
    params: { id: S('Entry ID') },
    required: ['id'],
    run: (a) => {
      const e = getState().diary.find((x) => x.id === str(a.id));
      return e ? { ...e, createdDate: fmtDateTime(e.createdDate), updatedDate: fmtDateTime(e.updatedDate) } : { error: 'Entry not found' };
    },
  },
  {
    name: 'createBookmark',
    description: 'Create bookmark. Returns ID.',
    params: { url: S('URL'), title: S('Optional title'), description: S('Optional description') },
    required: ['url'],
    run: (a) => {
      const t = now();
      const b = { id: uuid(), url: str(a.url), title: str(a.title), description: str(a.description), createdDate: t, updatedDate: t };
      actions.upsertBookmark(b);
      return { id: b.id };
    },
  },
  {
    name: 'searchBookmarks',
    description: 'Search bookmarks by title/description/URL (partial match).',
    params: { query: S('Search query') },
    run: (a) => getState().bookmarks.filter((b) => has(str(a.query), b.title, b.description, b.url)).slice(0, 60).map((b) => ({ id: b.id, url: b.url, title: b.title, description: cut(b.description) })),
  },
  {
    name: 'formatDate',
    description: 'Convert a date in milliseconds to a formatted date string.',
    params: { millis: { type: 'number', description: 'The date in milliseconds.' } },
    required: ['millis'],
    run: (a) => fmtDateTime(Number(a.millis)),
  },
];

const schemaOf = (t: ToolDef) => ({ type: 'object', properties: t.params, required: t.required ?? [] });

// ---------------- chat ----------------
export interface ToolCallInfo {
  name: string;
  args: Json;
  result?: unknown;
}
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolCallInfo[];
  error?: boolean;
}

interface OAMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function endpoint(ai: AiSettings) {
  const p = providerInfo(ai.provider)!;
  const custom = (ai.urls[p.id] ?? '').trim().replace(/\/+$/, '');
  switch (p.id) {
    case 'openai':
      return `${custom || p.defaultUrl}/chat/completions`;
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1/chat/completions';
    default:
      return `${custom || p.defaultUrl}/v1/chat/completions`;
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Could not reach the AI provider. Check the URL, your connection, or (for LM Studio/Ollama) that CORS is enabled.');
  }
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const err = data.error as Json | undefined;
    throw new Error(str(err?.message ?? data.message ?? `Provider error ${res.status}`));
  }
  return data;
}

const MAX_STEPS = 12;

export async function runChat(history: ChatMessage[], onUpdate: (m: ChatMessage) => void, signal?: AbortSignal): Promise<ChatMessage> {
  const ai = getState().settings.ai;
  const p = providerInfo(ai.provider);
  if (!p) throw new Error('Choose an AI provider in the assistant settings first');
  const key = (ai.keys[p.id] ?? '').trim();
  if (p.needsKey && !key) throw new Error(`Add your ${p.name} API key in the assistant settings`);
  const model = (ai.models[p.id] ?? '').trim() || p.defaultModel;
  const out: ChatMessage = { role: 'assistant', content: '', tools: [] };
  const exec = (name: string, args: Json) => {
    const t = TOOLS.find((x) => x.name === name);
    let result: unknown;
    try {
      result = t ? t.run(args) : { error: `Unknown tool ${name}` };
    } catch (e) {
      result = { error: (e as Error).message };
    }
    out.tools!.push({ name, args, result });
    onUpdate({ ...out, tools: [...out.tools!] });
    return result;
  };

  if (p.id === 'anthropic') {
    type Block = { type: string; text?: string; id?: string; name?: string; input?: Json; tool_use_id?: string; content?: string };
    const msgs: { role: 'user' | 'assistant'; content: string | Block[] }[] = history.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }));
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await post(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        { model, max_tokens: 4096, system: systemMessage(ai.tools), messages: msgs, ...(ai.tools ? { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t) })) } : {}) },
        signal,
      );
      const content = (data.content as Block[]) ?? [];
      const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (text) out.content += (out.content ? '\n\n' : '') + text;
      const uses = content.filter((b) => b.type === 'tool_use');
      if (!uses.length) break;
      msgs.push({ role: 'assistant', content });
      msgs.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(exec(u.name!, u.input ?? {})) })) });
      onUpdate({ ...out });
    }
    return out;
  }

  const msgs: OAMsg[] = [{ role: 'system', content: systemMessage(ai.tools) }, ...history.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }) as OAMsg)];
  const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  if (p.id === 'openrouter') Object.assign(headers, { 'HTTP-Referer': location.origin, 'X-Title': 'Penguin Brain' });
  for (let step = 0; step < MAX_STEPS; step++) {
    const data = await post(
      endpoint(ai),
      headers,
      { model, messages: msgs, ...(ai.tools ? { tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schemaOf(t) } })) } : {}) },
      signal,
    );
    const msg = ((data.choices as Json[])?.[0]?.message ?? {}) as OAMsg;
    if (msg.content) out.content += (out.content ? '\n\n' : '') + msg.content;
    const calls = msg.tool_calls ?? [];
    if (!calls.length) break;
    msgs.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
    for (const c of calls) {
      let args: Json = {};
      try {
        args = JSON.parse(c.function.arguments || '{}') as Json;
      } catch {
        /* keep empty */
      }
      msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(exec(c.function.name, args)) });
    }
    onUpdate({ ...out });
  }
  return out;
}
