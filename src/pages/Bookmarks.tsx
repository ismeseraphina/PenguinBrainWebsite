import { useMemo, useState } from 'react';
import { actions, useStore } from '../store';
import type { Bookmark } from '../types';
import { Confirm, Empty, Fab, Icon, Modal, SearchField, TopBar, toast } from '../ui';
import { formatDate, hostOf, normalizeUrl, now, uuid } from '../util';

export function BookmarksPage() {
  const bookmarks = useStore((s) => s.bookmarks);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [confirm, setConfirm] = useState<Bookmark | null>(null);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookmarks
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
      .sort((a, b) => b.updatedDate - a.updatedDate);
  }, [bookmarks, query]);

  const save = () => {
    if (!editing || !editing.url.trim()) return;
    const t = now();
    const exists = bookmarks.some((b) => b.id === editing.id);
    actions.upsertBookmark({ ...editing, url: normalizeUrl(editing.url), updatedDate: t, createdDate: exists ? editing.createdDate : t });
    setEditing(null);
    toast(exists ? 'Bookmark saved' : 'Bookmark added');
  };

  return (
    <div className="page">
      <TopBar title="Bookmarks" subtitle={`${bookmarks.length} saved`} />
      <div className="toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Search bookmarks" />
      </div>
      {list.length === 0 ? (
        <Empty image="img/penguin_bookmarks.webp" text={query ? 'No bookmarks match your search' : "You don't have any bookmarks. Click + to save a link."} />
      ) : (
        <div className="bookmarks-grid">
          {list.map((b) => (
            <article key={b.id} className="bookmark">
              <a href={normalizeUrl(b.url)} target="_blank" rel="noopener noreferrer" className="bookmark-link">
                <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(b.url))}&sz=64`} alt="" width={28} height={28} loading="lazy" />
                <div>
                  <h3>{b.title || hostOf(b.url)}</h3>
                  <span className="muted small">{hostOf(b.url)}</span>
                </div>
              </a>
              {b.description && <p>{b.description}</p>}
              <footer>
                <span className="muted small">{formatDate(b.updatedDate)}</span>
                <span>
                  <button className="icon-btn" aria-label="Edit bookmark" onClick={() => setEditing(b)}><Icon name="edit" size={16} /></button>
                  <button className="icon-btn danger" aria-label="Delete bookmark" onClick={() => setConfirm(b)}><Icon name="delete" size={16} /></button>
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}
      <Fab label="Add bookmark" onClick={() => setEditing({ url: '', title: '', description: '', createdDate: now(), updatedDate: now(), id: uuid() })} />
      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title={editing && bookmarks.some((b) => b.id === editing.id) ? 'Edit bookmark' : 'New bookmark'}
        footer={
          <>
            <button className="btn text" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn" disabled={!editing?.url.trim()} onClick={save}>Save</button>
          </>
        }
      >
        {editing && (
          <div className="form">
            <input className="input" autoFocus type="url" value={editing.url} placeholder="https://…" aria-label="URL" onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
            <input className="input" value={editing.title} placeholder="Title" aria-label="Title" onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <textarea className="input" rows={3} value={editing.description} placeholder="Description" aria-label="Description" onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>
        )}
      </Modal>
      <Confirm
        open={confirm != null}
        onClose={() => setConfirm(null)}
        title="Delete bookmark?"
        message="This deletes the bookmark on every synced device."
        onConfirm={() => confirm && actions.deleteBookmark(confirm.id)}
      />
    </div>
  );
}
