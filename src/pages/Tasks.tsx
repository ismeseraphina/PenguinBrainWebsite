import { useMemo, useState } from 'react';
import { actions, useStore } from '../store';
import type { SubTask, Task } from '../types';
import { FREQUENCIES, PRIORITIES } from '../types';
import { Confirm, Empty, Fab, Icon, IconButton, Modal, SearchField, Segmented, Switch, TopBar, navigate, toast } from '../ui';
import { completeTask, formatDue, fromLocalInput, now, toLocalInput, uuid } from '../util';

export function sortTasks(tasks: Task[], order: string) {
  const list = tasks.slice();
  const byDue = (a: Task, b: Task) => (a.dueDate || Infinity) - (b.dueDate || Infinity);
  switch (order) {
    case 'dueDate': list.sort(byDue); break;
    case 'updated': list.sort((a, b) => b.updatedDate - a.updatedDate); break;
    case 'created': list.sort((a, b) => b.createdDate - a.createdDate); break;
    case 'title': list.sort((a, b) => a.title.localeCompare(b.title)); break;
    default: list.sort((a, b) => b.priority - a.priority || byDue(a, b));
  }
  // completed tasks at the bottom like the app
  return list.sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));
}

export function TaskRow({ task, compact }: { task: Task; compact?: boolean }) {
  const prio = PRIORITIES[task.priority] ?? PRIORITIES[0];
  const overdue = !task.isCompleted && task.dueDate && task.dueDate < now();
  const doneSubs = task.subTasks.filter((s) => s.isCompleted).length;
  return (
    <div className={`task-row ${task.isCompleted ? 'done' : ''} ${compact ? 'compact' : ''}`}>
      <button
        className="check"
        style={{ borderColor: prio.color, background: task.isCompleted ? prio.color : 'transparent' }}
        aria-label={task.isCompleted ? 'Mark as not completed' : 'Mark as completed'}
        onClick={() => {
          const updated = completeTask(task, !task.isCompleted);
          actions.upsertTask(updated);
          if (task.recurring && !task.isCompleted && updated.dueDate !== task.dueDate) toast(`Next: ${formatDue(updated.dueDate)}`);
        }}
      >
        {task.isCompleted && <Icon name="check" size={14} />}
      </button>
      <button className="task-main" onClick={() => navigate(`/tasks/${task.id}`)}>
        <span className="task-title">{task.title || 'Untitled task'}</span>
        {!compact && task.description && <span className="task-desc">{task.description}</span>}
        <span className="task-meta">
          {task.dueDate ? (
            <span className={`chip ${overdue ? 'warn' : ''}`}>
              <Icon name="alarm" size={13} /> {formatDue(task.dueDate)}
            </span>
          ) : null}
          {task.recurring && <span className="chip"><Icon name="refresh" size={13} /> Repeats</span>}
          {task.subTasks.length > 0 && <span className="chip"><Icon name="bullet_list" size={13} /> {doneSubs}/{task.subTasks.length}</span>}
        </span>
      </button>
    </div>
  );
}

