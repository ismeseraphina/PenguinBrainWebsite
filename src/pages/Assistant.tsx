import { useEffect, useRef, useState } from 'react';
import { PROVIDERS, providerInfo, runChat, type ChatMessage } from '../ai';
import { actions, useStore } from '../store';
import type { AiProviderId } from '../types';
import { Icon, IconButton, Modal, Switch, TopBar } from '../ui';
import { renderMarkdown } from '../util';

// keep the conversation while moving between pages
let saved: ChatMessage[] = [];

const SUGGESTIONS = ['What tasks are due this week?', 'Summarize my recent diary entries', 'Create a study plan task list for my exams', 'Find my notes about discrete maths'];

export function AssistantSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ai = useStore((s) => s.settings.ai);
  const [provider, setProvider] = useState<AiProviderId | 'none'>(ai.provider);
  const p = providerInfo(provider);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!open) return;
    const cur = providerInfo(provider);
    setKey(cur ? ai.keys[cur.id] ?? '' : '');
    setModel(cur ? ai.models[cur.id] ?? '' : '');
    setUrl(cur ? ai.urls[cur.id] ?? '' : '');
  }, [open, provider, ai]);
  const save = () => {
    const next = { ...ai, provider };
    if (p) {
      next.keys = { ...ai.keys, [p.id]: key.trim() };
      next.models = { ...ai.models, [p.id]: model.trim() };
      next.urls = { ...ai.urls, [p.id]: url.trim() };
    }
    actions.updateSettings({ ai: next });
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assistant settings"
      footer={
        <>
          <button className="btn text" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save}>Save</button>
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span className="field-label">AI provider</span>
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as AiProviderId | 'none')}>
            <option value="none">None</option>
            {PROVIDERS.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </label>
        {p && (
          <>
            {p.needsKey && (
              <label className="field">
                <span className="field-label">
                  API key{' '}
                  {p.keyUrl && (
                    <a className="small" href={p.keyUrl} target="_blank" rel="noopener noreferrer">Get a key</a>
                  )}
                </span>
                <input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
              </label>
            )}
            <label className="field">
              <span className="field-label">
                Model{' '}
                <a className="small" href={p.modelsUrl} target="_blank" rel="noopener noreferrer">Models</a>
              </span>
              <input className="input" value={model} placeholder={p.defaultModel} onChange={(e) => setModel(e.target.value)} />
            </label>
            {p.customUrl && (
              <label className="field">
                <span className="field-label">{p.customUrl === 'required' ? 'Server URL' : 'Custom base URL (optional)'}</span>
                <input className="input" value={url} placeholder={p.defaultUrl} onChange={(e) => setUrl(e.target.value)} />
              </label>
            )}
            {p.customUrl === 'required' && <p className="muted small">The server must allow CORS. A secure (https) page cannot call an http server on another device, so this works best when the site and the server run on the same computer.</p>}
          </>
        )}
        <div className="field row">
          <span className="field-label">Let the assistant read and add notes, tasks, diary and bookmarks</span>
          <Switch label="Tools" checked={ai.tools} onChange={(v) => actions.updateSettings({ ai: { ...ai, tools: v } })} />
        </div>
        <p className="muted small">Your API key is stored only in this browser and is not synced. Messages go straight from your browser to the provider.</p>
      </div>
    </Modal>
  );
}

export function AssistantPage() {
  const ai = useStore((s) => s.settings.ai);
  const [messages, setMessages] = useState<ChatMessage[]>(saved);
  const [live, setLive] = useState<ChatMessage | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const p = providerInfo(ai.provider);

  useEffect(() => {
    saved = messages;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, live]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    if (!p) {
      setSettings(true);
      return;
    }
    const history = [...messages, { role: 'user' as const, content: t }];
    setMessages(history);
    setInput('');
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const reply = await runChat(history, (m) => setLive(m), ctrl.signal);
      setMessages([...history, reply.content || reply.tools?.length ? reply : { role: 'assistant', content: '(no answer)' }]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMessages([...history, { role: 'assistant', content: (e as Error).message, error: true }]);
    } finally {
      setLive(null);
      setBusy(false);
      abort.current = null;
    }
  };

  const shown = live ? [...messages, live] : messages;

  return (
    <div className="page narrow assistant">
      <TopBar
        title="Assistant"
        subtitle={p ? `${p.name} · ${ai.models[p.id] || p.defaultModel}` : 'Choose an AI provider to start'}
        actions={
          <>
            {messages.length > 0 && <IconButton icon="delete" label="New chat" onClick={() => { abort.current?.abort(); setMessages([]); }} />}
            <IconButton icon="settings" label="Assistant settings" onClick={() => setSettings(true)} />
          </>
        }
      />
      <div className="chat">
        {shown.length === 0 ? (
          <div className="chat-empty">
            <img src="img/penguin_assistant.webp" alt="" width={140} height={140} />
            <p className="muted">Ask anything, or let the assistant work with your notes, tasks, diary and bookmarks.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip-btn" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
            {!p && <button className="btn" onClick={() => setSettings(true)}>Set up the assistant</button>}
          </div>
        ) : (
          shown.map((m, i) => (
            <div key={i} className={`bubble ${m.role} ${m.error ? 'error' : ''}`}>
              {m.tools && m.tools.length > 0 && (
                <div className="tool-calls">
                  {m.tools.map((t, j) => (
                    <span key={j} className="chip"><Icon name="code" size={12} /> {t.name}</span>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && !m.error ? <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} /> : <p>{m.content}</p>}
            </div>
          ))
        )}
        {busy && <div className="bubble assistant typing"><span /><span /><span /></div>}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="input"
          rows={1}
          value={input}
          placeholder="Message the assistant"
          aria-label="Message"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <button className="btn" disabled={!input.trim()}>Send</button>
        )}
      </form>
      <AssistantSettings open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
