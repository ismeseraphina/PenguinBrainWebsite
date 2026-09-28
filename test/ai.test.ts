import { actions, getState } from '../src/store';
import { runChat } from '../src/ai';
let step = 0; const seen: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  const body = JSON.parse(init.body); seen.push({ url, body });
  step++;
  const msg = step === 1
    ? { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'createTask', arguments: JSON.stringify({ title: 'Revise logic', priority: 'high', dueDate: '2026-10-01 18:00' }) } }] }
    : { content: 'Added the task.' };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: msg }] }) };
};
actions.updateSettings({ ai: { provider: 'openai', keys: { openai: 'k' }, models: {}, urls: {}, tools: true } });
const r = await runChat([{ role: 'user', content: 'add a task' }], () => {});
const t = getState().tasks[0];
if (!(r.content === 'Added the task.' && t.title === 'Revise logic' && t.priority === 2 && new Date(t.dueDate).getHours() === 18)) { console.log('FAIL', r, t); process.exit(1); }
if (!(seen[0].url === 'https://api.openai.com/v1/chat/completions' && seen[0].body.model === 'gpt-5.4' && seen[0].body.tools.length > 10 && seen[1].body.messages.at(-1).role === 'tool')) { console.log('FAIL req'); process.exit(1); }
console.log('AI PASSED');