export function TaskEditor({ task, onChange }: { task: Task; onChange: (t: Task) => void }) {
  const set = (patch: Partial<Task>) => onChange({ ...task, ...patch });
  const setSub = (id: string, patch: Partial<SubTask>) => set({ subTasks: task.subTasks.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  return (
    <div className="form">
      <input className="input title-input" value={task.title} placeholder="Task title" aria-label="Task title" autoFocus={!task.title} onChange={(e) => set({ title: e.target.value })} />
      <textarea className="input" rows={3} value={task.description} placeholder="Description" aria-label="Description" onChange={(e) => set({ description: e.target.value })} />
      <div className="field">
        <span className="field-label">Priority</span>
        <div className="prio-picker" role="radiogroup" aria-label="Priority">
          {PRIORITIES.map((p) => (
            <button key={p.value} role="radio" aria-checked={task.priority === p.value} className={task.priority === p.value ? 'on' : ''} style={{ ['--c' as string]: p.color }} onClick={() => set({ priority: p.value })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field row">
        <span className="field-label">Due date</span>
        <Switch
          label="Due date"
          checked={task.dueDate !== 0}
          onChange={(v) => {
            if (v) {
              const d = new Date();
              d.setHours(d.getHours() + 1, 0, 0, 0);
              set({ dueDate: d.getTime() });
            } else set({ dueDate: 0, recurring: false });
          }}
        />
      </div>
      {task.dueDate !== 0 && (
        <>
          <input className="input" type="datetime-local" aria-label="Due date and time" value={toLocalInput(task.dueDate)} onChange={(e) => set({ dueDate: fromLocalInput(e.target.value) || task.dueDate })} />
          <div className="field row">
            <span className="field-label">Repeat</span>
            <Switch label="Repeat" checked={task.recurring} onChange={(v) => set({ recurring: v })} />
          </div>
          {task.recurring && (
            <div className="field row gap">
              <span>Every</span>
              <input className="input small" type="number" min={1} value={task.frequencyAmount} aria-label="Repeat amount" onChange={(e) => set({ frequencyAmount: Math.max(1, Number(e.target.value) || 1) })} />
              <select className="input" value={task.frequency} aria-label="Repeat unit" onChange={(e) => set({ frequency: Number(e.target.value) })}>
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
      <div className="field">
        <span className="field-label">Sub-tasks</span>
        <div className="subtasks">
          {task.subTasks.map((s) => (
            <div key={s.id} className="subtask">
              <input type="checkbox" checked={s.isCompleted} aria-label="Sub-task completed" onChange={(e) => setSub(s.id, { isCompleted: e.target.checked })} />
              <input className="input bare" value={s.title} placeholder="Sub-task" aria-label="Sub-task title" onChange={(e) => setSub(s.id, { title: e.target.value })} />
              <button className="icon-btn" aria-label="Remove sub-task" onClick={() => set({ subTasks: task.subTasks.filter((x) => x.id !== s.id) })}>
                <Icon name="delete" size={16} />
              </button>
            </div>
          ))}
          <button className="btn text" onClick={() => set({ subTasks: [...task.subTasks, { title: '', isCompleted: false, id: uuid() }] })}>
            <Icon name="add" size={14} /> Add sub-task
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddTaskModal({ open, onClose, initialDue = 0 }: { open: boolean; onClose: () => void; initialDue?: number }) {
  const [draft, setDraft] = useState<Task>(() => actions.newTask({ dueDate: initialDue }));
  const close = () => {
    setDraft(actions.newTask({ dueDate: initialDue }));
    onClose();
  };
  const save = () => {
    if (!draft.title.trim()) return;
    const t = now();
    actions.upsertTask({ ...draft, title: draft.title.trim(), subTasks: draft.subTasks.filter((s) => s.title.trim()), createdDate: t, updatedDate: t });
    toast('Task added');
    close();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="New task"
      footer={
        <>
          <button className="btn text" onClick={close}>Cancel</button>
          <button className="btn" disabled={!draft.title.trim()} onClick={save}>Add task</button>
        </>
      }
    >
      <TaskEditor task={draft} onChange={setDraft} />
    </Modal>
  );
}

export function TasksPage() {
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let l = tasks;
    if (!settings.showCompletedTasks) l = l.filter((t) => !t.isCompleted);
    if (q) l = l.filter((t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    return sortTasks(l, settings.taskOrder);
  }, [tasks, settings.showCompletedTasks, settings.taskOrder, query]);
  const open = tasks.filter((t) => !t.isCompleted).length;

  return (
    <div className="page">
      <TopBar
        title="Tasks"
        subtitle={`${open} open · ${tasks.length - open} done`}
        actions={
          <IconButton icon={settings.showCompletedTasks ? 'check' : 'list_view'} label={settings.showCompletedTasks ? 'Hide completed' : 'Show completed'} active={settings.showCompletedTasks} onClick={() => actions.updateSettings({ showCompletedTasks: !settings.showCompletedTasks })} />
        }
      />
      <div className="toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Search tasks" />
        <Segmented
          label="Sort tasks"
          value={settings.taskOrder}
          onChange={(v) => actions.updateSettings({ taskOrder: v })}
          options={[
            { value: 'priority', label: 'Priority' },
            { value: 'dueDate', label: 'Due' },
            { value: 'updated', label: 'Edited' },
            { value: 'title', label: 'A–Z' },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <Empty image="img/penguin_tasks.webp" text={query ? 'No tasks match your search' : "You don't have any tasks. Click + to add one."} />
      ) : (
        <div className="list">
          {list.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
      <Fab label="Add task" onClick={() => setAdding(true)} />
      <AddTaskModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

export function TaskDetailPage({ id }: { id: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === id));
  const [confirm, setConfirm] = useState(false);
  if (!task) {
    return (
      <div className="page">
        <TopBar title="Task" onBack={() => navigate('/tasks')} />
        <Empty image="img/penguin_tasks.webp" text="This task no longer exists." />
      </div>
    );
  }
  const update = (t: Task) => {
    // handle completing a recurring task the same way the list does
    actions.upsertTask({ ...t, updatedDate: now() });
  };
  return (
    <div className="page narrow">
      <TopBar
        title="Task details"
        onBack={() => navigate('/tasks')}
        actions={
          <>
            <IconButton
              icon="check"
              label={task.isCompleted ? 'Mark as not completed' : 'Mark as completed'}
              active={task.isCompleted}
              onClick={() => actions.upsertTask(completeTask(task, !task.isCompleted))}
            />
            <IconButton icon="delete" label="Delete task" danger onClick={() => setConfirm(true)} />
          </>
        }
      />
      <div className="card pad">
        <TaskEditor task={task} onChange={update} />
        <p className="muted small">Created {new Date(task.createdDate).toLocaleString()} · Edited {new Date(task.updatedDate).toLocaleString()}</p>
      </div>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete task?"
        message="This deletes the task on every synced device."
        onConfirm={() => {
          actions.deleteTask(task.id);
          navigate('/tasks');
          toast('Task deleted');
        }}
      />
    </div>
  );
}
