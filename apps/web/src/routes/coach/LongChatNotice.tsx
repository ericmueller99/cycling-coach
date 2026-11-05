import { Button } from '../../components/ui';
import { useStoredState } from '../../lib/useStoredState';

/** Enough to cover the chats anyone is still in, without the list growing for ever. */
const REMEMBERED = 20;

/**
 * A long chat costs more each time it's picked up, so offer a new one (DECISIONS #80). It's only a
 * suggestion: the chat restarts by itself on a return whether this is ever pressed or not.
 */
export function LongChatNotice({ threadId, onNewChat }: { threadId: string; onNewChat: () => void }) {
  const [dismissed, setDismissed] = useStoredState<string[]>('coach.long-chat-dismissed', []);
  if (dismissed.includes(threadId)) return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] mobile:flex-wrap">
      <span className="min-w-0 flex-auto">This chat is getting long. Start a new one and your coach keeps a recap of it.</span>
      <div className="flex flex-none items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => setDismissed([...dismissed, threadId].slice(-REMEMBERED))}>
          Dismiss
        </Button>
        <Button size="sm" onClick={onNewChat}>
          Start a new chat
        </Button>
      </div>
    </div>
  );
}
