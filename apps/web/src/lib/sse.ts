import type { CoachEvent, SendMessageInput } from '@cycling-coach/shared';
import { apiBaseUrl } from './api';

/**
 * Send one message and stream the coach's turn. `fetch` rather than EventSource: EventSource can't
 * POST, and can't carry the bearer header the native app will need.
 */
export async function* streamCoachTurn(threadId: string, input: SendMessageInput, signal: AbortSignal): AsyncGenerator<CoachEvent> {
  const res = await fetch(`${apiBaseUrl}/api/threads/${threadId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) {
    yield { type: 'error', message: `The coach is unavailable (${res.status}).`, retryable: true };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield JSON.parse(data) as CoachEvent;
    }
  }
}
