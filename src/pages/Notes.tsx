import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, getState, useStore } from '../store';
import type { Note } from '../types';
import { Confirm, Empty, Fab, Icon, IconButton, Modal, SearchField, TopBar, navigate, toast } from '../ui';
import { copyText, formatDate, now, plainPreview, renderMarkdown, uuid } from '../util';

export function NoteCard({ note, list }: { note: Note; list?: boolean }) {
  return (
    <button className={`note-card ${list ? 'list' : ''}`} onClick={() => navigate(`/notes/${note.id}`)}>
      <div className="note-card-head">
        <h3>{note.title || 'Untitled'}</h3>
        {note.pinned && <Icon name="pin_filled" size={16} className="accent" title="Pinned" />}
      </div>
      <p>{plainPreview(note.content, list ? 140 : 220)}</p>
      <span className="muted small">{formatDate(note.updatedDate)}</span>
    </button>
  );
}

export function NotesPage({ folderId }: { folderId?: string }) {
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.noteFolders);
  const view = useStore((s) => s.settings.noteView);
  const [query, setQuery] = useState('');
  const [folderModal, setFolderModal] = useState<null | { id?: string; name: string }>(null);
  const [confirmFolder, setConfirmFolder] = useState(false);
  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let l = notes;
    if (folderId) l = l.filter((n) => n.folderId === folderId);
    else if (!q) l = l.filter((n) => !n.folderId);
    if (q) l = l.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    return l.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedDate - a.updatedDate);
  }, [notes, folderId, query]);

  const saveFolder = () => {
    if (!folderModal || !folderModal.name.trim()) return;
    actions.upsertFolder({ id: folderModal.id ?? uuid(), name: folderModal.name.trim() });
    setFolderModal(null);
  };

  return (
    <div className="page">
      <TopBar
        title={folder ? folder.name : 'Notes'}
        subtitle={folder ? `${list.length} notes` : `${notes.length} notes · ${folders.length} folders`}
        onBack={folder ? () => navigate('/notes') : undefined}
        actions={
          <>
            <IconButton icon={view === 'grid' ? 'list_view' : 'spaces'} label={view === 'grid' ? 'List view' : 'Grid view'} onClick={() => actions.updateSettings({ noteView: view === 'grid' ? 'list' : 'grid' })} />
            {folder ? (
              <>
                <IconButton icon="edit" label="Rename folder" onClick={() => setFolderModal({ id: folder.id, name: folder.name })} />
                <IconButton icon="delete" label="Delete folder" danger onClick={() => setConfirmFolder(true)} />
              </>
            ) : (
              <IconButton icon="create_folder" label="New folder" onClick={() => setFolderModal({ name: '' })} />
            )}
          </>
        }
      />
      <div className="toolbar">
        <SearchField value={query} onChange={setQuery} placeholder={folder ? `Search in ${folder.name}` : 'Search all notes'} />
      </div>
      {!folderId && !query && folders.length > 0 && (
        <div className="folders">
          {folders
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((f) => (
              <button key={f.id} className="folder" onClick={() => navigate(`/notes/folder/${f.id}`)}>
                <Icon name="folder" size={20} />
                <span>{f.name}</span>
                <span className="muted small">{notes.filter((n) => n.folderId === f.id).length}</span>
              </button>
            ))}
        </div>
      )}
      {list.length === 0 ? (
        <Empty image="img/penguin_notes.webp" text={query ? 'No notes match your search' : "You don't have any notes. Click + to add one."} />
      ) : (
        <div className={view === 'grid' ? 'notes-grid' : 'list'}>
          {list.map((n) => (
            <NoteCard key={n.id} note={n} list={view === 'list'} />
          ))}
        </div>
      )}
      <Fab label="Add note" onClick={() => navigate(folderId ? `/notes/new/${folderId}` : '/notes/new')} />
      <Modal
        open={folderModal != null}
        onClose={() => setFolderModal(null)}
        title={folderModal?.id ? 'Rename folder' : 'New folder'}
        footer={
          <>
            <button className="btn text" onClick={() => setFolderModal(null)}>Cancel</button>
            <button className="btn" disabled={!folderModal?.name.trim()} onClick={saveFolder}>Save</button>
          </>
        }
      >
        <input className="input" autoFocus value={folderModal?.name ?? ''} placeholder="Folder name" aria-label="Folder name" onChange={(e) => setFolderModal((m) => (m ? { ...m, name: e.target.value } : m))} onKeyDown={(e) => e.key === 'Enter' && saveFolder()} />
      </Modal>
      <Confirm
        open={confirmFolder}
        onClose={() => setConfirmFolder(false)}
        title="Delete folder?"
        message="The folder and all notes inside it will be deleted on every synced device."
        onConfirm={() => {
          if (folder) actions.deleteFolder(folder.id);
          navigate('/notes');
        }}
      />
    </div>
  );
}

