/**
 * Lets a coach reply in gently (DECISIONS #84). The model sends text in bursts, far faster than
 * anyone reads, and a burst lands as a block. The pacer holds a turn's events in order and lets the
 * text out a few words at a time, so a card never overtakes the words before it.
 */

const MIN_CHARS_PER_SEC = 40;
const MAX_CHARS_PER_SEC = 400;
/** How far behind the stream the text may sit: the backlog is spread over this long. */
const SMOOTHING_SEC = 1.2;
/** Longest a finished stream waits for its text to come out. */
export const FINISH_SEC = 2;

/** Characters per second for this much waiting text. */
export function revealRate(backlog: number): number {
  return Math.min(MAX_CHARS_PER_SEC, Math.max(MIN_CHARS_PER_SEC, backlog / SMOOTHING_SEC));
}

/** Where to cut `text` to let about `budget` characters out: the end of the word it lands in. */
export function wordCut(text: string, budget: number): number {
  if (budget >= text.length) return text.length;
  const next = text.slice(Math.max(0, budget - 1)).search(/\s/);
  return next === -1 ? text.length : Math.max(0, budget - 1) + next + 1;
}

type Item<E> = { text: string } | { event: E };

export class TextPacer<E> {
  private queue: Item<E>[] = [];
  /** Characters earned and not yet spent. A long word can overdraw it, which keeps the average right. */
  private credit = 0;
  /** Set once the stream ends: the speed that gets the rest out in time. */
  private finishRate = 0;

  constructor(private readonly out: { text: (text: string) => void; event: (event: E) => void }) {}

  get idle() {
    return this.queue.length === 0;
  }

  private get backlog() {
    return this.queue.reduce((n, item) => n + ('text' in item ? item.text.length : 0), 0);
  }

  /** Events at the front have no text to wait for. */
  private release() {
    for (let head = this.queue[0]; head && 'event' in head; head = this.queue[0]) {
      this.queue.shift();
      this.out.event(head.event);
    }
  }

  pushText(text: string) {
    const last = this.queue.at(-1);
    if (last && 'text' in last) last.text += text;
    else this.queue.push({ text });
  }

  pushEvent(event: E) {
    this.queue.push({ event });
    this.release();
  }

  /** The model call that wrote the waiting text was dropped, so it never shows. */
  dropText() {
    this.queue = this.queue.filter((item) => 'event' in item);
    this.release();
  }

  /** The stream ended: nothing more is coming, so aim to be done within FINISH_SEC. */
  finish() {
    this.finishRate = this.backlog / FINISH_SEC;
  }

  /** Let out what `elapsedMs` has earned. */
  tick(elapsedMs: number) {
    const head = this.queue[0];
    if (!head || !('text' in head)) {
      this.credit = 0;
      return;
    }
    this.credit += (Math.max(revealRate(this.backlog), this.finishRate) * elapsedMs) / 1000;
    if (this.credit < 1) return;
    const cut = wordCut(head.text, Math.floor(this.credit));
    this.credit -= cut;
    const shown = head.text.slice(0, cut);
    head.text = head.text.slice(cut);
    if (!head.text) this.queue.shift();
    this.out.text(shown);
    this.release();
  }

  /** Everything, now: Stop, a hidden tab, or reduced motion. */
  flush() {
    for (let head = this.queue.shift(); head; head = this.queue.shift()) {
      if ('text' in head) this.out.text(head.text);
      else this.out.event(head.event);
    }
    this.credit = 0;
  }
}

/**
 * Close what the words so far left open, so `**Tuesday: ea` reads as bold, not as asterisks, until
 * the closing marker arrives. Live text only: a stored message is whole.
 */
export function settleMarkdown(text: string): string {
  let settled = text;
  // A lone `*` at the very end is half of a `**`.
  if (/(^|[^*])\*$/.test(settled)) settled = settled.slice(0, -1);
  const bold = settled.split('**').length - 1;
  const code = settled.replaceAll('```', '').split('`').length - 1;
  if (code % 2 === 1) settled += '`';
  if (bold % 2 === 1) settled = /\*\*\s*$/.test(settled) ? settled.replace(/\*\*\s*$/, '') : `${settled.trimEnd()}**`;
  return settled;
}
