import { useState } from 'react';
import { PencilIcon, TrashIcon } from '../../components/icons';
import { Button, Card } from '../../components/ui';
import { useProfileMutations } from '../../lib/queries';

export function MemorySection({ memories }: { memories: { id: string; text: string; source: string }[] }) {
  const { createMemory, updateMemory, deleteMemory } = useProfileMutations();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);

  return (
    <Card className="flex flex-col gap-2.5 p-[18px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="m-0 text-base">What the coach remembers</h2>
          <div className="text-xs text-muted">Added by you or the coach · sent with every message</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setAdding(true);
            setText('');
          }}
        >
          + Add
        </Button>
      </div>
      {adding && (
        <div className="flex gap-2">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} className="min-h-10 flex-1 rounded-lg border border-line-strong px-2" />
          <Button size="sm" variant="primary" disabled={!text} onClick={() => createMemory.mutate(text, { onSuccess: () => setAdding(false) })}>
            Save
          </Button>
        </div>
      )}
      {memories.map((m) => (
        <div key={m.id} className="flex items-center gap-2.5 border-b border-divider py-2">
          {editing === m.id ? (
            <>
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} className="min-h-9 flex-1 rounded-lg border border-line-strong px-2 text-[13px]" />
              <Button size="sm" variant="primary" disabled={!text} onClick={() => updateMemory.mutate({ id: m.id, text }, { onSuccess: () => setEditing(null) })}>
                Save
              </Button>
            </>
          ) : (
            <>
              <span className="flex-auto text-[13px]">
                {m.text}
                {m.source === 'coach' && <span className="ml-1.5 text-[11px] text-faint">· coach</span>}
              </span>
              <button
                type="button"
                aria-label="Edit memory"
                onClick={() => {
                  setEditing(m.id);
                  setText(m.text);
                }}
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted"
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                aria-label="Delete memory"
                onClick={() => deleteMemory.mutate(m.id)}
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent text-muted"
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      ))}
    </Card>
  );
}