export function NoteDetailPage({ id, newFolderId }: { id?: string; newFolderId?: string | null }) {
  const stored = useStore((s) => (id ? s.notes.find((n) => n.id === id) : undefined));
  const folders = useStore((s) => s.noteFolders);
  // a new note is only saved once it has content (same as the app)
  const draftRef = useRef<Note>(actions.newNote(newFolderId ?? null));
  const [draft, setDraft] = useState<Note | null>(null);
  const note = stored ?? draft ?? draftRef.current;
  const [reading, setReading] = useState(!!stored && !!stored.content);
  const [confirm, setConfirm] = useState(false);
  const isNew = !stored;

  useEffect(() => {
    // after first save of a new note, move the URL to the real id
    if (!id && draft && getState().notes.some((n) => n.id === draft.id)) {
      window.history.replaceState(null, '', `#/notes/${draft.id}`);
    }
  }, [id, draft]);

  const update = (patch: Partial<Note>) => {
    const next = { ...note, ...patch, updatedDate: now() };
    if (!next.title.trim() && !next.content.trim() && isNew) {
      setDraft(next);
      return;
    }
    setDraft(next);
    actions.upsertNote(next);
  };

  const exists = useStore((s) => s.notes.some((n) => n.id === note.id));

  return (
    <div className="page narrow">
      <TopBar
        title={isNew && !exists ? 'New note' : 'Note'}
        onBack={() => navigate(note.folderId ? `/notes/folder/${note.folderId}` : '/notes')}
        actions={
          <>
            <IconButton icon={note.pinned ? 'pin_filled' : 'pin'} label={note.pinned ? 'Unpin' : 'Pin'} active={note.pinned} onClick={() => update({ pinned: !note.pinned })} />
            <IconButton icon={reading ? 'edit' : 'read_mode'} label={reading ? 'Edit' : 'Reading mode'} active={reading} onClick={() => setReading(!reading)} />
            <IconButton
              icon="copy"
              label="Copy text"
              onClick={async () => {
                const ok = await copyText(note.title ? `${note.title}\n\n${note.content}` : note.content);
                toast(ok ? 'Copied to clipboard' : 'Could not copy', ok ? 'info' : 'error');
              }}
            />
            {exists && <IconButton icon="delete" label="Delete note" danger onClick={() => setConfirm(true)} />}
          </>
        }
      />
      <div className="card pad editor">
        <div className="editor-meta">
          <label className="folder-select">
            <Icon name="folder" size={16} />
            <select value={note.folderId ?? ''} aria-label="Folder" onChange={(e) => update({ folderId: e.target.value || null })}>
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          {exists && <span className="muted small">Edited {formatDate(note.updatedDate, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
        <input className="input title-input bare" value={note.title} placeholder="Title" aria-label="Note title" onChange={(e) => update({ title: e.target.value })} />
        {reading ? (
          <div className="markdown" onDoubleClick={() => setReading(false)} dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) || '<p class="muted">Empty note</p>' }} />
        ) : (
          <textarea className="input bare note-body" autoFocus={isNew} value={note.content} placeholder="Write something… Markdown is supported" aria-label="Note content" onChange={(e) => update({ content: e.target.value })} />
        )}
      </div>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete note?"
        message="This deletes the note on every synced device."
        onConfirm={() => {
          actions.deleteNote(note.id);
          navigate(note.folderId ? `/notes/folder/${note.folderId}` : '/notes');
          toast('Note deleted');
        }}
      />
    </div>
  );
}
